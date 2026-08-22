import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

/**
 * Section 3 — flow control: the receive buffer and the advertised window.
 *
 * The buffer is a tank. The network fills it from the top, the application
 * drains it from the bottom, and rwnd is whatever headroom is left. Drop the
 * drain rate below the arrival rate and the tank fills, rwnd falls to zero, the
 * sender stalls, and the persist timer starts firing zero-window probes.
 *
 * Everything the sender knows about the receiver is one number in the last ACK
 * header, and it is already half an RTT out of date by the time it arrives —
 * which is why the advertised window and the true free space differ on screen.
 */

const KB          = 1024
const CAP_PLAIN   = 65535         // 16-bit window field, no scaling
const CAP_SCALED  = 1024 * KB     // window scale 7 → the same field × 128
const LINK_RATE   = 3800          // bytes the sender can push per tick
const DELAY_TICKS = 4             // one-way propagation, in ticks
const RTT_MS      = 80
const TICK_MS     = 55
const PROBE_EVERY = 18            // persist-timer ticks between zero-window probes

const fmt = b => (b >= KB ? `${(b / KB).toFixed(b >= 10 * KB ? 0 : 1)} KB` : `${b} B`)

function initialSim(cap) {
  return {
    cap,
    buffered:  0,
    pipe:      Array(DELAY_TICKS).fill(0),   // bytes in flight toward the receiver
    ackPipe:   Array(DELAY_TICKS).fill(null),// advertised windows in flight back
    advertised: cap,                          // what the sender currently believes
    stalledFor: 0,
    probeIn:   PROBE_EVERY,
    probes:    0,
    delivered: 0,
    log:       [],
    tick:      0,
  }
}

