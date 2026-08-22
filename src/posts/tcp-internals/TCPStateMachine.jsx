import { useEffect, useRef, useState } from 'react'

/**
 * Section 5 — the TCP state machine, and what TIME_WAIT actually costs.
 *
 * Three scenarios walk the same graph: the side that calls close() first
 * (active close) ends up holding TIME_WAIT; the side that receives the FIN
 * (passive close) goes through CLOSE_WAIT and is finished first. Simultaneous
 * close is the third path, through CLOSING, and it exists because nothing stops
 * both ends calling close() in the same round trip.
 *
 * The TIME_WAIT countdown runs at 60s, which is Linux's fixed TCP_TIMEWAIT_LEN
 * (it does not read net.ipv4.tcp_fin_timeout — that one governs FIN_WAIT_2).
 */

const NODE_W = 120
const NODE_H = 30
const VB_W   = 700
const VB_H   = 600

// x, y are node centres in the viewBox coordinate space.
const NODES = {
  CLOSED:        { x: 350, y: 30,  label: 'CLOSED' },
  LISTEN:        { x: 550, y: 100, label: 'LISTEN' },
  SYN_SENT:      { x: 150, y: 100, label: 'SYN_SENT' },
  SYN_RECEIVED:  { x: 550, y: 175, label: 'SYN_RECEIVED' },
  ESTABLISHED:   { x: 350, y: 255, label: 'ESTABLISHED' },
  FIN_WAIT_1:    { x: 120, y: 340, label: 'FIN_WAIT_1' },
  CLOSING:       { x: 350, y: 415, label: 'CLOSING' },
  CLOSE_WAIT:    { x: 580, y: 340, label: 'CLOSE_WAIT' },
  FIN_WAIT_2:    { x: 120, y: 415, label: 'FIN_WAIT_2' },
  LAST_ACK:      { x: 580, y: 415, label: 'LAST_ACK' },
  TIME_WAIT:     { x: 120, y: 490, label: 'TIME_WAIT' },
  CLOSED_END:    { x: 350, y: 565, label: 'CLOSED' },
}

/** Each scenario is a list of transitions: where it goes and why. */
const SCENARIOS = {
  active: {
    title: 'active close — you called close() first',
    path: [
      { to: 'CLOSED',      event: 'socket()',                   note: 'no connection exists. No kernel state has been allocated.' },
      { to: 'SYN_SENT',    event: 'connect() / send SYN',       note: 'the client has committed a local port and an ISN.' },
      { to: 'ESTABLISHED', event: 'recv SYN,ACK / send ACK',    note: 'data can flow in both directions.' },
      { to: 'FIN_WAIT_1',  event: 'close() / send FIN',         note: 'this half is shut. You may still read what the peer sends.' },
      { to: 'FIN_WAIT_2',  event: 'recv ACK of FIN',            note: 'the peer acknowledged your FIN but has not sent its own. If its application never calls close(), you sit here until tcp_fin_timeout (60s).' },
      { to: 'TIME_WAIT',   event: 'recv FIN / send ACK',        note: 'both directions are closed — but you must linger for 2×MSL.' },
      { to: 'CLOSED_END',  event: '2×MSL elapsed',              note: 'the 4-tuple is finally free for reuse.' },
    ],
  },
  passive: {
    title: 'passive close — the peer closed first',
    path: [
      { to: 'CLOSED',       event: 'socket()',                  note: 'nothing yet.' },
      { to: 'LISTEN',       event: 'bind() + listen()',         note: 'the accept queue exists. Incoming SYNs will be answered.' },
      { to: 'SYN_RECEIVED', event: 'recv SYN / send SYN,ACK',   note: 'a half-open entry sits in the SYN queue. This is what a SYN flood fills.' },
      { to: 'ESTABLISHED',  event: 'recv ACK',                  note: 'the connection moves to the accept queue and accept() can return it.' },
      { to: 'CLOSE_WAIT',   event: 'recv FIN / send ACK',       note: 'the peer is done sending. Your application has NOT called close() yet — sockets piling up here are always an application bug.' },
      { to: 'LAST_ACK',     event: 'close() / send FIN',        note: 'your side is finally shut too.' },
      { to: 'CLOSED_END',   event: 'recv ACK of FIN',           note: 'done, with no TIME_WAIT. The passive closer pays nothing.' },
    ],
  },
  simultaneous: {
    title: 'simultaneous close — both sides called close()',
    path: [
      { to: 'CLOSED',      event: 'socket()',                   note: 'nothing yet.' },
      { to: 'SYN_SENT',    event: 'connect() / send SYN',       note: '' },
      { to: 'ESTABLISHED', event: 'recv SYN,ACK / send ACK',    note: '' },
      { to: 'FIN_WAIT_1',  event: 'close() / send FIN',         note: 'your FIN is on the wire.' },
      { to: 'CLOSING',     event: 'recv FIN / send ACK',        note: 'the peer’s FIN crossed yours in flight. Neither FIN has been acknowledged yet, so you cannot go to FIN_WAIT_2.' },
      { to: 'TIME_WAIT',   event: 'recv ACK of FIN',            note: 'both FINs are now acknowledged.' },
      { to: 'CLOSED_END',  event: '2×MSL elapsed',              note: 'both ends hold TIME_WAIT in this case.' },
    ],
  },
}

