import { useEffect, useRef, useState } from 'react'

/**
 * Section 4 — congestion control: slow start, AIMD, and what a loss costs.
 *
 * One RTT per step. Reno is the primary series: exponential growth until cwnd
 * reaches ssthresh, then +1 MSS per RTT, halving on a fast-retransmit loss and
 * collapsing to 1 MSS on a timeout. CUBIC is the optional second series, using
 * the real growth function W(t) = C·(t − K)³ + W_max with C = 0.4 and β = 0.7,
 * which is why it climbs back toward the old ceiling so much faster.
 *
 * The chart is a plain SVG polyline redrawn from history each round — framer
 * motion is deliberately not used here, because animating a growing path adds
 * nothing you can read off a graph.
 */

const IW        = 10       // Linux initial window: 10 MSS (RFC 6928)
const SSTHRESH0 = 64
const MSS       = 1460
const RTT_MS    = 80
const CUBIC_C   = 0.4
const CUBIC_B   = 0.7      // multiplicative decrease factor
const MAX_ROUND = 70
const TICK_MS   = 380

const cbrt = x => Math.cbrt(x)

function initialSim() {
  return {
    round:   0,
    reno:    { cwnd: IW, ssthresh: SSTHRESH0, phase: 'slow start' },
    cubic:   { cwnd: IW, ssthresh: SSTHRESH0, wMax: 0, epoch: 0, ss: true },
    history: [{ round: 0, reno: IW, cubic: IW, ssthresh: SSTHRESH0 }],
    events:  [],   // { round, kind: 'fast' | 'rto' }
    log:     [],
  }
}

