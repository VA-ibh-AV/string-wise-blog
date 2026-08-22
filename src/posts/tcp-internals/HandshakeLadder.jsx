import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

/**
 * Section 1 — the three-way handshake and the four-way teardown.
 *
 * A ladder diagram where every arrow carries the real header fields. The point
 * the animation is making: SYN and FIN each consume one sequence number, which
 * is why the ACKs come back as ISN+1 rather than ISN, and why the teardown is
 * four packets — each direction is closed independently.
 *
 * ISNs are fixed constants on first render (not Math.random) so the build-time
 * prerender and the client hydration produce identical markup. "reroll ISNs"
 * randomises them afterwards, which only ever runs on the client.
 */

const ISN_C = 1320745829
const ISN_S = 3811002447

const W = 660
const TOP = 54
const ROW = 56
const TRAVEL = 24          // vertical drop across the wire = propagation delay
const X_C = 96
const X_S = W - 96

/**
 * Each step is one segment on the wire. `client` / `server` are the states each
 * side is in *after* the segment has been delivered, which is what makes the
 * asymmetry visible: the client reaches ESTABLISHED a full half-RTT before the
 * server does.
 */
function buildSteps(c, s) {
  return [
    {
      phase: 'open', dir: 'right', flags: 'SYN', seq: c, ack: null,
      client: 'SYN_SENT', server: 'SYN_RECEIVED',
      note: 'client picks a random ISN. SYN carries no data but consumes one sequence number.',
    },
    {
      phase: 'open', dir: 'left', flags: 'SYN, ACK', seq: s, ack: c + 1,
      client: 'ESTABLISHED', server: 'SYN_RECEIVED',
      note: 'server picks its own independent ISN and acknowledges the client’s SYN with ISN+1.',
    },
    {
      phase: 'open', dir: 'right', flags: 'ACK', seq: c + 1, ack: s + 1,
      client: 'ESTABLISHED', server: 'ESTABLISHED',
      note: 'both directions are now synchronised. This third ACK can already carry payload.',
    },
    {
      phase: 'close', dir: 'right', flags: 'FIN, ACK', seq: c + 1, ack: s + 1,
      client: 'FIN_WAIT_1', server: 'CLOSE_WAIT',
      note: 'the client calls close(). It will send no more data — but it can still receive.',
    },
    {
      phase: 'close', dir: 'left', flags: 'ACK', seq: s + 1, ack: c + 2,
      client: 'FIN_WAIT_2', server: 'CLOSE_WAIT',
      note: 'the kernel ACKs the FIN immediately. FIN consumed a sequence number, so ack = ISN+2.',
    },
    {
      phase: 'close', dir: 'left', flags: 'FIN, ACK', seq: s + 1, ack: c + 2,
      client: 'TIME_WAIT', server: 'LAST_ACK',
      note: 'the server closes its half — separately, whenever its application gets round to it.',
    },
    {
      phase: 'close', dir: 'right', flags: 'ACK', seq: c + 2, ack: s + 2,
      client: 'TIME_WAIT', server: 'CLOSED',
      note: 'the server is done. The client holds TIME_WAIT for 2×MSL to absorb stragglers.',
    },
  ]
}

const OPEN_STEPS = 3