const TIME_WAIT_SECS = 60
const EPHEMERAL      = 60999 - 32768 + 1   // Linux default ip_local_port_range

export default function TCPStateMachine() {
  const [scenario, setScenario] = useState('active')
  const [i, setI]           = useState(0)
  const [running, setRunning] = useState(false)
  const [twLeft, setTwLeft] = useState(TIME_WAIT_SECS)
  const [connRate, setConnRate] = useState(300)

  const path  = SCENARIOS[scenario].path
  const total = path.length - 1
  const cur   = path[i]
  const inTimeWait = cur.to === 'TIME_WAIT'

  const latest = useRef({})
  latest.current = { i, total }

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => {
      if (latest.current.i >= latest.current.total) { setRunning(false); return }
      setI(n => n + 1)
    }, 1400)
    return () => clearInterval(t)
  }, [running])

  // The countdown only runs while the socket is actually in TIME_WAIT, and it
  // is compressed 10× so the point lands before the reader loses interest.
  useEffect(() => {
    if (!inTimeWait) { setTwLeft(TIME_WAIT_SECS); return }
    const t = setInterval(() => setTwLeft(v => (v <= 1 ? TIME_WAIT_SECS : v - 1)), 100)
    return () => clearInterval(t)
  }, [inTimeWait])

  const pick = next => { setScenario(next); setI(0); setRunning(false) }
  const reset = () => { setI(0); setRunning(false) }

  const visited = new Set(path.slice(0, i + 1).map(p => p.to))
  const heldSockets = connRate * TIME_WAIT_SECS
  const exhausted = heldSockets > EPHEMERAL

  return (
    <div className="viz-card">
      <p className="viz-title">↳ every connection is a state machine</p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {Object.keys(SCENARIOS).map(key => (
          <button key={key} className={scenario === key ? 'btn-sim-accent' : 'btn-sim'} onClick={() => pick(key)}>
            {key === 'active' ? 'active close' : key === 'passive' ? 'passive close' : 'simultaneous close'}
          </button>
        ))}
      </div>
      <p className="font-mono text-[10px] viz-muted mb-4">{SCENARIOS[scenario].title}</p>

      <div className="viz-panel mb-4">
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} style={{ display: 'block', width: '100%' }}
             role="img" aria-label={`TCP state machine. Current state: ${cur.to === 'CLOSED_END' ? 'CLOSED' : cur.to}.`}>
          {/* every edge on the chosen path, dim ahead of the cursor */}
          {path.slice(1).map((tr, idx) => {
            const from = NODES[path[idx].to]
            const to   = NODES[tr.to]
            const done = idx < i
            const active = idx === i - 1
            const midX = (from.x + to.x) / 2
            const midY = (from.y + to.y) / 2
            return (
              <g key={tr.to + idx} opacity={done || active ? 1 : 0.32}>
                <line
                  x1={from.x} y1={from.y + NODE_H / 2} x2={to.x} y2={to.y - NODE_H / 2}
                  className={active ? 'tcp-state-edge tcp-state-edge-active' : 'tcp-state-edge'}
                />
                <text
                  x={midX + 8} y={midY} className={`tcp-state-edge-label${active ? ' tcp-state-edge-label-active' : ''}`}
                >
                  {tr.event}
                </text>
              </g>
            )
          })}

          {Object.entries(NODES).map(([key, n]) => {
            const onPath  = path.some(p => p.to === key)
            const isCur   = cur.to === key
            const wasSeen = visited.has(key)
            const timed   = isCur && key === 'TIME_WAIT'
            const nodeCls = timed
              ? 'tcp-state-node tcp-state-node-timed'
              : isCur ? 'tcp-state-node tcp-state-node-active'
              : wasSeen ? 'tcp-state-node tcp-state-node-visited'
              : 'tcp-state-node'
            const textCls = timed
              ? 'tcp-state-text tcp-state-text-timed'
              : isCur ? 'tcp-state-text tcp-state-text-active'
              : wasSeen ? 'tcp-state-text tcp-state-text-visited'
              : 'tcp-state-text'
            return (
              <g key={key} opacity={onPath ? 1 : 0.28}>
                <rect
                  x={n.x - NODE_W / 2} y={n.y - NODE_H / 2} width={NODE_W} height={NODE_H}
                  rx="6" className={nodeCls}
                />
                <text x={n.x} y={n.y + 3.5} textAnchor="middle" className={textCls}>{n.label}</text>
                {timed && (
                  <text x={n.x} y={n.y + NODE_H / 2 + 14} textAnchor="middle" className="tcp-state-text tcp-state-text-timed">
                    {twLeft}s of 2×MSL
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>

      <div className="viz-panel mb-4" style={{ minHeight: 58 }}>
        <p className="font-mono text-[10px] viz-muted mb-1">
          step {i} / {total} · <strong style={{ color: 'var(--accent)' }}>{cur.event}</strong>
        </p>
        <p className="font-mono text-[11px] viz-dim" style={{ margin: 0 }}>{cur.note || '—'}</p>
      </div>

      <div className="viz-panel mb-4">
        <p className="font-mono text-[10px] viz-muted mb-2">what TIME_WAIT costs at scale</p>
        <div className="slider-row" style={{ marginBottom: 8 }}>
          <span className="slider-label">new conns/sec</span>
          <input
            type="range" min="50" max="1200" step="50" value={connRate}
            onChange={e => setConnRate(Number(e.target.value))}
            className="flex-1 accent-blue-600"
          />
          <span className="slider-value">{connRate}/s</span>
        </div>
        <p className="font-mono text-[11px]" style={{ margin: 0, color: exhausted ? '#ef6b73' : 'var(--ink-dim)' }}>
          {connRate}/s × {TIME_WAIT_SECS}s = <strong>{heldSockets.toLocaleString('en-US')}</strong> sockets parked in TIME_WAIT
          {' '}against {EPHEMERAL.toLocaleString('en-US')} ephemeral ports.
          {exhausted
            ? ' Ports exhausted — connect() starts returning EADDRNOTAVAIL. Reuse connections; do not reach for tcp_tw_recycle, it was removed in 4.12 for good reason.'
            : ' Still inside the port range — but this is per destination pair, and one hot upstream is all it takes.'}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button className="btn-sim-accent" onClick={() => setI(n => Math.min(n + 1, total))} disabled={i >= total}>
          next transition
        </button>
        <button className={running ? 'btn-sim-danger' : 'btn-sim'} onClick={() => setRunning(r => !r)} disabled={i >= total}>
          {running ? 'pause' : 'play'}
        </button>
        <button className="btn-sim ml-auto" onClick={reset}>reset</button>
      </div>
    </div>
  )
}