export default function CongestionWindow() {
  const [rwnd, setRwnd]       = useState(80)   // in MSS, the receiver's cap
  const [compare, setCompare] = useState(false)
  const [running, setRunning] = useState(false)

  const sim = useRef(null)
  if (sim.current === null) sim.current = initialSim()
  const [view, setView] = useState(() => snap(sim.current))

  const latest = useRef({})
  latest.current = { rwnd }

  const push = (s, msg) => { s.log = [...s.log, `RTT ${s.round}  ${msg}`].slice(-7) }

  const advance = s => {
    s.round++
    const cap = latest.current.rwnd

    // ---- Reno ----------------------------------------------------------
    const r = s.reno
    if (r.cwnd < r.ssthresh) {
      r.cwnd = Math.min(r.cwnd * 2, r.ssthresh)
      r.phase = r.cwnd >= r.ssthresh ? 'congestion avoidance' : 'slow start'
    } else {
      r.cwnd += 1                       // additive increase: +1 MSS per RTT
      r.phase = 'congestion avoidance'
    }

    // ---- CUBIC ---------------------------------------------------------
    const c = s.cubic
    if (c.ss) {
      c.cwnd = Math.min(c.cwnd * 2, c.ssthresh)
      if (c.cwnd >= c.ssthresh) {
        // Leaving slow start starts a CUBIC epoch: the window it stopped at
        // becomes W_max, the target the cubic curve flattens out toward.
        c.ss = false
        c.wMax = c.cwnd
        c.epoch = s.round
      }
    } else {
      const t = (s.round - c.epoch) * (RTT_MS / 1000)
      const k = cbrt((c.wMax * (1 - CUBIC_B)) / CUBIC_C)
      const w = CUBIC_C * Math.pow(t - k, 3) + c.wMax
      // Never go backwards, and never grow slower than Reno would have.
      c.cwnd = Math.max(c.cwnd + 0.35, w)
    }

    r.cwnd = Math.min(r.cwnd, cap)
    c.cwnd = Math.min(c.cwnd, cap)

    s.history = [...s.history, {
      round: s.round, reno: r.cwnd, cubic: c.cwnd, ssthresh: r.ssthresh,
    }].slice(-MAX_ROUND)
  }

  const loss = (s, kind) => {
    const r = s.reno
    if (kind === 'fast') {
      // Fast retransmit + fast recovery: halve, stay in congestion avoidance.
      r.ssthresh = Math.max(2, Math.floor(r.cwnd / 2))
      r.cwnd = r.ssthresh
      r.phase = 'congestion avoidance'
      push(s, `3 dup ACKs → ssthresh = ${r.ssthresh}, cwnd halved to ${r.ssthresh} (fast recovery)`)
    } else {
      // A timeout means TCP lost its ACK clock entirely. Start over.
      r.ssthresh = Math.max(2, Math.floor(r.cwnd / 2))
      r.cwnd = 1
      r.phase = 'slow start'
      push(s, `RTO → ssthresh = ${r.ssthresh}, cwnd collapses to 1 MSS and slow start restarts`)
    }

    const c = s.cubic
    c.wMax = c.cwnd
    c.cwnd = Math.max(1, kind === 'rto' ? 1 : c.cwnd * CUBIC_B)
    c.ssthresh = Math.max(2, c.cwnd)
    c.epoch = s.round
    c.ss = kind === 'rto'

    s.events = [...s.events, { round: s.round, kind }]
    s.history = [...s.history, {
      round: s.round, reno: r.cwnd, cubic: c.cwnd, ssthresh: r.ssthresh,
    }].slice(-MAX_ROUND)
  }

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => {
      const s = sim.current
      advance(s)
      setView(snap(s))
    }, TICK_MS)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running])

  const step = () => { advance(sim.current); setView(snap(sim.current)) }
  const drop = kind => { loss(sim.current, kind); setView(snap(sim.current)) }
  const reset = () => { setRunning(false); sim.current = initialSim(); setView(snap(sim.current)) }

  const cwnd = view.reno.cwnd
  const effective = Math.min(cwnd, rwnd)
  const throughput = (effective * MSS * 8) / (RTT_MS / 1000) / 1e6

  return (
    <div className="viz-card">
      <p className="viz-title">↳ cwnd: how TCP finds the network&rsquo;s limit</p>

      <div className="grid grid-cols-4 gap-3 mb-5">
        <div className="stat-card">
          <div className="stat-value text-accent-600 text-lg">{cwnd.toFixed(1)}</div>
          <div className="stat-label">cwnd (MSS)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-lg">{view.reno.ssthresh}</div>
          <div className="stat-label">ssthresh</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-lg">{rwnd}</div>
          <div className="stat-label">rwnd (MSS)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-lg" style={{ color: 'var(--green)' }}>{effective.toFixed(0)}</div>
          <div className="stat-label">min(cwnd, rwnd)</div>
        </div>
      </div>

      <p className="font-mono text-[10px] viz-muted mb-5">
        phase: <strong style={{ color: 'var(--accent)' }}>{view.reno.phase}</strong> · round {view.round} ·
        {' '}effective window {effective.toFixed(0)} MSS ≈ {throughput.toFixed(0)} Mbit/s at {RTT_MS}ms RTT
      </p>

      <Chart history={view.history} events={view.events} compare={compare} rwnd={rwnd} />

      <div className="flex flex-wrap items-center gap-3 mb-3 mt-4">
        <span className="font-mono text-[10px] flex items-center gap-1.5" style={{ color: 'var(--accent)' }}>
          <span style={{ width: 16, height: 2, background: 'var(--accent)', display: 'inline-block' }} /> Reno cwnd
        </span>
        {compare && (
          <span className="font-mono text-[10px] flex items-center gap-1.5" style={{ color: 'var(--green)' }}>
            <span style={{ width: 16, height: 2, background: 'var(--green)', display: 'inline-block' }} /> CUBIC cwnd
          </span>
        )}
        <span className="font-mono text-[10px] flex items-center gap-1.5" style={{ color: '#ef6b73' }}>
          <span style={{ width: 16, borderTop: '2px dashed #ef6b73', display: 'inline-block' }} /> ssthresh
        </span>
      </div>

      <div className="slider-row">
        <span className="slider-label">rwnd ceiling</span>
        <input
          type="range" min="10" max="140" step="5" value={rwnd}
          onChange={e => setRwnd(Number(e.target.value))}
          className="flex-1 accent-blue-600"
        />
        <span className="slider-value">{rwnd} MSS</span>
      </div>
      <p className="font-mono text-[10px] viz-muted mb-5">
        cwnd is the sender&rsquo;s own guess about the network. rwnd is the receiver&rsquo;s hard limit.
        You send min() of the two, so pull this down and cwnd stops mattering.
      </p>

      <div className="sim-log mb-4">
        {view.log.length === 0
          ? <div className="viz-muted">press play — cwnd starts at IW10 and doubles every RTT until it hits ssthresh</div>
          : view.log.map((line, i) => <div key={i}>{line}</div>)}
      </div>

      <div className="flex flex-wrap gap-2">
        <button className={running ? 'btn-sim-danger' : 'btn-sim-accent'} onClick={() => setRunning(r => !r)}>
          {running ? 'pause' : 'play'}
        </button>
        <button className="btn-sim" onClick={step}>step one RTT</button>
        <button className="btn-sim" onClick={() => drop('fast')}>3 dup ACKs</button>
        <button className="btn-sim-danger" onClick={() => drop('rto')}>RTO timeout</button>
        <button className={compare ? 'btn-sim-accent' : 'btn-sim'} onClick={() => setCompare(v => !v)}>
          {compare ? 'hide CUBIC' : 'compare CUBIC'}
        </button>
        <button className="btn-sim ml-auto" onClick={reset}>reset</button>
      </div>
    </div>
  )
}