export default function ReceiveWindow() {
  const [scaling, setScaling] = useState(false)
  const [drain, setDrain]     = useState(3400)   // bytes the app reads per tick
  const [running, setRunning] = useState(false)
  const reduce = useReducedMotion()

  const cap = scaling ? CAP_SCALED : CAP_PLAIN
  const sim = useRef(null)
  if (sim.current === null) sim.current = initialSim(cap)
  const [view, setView] = useState(() => ({ ...sim.current, pipe: [...sim.current.pipe] }))

  const latest = useRef({})
  latest.current = { drain, cap }

  const step = () => {
    const s = sim.current
    const { drain: d } = latest.current
    s.tick++

    // 1. the application reads
    const read = Math.min(s.buffered, d)
    s.buffered -= read
    s.delivered += read

    // 2. bytes that left the sender DELAY_TICKS ago land in the buffer
    const landing = s.pipe.shift() ?? 0
    s.buffered = Math.min(s.cap, s.buffered + landing)

    // 3. the receiver advertises whatever is free, and that number starts its
    //    own trip back — the sender will not see it for another half RTT
    const free = s.cap - s.buffered
    s.ackPipe.push(free)
    const arrivedAck = s.ackPipe.shift()
    if (arrivedAck !== null && arrivedAck !== undefined) s.advertised = arrivedAck

    // 4. the sender may not have more unacknowledged bytes outstanding than the
    //    window it was last told about
    const outstanding = s.pipe.reduce((a, v) => a + v, 0)
    let toSend = Math.max(0, Math.min(LINK_RATE, s.advertised - outstanding))

    if (s.advertised === 0) {
      s.stalledFor++
      s.probeIn--
      if (s.probeIn <= 0) {
        s.probeIn = PROBE_EVERY
        s.probes++
        // A zero-window probe is one byte, sent purely to force a fresh ACK.
        // Without it a lost window update deadlocks the connection forever.
        toSend = 1
        s.log = [...s.log, `${s.tick * TICK_MS}ms  persist timer fired — zero-window probe #${s.probes} (1 byte)`].slice(-7)
      }
    } else {
      if (s.stalledFor > 0) {
        s.log = [...s.log, `${s.tick * TICK_MS}ms  window reopened to ${fmt(s.advertised)} after ${s.stalledFor} stalled ticks`].slice(-7)
      }
      s.stalledFor = 0
      s.probeIn = PROBE_EVERY
    }

    if (s.advertised > 0 && s.advertised < s.cap * 0.08 && s.tick % 12 === 0) {
      s.log = [...s.log, `${s.tick * TICK_MS}ms  window shrinking — advertising win=${s.advertised}`].slice(-7)
    }

    s.pipe.push(toSend)
    setView({ ...s, pipe: [...s.pipe], log: s.log })
  }

  useEffect(() => {
    if (!running) return
    const t = setInterval(step, TICK_MS)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running])

  // Changing the window-scale option is a new connection, not a live change:
  // the scale factor is negotiated once, in the SYN.
  useEffect(() => {
    sim.current = initialSim(cap)
    setView({ ...sim.current, pipe: [...sim.current.pipe] })
    setRunning(false)
  }, [cap])

  const reset = () => {
    setRunning(false)
    sim.current = initialSim(cap)
    setView({ ...sim.current, pipe: [...sim.current.pipe] })
  }

  const fillPct     = Math.min(100, (view.buffered / view.cap) * 100)
  const free        = view.cap - view.buffered
  const stalled     = view.advertised === 0
  const outstanding = view.pipe.reduce((a, v) => a + v, 0)
  // Classic bandwidth-delay product: you cannot go faster than one window per RTT.
  const ceilingMbps = ((view.cap * 8) / (RTT_MS / 1000)) / 1e6

  return (
    <div className="viz-card">
      <p className="viz-title">↳ the receiver decides how fast you may send</p>

      <div className="grid grid-cols-4 gap-3 mb-5">
        <div className="stat-card">
          <div className="stat-value text-lg">{fmt(view.buffered)}</div>
          <div className="stat-label">buffered</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value text-lg ${stalled ? 'text-rose-600' : 'text-accent-600'}`}>{fmt(view.advertised)}</div>
          <div className="stat-label">rwnd advertised</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-lg">{fmt(outstanding)}</div>
          <div className="stat-label">unacked in flight</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value text-lg ${view.probes > 0 ? 'text-rose-600' : ''}`}>{view.probes}</div>
          <div className="stat-label">zero-window probes</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button className={!scaling ? 'btn-sim-accent' : 'btn-sim'} onClick={() => setScaling(false)}>
          no window scaling (64 KB)
        </button>
        <button className={scaling ? 'btn-sim-accent' : 'btn-sim'} onClick={() => setScaling(true)}>
          window scale 7 (1 MB)
        </button>
      </div>
      <p className="font-mono text-[10px] viz-muted mb-5">
        The window field is 16 bits, so it tops out at 65535 bytes. RFC 1323 negotiates a left-shift once, in the SYN —
        at {RTT_MS}ms RTT this window caps you at <strong>{ceilingMbps.toFixed(1)} Mbit/s</strong> no matter how fat the link is.
      </p>

      <div className="slider-row">
        <span className="slider-label">app drain rate</span>
        <input
          type="range" min="0" max="6000" step="200" value={drain}
          onChange={e => setDrain(Number(e.target.value))}
          className="flex-1 accent-blue-600"
        />
        <span className="slider-value">{fmt(drain)}/tick</span>
      </div>
      <p className="font-mono text-[10px] viz-muted mb-5">
        the sender pushes up to {fmt(LINK_RATE)}/tick — drag the drain below that and watch the tank win
      </p>

      <div className="viz-panel mb-4">
        <div className="flex gap-5 items-stretch">
          <div className="flex flex-col justify-between py-1 shrink-0" style={{ width: 132 }}>
            <div>
              <p className="font-mono text-[10px] viz-muted mb-1">network → buffer</p>
              <p className="font-mono text-[12px]" style={{ color: 'var(--accent)', margin: 0 }}>+{fmt(view.pipe[0] ?? 0)}/tick</p>
            </div>
            <div>
              <p className="font-mono text-[10px] viz-muted mb-1">app read() ← buffer</p>
              <p className="font-mono text-[12px]" style={{ color: 'var(--green)', margin: 0 }}>−{fmt(Math.min(view.buffered, drain))}/tick</p>
            </div>
            <div>
              <p className="font-mono text-[10px] viz-muted mb-1">delivered total</p>
              <p className="font-mono text-[12px] viz-dim" style={{ margin: 0 }}>{fmt(view.delivered)}</p>
            </div>
          </div>

          <div className="tcp-tank shrink-0" style={{ width: 116, height: 196 }}>
            <motion.div
              className={`tcp-tank-fill ${fillPct > 96 ? 'tcp-tank-fill-full' : ''}`}
              initial={false}
              animate={{ height: `${fillPct}%` }}
              transition={{ duration: reduce ? 0 : 0.18, ease: 'linear' }}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="font-mono text-[11px] viz-strong">{Math.round(fillPct)}%</span>
              <span className="font-mono text-[9px] viz-muted">of {fmt(view.cap)}</span>
            </div>
          </div>

          <div className="flex-1 flex flex-col justify-center gap-2">
            <div className={`viz-panel ${stalled ? 'viz-panel-active' : ''}`} style={{ background: 'var(--surface-solid)' }}>
              <p className="font-mono text-[10px] viz-muted mb-1">last ACK the sender received</p>
              <p className="font-mono text-[12px] viz-strong" style={{ margin: 0 }}>
                ack=… <span style={{ color: stalled ? '#ef6b73' : 'var(--accent)' }}>win={view.advertised}</span>
              </p>
              <p className="font-mono text-[9px] viz-muted mt-1" style={{ margin: '4px 0 0' }}>
                true free space right now is {fmt(free)} — the sender is working from a number that is half an RTT stale
              </p>
            </div>

            <div className="font-mono text-[10px]" style={{ color: stalled ? '#ef6b73' : 'var(--ink-dim)' }}>
              {stalled
                ? `sender BLOCKED — write() is not returning. Persist timer fires a probe in ${view.probeIn} ticks.`
                : outstanding >= view.advertised
                  ? 'sender is window-limited: it has exactly rwnd bytes outstanding and may not send another byte until an ACK frees space'
                  : 'sender is link-limited: there is window headroom left over'}
            </div>
          </div>
        </div>
      </div>

      <div className="sim-log mb-4">
        {view.log.length === 0
          ? <div className="viz-muted">press play, then starve the application</div>
          : view.log.map((line, i) => <div key={i}>{line}</div>)}
      </div>

      <div className="flex flex-wrap gap-2">
        <button className={running ? 'btn-sim-danger' : 'btn-sim-accent'} onClick={() => setRunning(r => !r)}>
          {running ? 'pause' : 'play'}
        </button>
        <button className="btn-sim" onClick={step}>step one tick</button>
        <button className="btn-sim-danger" onClick={() => setDrain(0)}>stall the application</button>
        <button className="btn-sim-success" onClick={() => setDrain(6000)}>drain fast</button>
        <button className="btn-sim ml-auto" onClick={reset}>reset</button>
      </div>
    </div>
  )
}