export default function HandshakeLadder() {
  const [isn, setIsn]     = useState({ c: ISN_C, s: ISN_S })
  const [phase, setPhase] = useState('open')     // 'open' | 'close'
  const [shown, setShown] = useState(0)          // segments delivered so far
  const [running, setRunning] = useState(false)
  const reduce = useReducedMotion()

  const steps   = buildSteps(isn.c, isn.s)
  const visible = phase === 'open' ? steps.slice(0, OPEN_STEPS) : steps
  const total   = visible.length

  const latest = useRef({})
  latest.current = { shown, total }

  const step  = () => setShown(n => Math.min(n + 1, latest.current.total))
  const reset = () => { setRunning(false); setShown(0) }

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => {
      if (latest.current.shown >= latest.current.total) { setRunning(false); return }
      setShown(n => n + 1)
    }, 1100)
    return () => clearInterval(t)
  }, [running])

  // Switching phase mid-run would leave `shown` past the end of the new list.
  const switchPhase = next => { setPhase(next); setShown(0); setRunning(false) }

  const done      = shown >= total
  const last      = shown > 0 ? visible[shown - 1] : null
  const clientState = last ? last.client : (phase === 'open' ? 'CLOSED' : 'ESTABLISHED')
  const serverState = last ? last.server : (phase === 'open' ? 'LISTEN'  : 'ESTABLISHED')

  const height = TOP + total * ROW + TRAVEL + 24

  return (
    <div className="viz-card">
      <p className="viz-title">↳ the handshake, packet by packet</p>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="stat-card">
          <div className="stat-value text-accent-600 text-[13px]">{clientState}</div>
          <div className="stat-label">client state</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-[13px]" style={{ color: 'var(--green)' }}>{serverState}</div>
          <div className="stat-label">server state</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{shown}/{total}</div>
          <div className="stat-label">segments on the wire</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button className={phase === 'open' ? 'btn-sim-accent' : 'btn-sim'} onClick={() => switchPhase('open')}>
          3-way handshake
        </button>
        <button className={phase === 'close' ? 'btn-sim-accent' : 'btn-sim'} onClick={() => switchPhase('close')}>
          full open + 4-way teardown
        </button>
      </div>

      <div className="viz-panel mb-4">
        <svg viewBox={`0 0 ${W} ${height}`} style={{ display: 'block', width: '100%' }}
             role="img" aria-label={`TCP ${phase === 'open' ? 'handshake' : 'connection and teardown'} ladder diagram, ${shown} of ${total} segments sent`}>
          <text x={X_C} y="18" textAnchor="middle" className="tcp-endpoint-label">client</text>
          <text x={X_S} y="18" textAnchor="middle" className="tcp-endpoint-label">server</text>
          <text x={X_C} y="34" textAnchor="middle" className="tcp-pkt-label">:54312</text>
          <text x={X_S} y="34" textAnchor="middle" className="tcp-pkt-label">:443</text>

          <line x1={X_C} y1={TOP - 12} x2={X_C} y2={height - 12} className="tcp-lifeline" />
          <line x1={X_S} y1={TOP - 12} x2={X_S} y2={height - 12} className="tcp-lifeline" />

          {visible.slice(0, shown).map((sg, i) => {
            const y1 = TOP + i * ROW
            const y2 = y1 + TRAVEL
            const rightward = sg.dir === 'right'
            const [xa, xb] = rightward ? [X_C, X_S] : [X_S, X_C]
            const [ya, yb] = [y1, y2]
            const isAck    = sg.flags === 'ACK'
            const cls      = `tcp-arrow${isAck ? ' tcp-arrow-ack' : ''}`
            const headCls  = `tcp-arrow-head${isAck ? ' tcp-arrow-head-ack' : ''}`
            const dir      = rightward ? -1 : 1
            const isNewest = i === shown - 1

            return (
              <motion.g
                key={`${phase}-${i}`}
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
              >
                <motion.line
                  x1={xa} y1={ya} x2={xb} y2={yb} className={cls}
                  initial={reduce || !isNewest ? false : { pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: reduce ? 0 : 0.55, ease: 'easeInOut' }}
                />
                <polygon
                  className={headCls}
                  points={`${xb},${yb} ${xb + dir * 11},${yb - 5} ${xb + dir * 11},${yb + 5}`}
                />
                <text
                  x={(xa + xb) / 2} y={(ya + yb) / 2 - 8}
                  textAnchor="middle" className="tcp-pkt-label"
                  style={{ fill: isAck ? 'var(--green)' : 'var(--accent)', fontWeight: 600 }}
                >
                  [{sg.flags}]
                </text>
                <text x={(xa + xb) / 2} y={(ya + yb) / 2 + 14} textAnchor="middle" className="tcp-pkt-label">
                  seq={sg.seq}{sg.ack !== null ? `  ack=${sg.ack}` : ''}
                </text>
              </motion.g>
            )
          })}

          {shown === 0 && (
            <text x={W / 2} y={TOP + 40} textAnchor="middle" className="tcp-pkt-label">
              nothing on the wire yet — press “send next segment”
            </text>
          )}
        </svg>
      </div>

      <div className="viz-panel mb-4" style={{ minHeight: 62 }}>
        <p className="font-mono text-[10px] viz-muted mb-1">
          {last ? `segment ${shown} / ${total}` : 'idle'}
        </p>
        <p className="font-mono text-[11px] viz-dim" style={{ margin: 0 }}>
          {last
            ? last.note
            : phase === 'open'
              ? 'The client socket is CLOSED, the server socket is in LISTEN. Nothing exists yet — no state is allocated on the server until the SYN arrives.'
              : 'Runs the handshake, then closes from the client side. Watch which side reaches TIME_WAIT — that is the side that paid for the close.'}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="viz-panel">
          <p className="font-mono text-[10px] viz-muted mb-1">client ISN</p>
          <p className="font-mono text-[12px] viz-strong" style={{ margin: 0 }}>{isn.c}</p>
        </div>
        <div className="viz-panel">
          <p className="font-mono text-[10px] viz-muted mb-1">server ISN</p>
          <p className="font-mono text-[12px] viz-strong" style={{ margin: 0 }}>{isn.s}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button className="btn-sim-accent" onClick={step} disabled={done}>send next segment</button>
        <button className={running ? 'btn-sim-danger' : 'btn-sim'} onClick={() => setRunning(r => !r)} disabled={done}>
          {running ? 'pause' : 'play'}
        </button>
        <button
          className="btn-sim"
          onClick={() => {
            setIsn({
              c: Math.floor(Math.random() * 4294967295),
              s: Math.floor(Math.random() * 4294967295),
            })
            reset()
          }}
        >
          reroll ISNs
        </button>
        <button className="btn-sim ml-auto" onClick={reset}>reset</button>
      </div>
    </div>
  )
}