const W = 660
const H = 250
const PAD = { top: 14, right: 16, bottom: 26, left: 40 }

function Chart({ history, events, compare, rwnd }) {
  const rounds = history.map(h => h.round)
  const r0 = rounds[0]
  const r1 = Math.max(rounds[rounds.length - 1], r0 + 12)
  const peak = Math.max(
    rwnd,
    ...history.map(h => Math.max(h.reno, compare ? h.cubic : 0, h.ssthresh === Infinity ? 0 : h.ssthresh))
  )
  // Round to a multiple of 20 so the quarter-point gridlines land on integers.
  const yMax = Math.ceil((peak * 1.12) / 20) * 20

  const x = r => PAD.left + ((r - r0) / (r1 - r0)) * (W - PAD.left - PAD.right)
  const y = v => H - PAD.bottom - (v / yMax) * (H - PAD.top - PAD.bottom)

  const line = key => history.map(h => `${x(h.round)},${y(h[key])}`).join(' ')
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(yMax * f))
  const last = history[history.length - 1]

  return (
    <svg className="sim-chart" viewBox={`0 0 ${W} ${H}`} style={{ height: H }}
         role="img" aria-label={`Congestion window over time. cwnd is currently ${last.reno.toFixed(1)} MSS, ssthresh ${last.ssthresh}.`}>
      {ticks.map(v => (
        <g key={v}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="sim-chart-grid" />
          <text x={PAD.left - 8} y={y(v) + 3} textAnchor="end" className="sim-chart-label">{v}</text>
        </g>
      ))}

      {/* the receiver's ceiling — cwnd above this line buys nothing */}
      <line x1={PAD.left} x2={W - PAD.right} y1={y(rwnd)} y2={y(rwnd)} className="sim-chart-line-muted" />
      <text x={W - PAD.right} y={y(rwnd) - 5} textAnchor="end" className="sim-chart-label">rwnd</text>

      {events.filter(e => e.round >= r0).map((e, i) => (
        <line key={i} x1={x(e.round)} x2={x(e.round)} y1={PAD.top} y2={H - PAD.bottom}
              className="sim-chart-threshold" strokeOpacity={e.kind === 'rto' ? 0.9 : 0.45} />
      ))}

      <polyline points={history.map(h => `${x(h.round)},${y(h.ssthresh)}`).join(' ')} className="sim-chart-threshold" fill="none" strokeWidth="1.5" />
      {compare && <polyline points={line('cubic')} className="sim-chart-line-alt" />}
      <polyline points={line('reno')} className="sim-chart-line" />

      <circle cx={x(last.round)} cy={y(last.reno)} r="3.5" className="sim-chart-dot" />
      {compare && <circle cx={x(last.round)} cy={y(last.cubic)} r="3.5" className="sim-chart-dot-alt" />}

      <text x={W - PAD.right} y={H - 6} textAnchor="end" className="sim-chart-label">RTT rounds</text>
      <text x={PAD.left} y={H - 6} textAnchor="start" className="sim-chart-label">segments in flight (MSS)</text>
    </svg>
  )
}

function snap(s) {
  return {
    round: s.round,
    reno: { ...s.reno },
    cubic: { ...s.cubic },
    history: s.history,
    events: s.events,
    log: s.log,
  }
}
