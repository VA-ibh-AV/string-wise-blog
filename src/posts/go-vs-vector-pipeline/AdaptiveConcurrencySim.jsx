import { useEffect, useRef, useState } from 'react'

/**
 * Section 4 — a fixed ESWorkers semaphore vs. Vector-style Adaptive Request
 * Concurrency (AIMD) against the same simulated Elasticsearch cluster.
 *
 * The cluster is a model, not a benchmark: it serves up to `cap` concurrent
 * bulk requests at base latency, queues anything past that (RTT grows
 * linearly), and starts answering 429s once it's overloaded. "Slowdown"
 * scales latency up and capacity down together — the shape of a cluster
 * that's merging segments, GC-ing, or losing a node.
 *
 * ARC side follows src/sinks/util/adaptive_concurrency/controller.rs in
 * Vector: +1 per RTT window while the window's mean RTT is at or below the
 * EWMA (alpha 0.4), ×0.9 when RTT climbs past mean + 2.5σ or any response
 * in the window was retryable (429, 5xx, timeout), clamped to [1, 200].
 * Simplified here to a fixed-ratio RTT threshold.
 *
 * Both sides hold their slot through retry backoff: in Vector the Retry
 * layer sits inside AdaptiveConcurrencyLimit (src/sinks/util/service.rs),
 * the same as the retry loop inside our semaphore.
 */

const TICK_MS      = 220
const MAX_HISTORY  = 90
const STATIC_N     = 16
const ARC_MAX      = 200
const BASE_LAT_MS  = 40
const BASE_CAP     = 64
const BACKOFF_MS   = 500
const EWMA_ALPHA   = 0.4
const DECREASE     = 0.9

function cluster(slow) {
  return { lat: BASE_LAT_MS * slow, cap: Math.max(4, Math.round(BASE_CAP / slow)) }
}
const rttAt = (c, cl) => cl.lat * Math.max(1, c / cl.cap)
const overloadErr = (c, cl) => (c > cl.cap ? Math.min(0.6, ((c - cl.cap) / cl.cap) * 0.8) : 0)

// successful bulk requests per second at concurrency c
function throughput(c, cl, transientErr) {
  const rtt = rttAt(c, cl)
  const err = Math.min(0.95, transientErr + overloadErr(c, cl))
  // a failed attempt keeps its slot through the backoff sleep (retry sits inside the limit)
  const slotMs = rtt + err * BACKOFF_MS
  return (c / slotMs) * 1000 * (1 - err)
}

function Chart({ data }) {
  const width = 660, height = 190
  const padding = { top: 12, right: 16, bottom: 24, left: 44 }
  const plotW = width - padding.left - padding.right
  const plotH = height - padding.top - padding.bottom
  const minTick = data[0]?.tick ?? 0
  const maxTick = Math.max(data[data.length - 1]?.tick ?? 1, minTick + 20)
  const maxY = Math.max(200, ...data.map(d => Math.max(d.arc, d.fixed))) * 1.1
  const x = t => padding.left + ((t - minTick) / (maxTick - minTick)) * plotW
  const y = v => padding.top + (1 - v / maxY) * plotH
  const line = key => data.map(d => `${x(d.tick)},${y(d[key])}`).join(' ')

  return (
    <svg className="sim-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="successful bulk requests per second, fixed semaphore vs adaptive concurrency">
      {[0, 0.5, 1].map(f => (
        <g key={f}>
          <line x1={padding.left} x2={width - padding.right} y1={padding.top + f * plotH} y2={padding.top + f * plotH} className="sim-chart-grid" />
          <text x={padding.left - 6} y={padding.top + f * plotH + 3} textAnchor="end" className="sim-chart-label">{Math.round(maxY * (1 - f))}</text>
        </g>
      ))}
      {data.length > 1 && <polyline points={line('fixed')} className="sim-chart-line" />}
      {data.length > 1 && <polyline points={line('arc')} className="sim-chart-line-alt" />}
      <text x={padding.left} y={height - 5} className="sim-chart-label">successful bulk req/s over time — solid: fixed {STATIC_N}, dashed: ARC</text>
    </svg>
  )
}

const initialState = () => ({ tick: 0, arcC: 1, ewma: BASE_LAT_MS, history: [], lastEvent: 'ramping from concurrency 1' })

export default function AdaptiveConcurrencySim() {
  const [slow, setSlow]       = useState(1)
  const [errPct, setErrPct]   = useState(0)
  const [running, setRunning] = useState(false)
  const [snap, setSnap]       = useState(initialState)
  const stateRef  = useRef(initialState())
  const paramsRef = useRef({ slow, errPct })
  paramsRef.current = { slow, errPct }

  useEffect(() => {
    if (!running) return
    const iv = setInterval(() => {
      const s = stateRef.current
      const { slow, errPct } = paramsRef.current
      const cl = cluster(slow)
      const transient = errPct / 100

      // one ARC observation window
      const c = Math.round(s.arcC)
      const rtt = rttAt(c, cl) * (1 + (Math.random() - 0.5) * 0.06)
      const overloaded = Math.random() < overloadErr(c, cl) * 8
      // any retryable response in the window counts: P(at least one of c requests failed)
      const transientHit = Math.random() < 1 - Math.pow(1 - transient, c)
      let arcC = s.arcC, lastEvent
      if (overloaded || transientHit) {
        arcC = Math.max(1, Math.floor(s.arcC * DECREASE))
        lastEvent = `${overloaded ? '429' : '5xx'} in window at ${c} in flight — ×${DECREASE} to ${arcC}`
      } else if (rtt > s.ewma * 1.15) {
        arcC = Math.max(1, Math.floor(s.arcC * DECREASE)); lastEvent = `RTT ${rtt.toFixed(0)}ms above EWMA ${s.ewma.toFixed(0)}ms — ×${DECREASE} to ${arcC}`
      } else {
        arcC = Math.min(ARC_MAX, s.arcC + 1); lastEvent = `RTT steady at ${rtt.toFixed(0)}ms — +1 to ${arcC}`
      }
      const ewma = s.ewma + EWMA_ALPHA * (rtt - s.ewma)

      const tick = s.tick + 1
      const point = {
        tick,
        fixed: throughput(STATIC_N, cl, transient),
        arc:   throughput(c, cl, transient),
        arcC:  c,
      }
      const history = [...s.history, point].slice(-MAX_HISTORY)
      stateRef.current = { tick, arcC, ewma, history, lastEvent }
      setSnap(stateRef.current)
    }, TICK_MS)
    return () => clearInterval(iv)
  }, [running])

  const reset = () => {
    setRunning(false)
    stateRef.current = initialState()
    setSnap(stateRef.current)
  }

  const cl = cluster(slow)
  const last = snap.history[snap.history.length - 1]
  const fixedZone = STATIC_N < cl.cap ? 'under' : STATIC_N === cl.cap ? 'exact' : 'over'

  return (
    <div className="viz-card">
      <p className="viz-title">↳ fixed ESWorkers=16 vs. adaptive request concurrency</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <div className="stat-card">
          <div className="stat-value text-lg">{last ? last.fixed.toFixed(0) : '—'}</div>
          <div className="stat-label">fixed-16 req/s</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-lg text-emerald-600">{last ? last.arc.toFixed(0) : '—'}</div>
          <div className="stat-label">ARC req/s</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-lg">{last ? last.arcC : 1}</div>
          <div className="stat-label">ARC in flight</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-lg">{cl.cap}</div>
          <div className="stat-label">cluster's real capacity</div>
        </div>
      </div>

      <div className="viz-panel mb-5">
        {snap.history.length < 2
          ? <div className="h-44 flex items-center justify-center"><p className="font-mono text-xs viz-muted">{running ? 'collecting data…' : 'press start'}</p></div>
          : <Chart data={snap.history} />}
      </div>

      <div className="slider-row">
        <label className="slider-label">ES slowdown</label>
        <input type="range" min="1" max="6" step="0.5" value={slow} onChange={e => setSlow(+e.target.value)} className="flex-1" />
        <span className="slider-value">{slow}×</span>
      </div>
      <div className="slider-row">
        <label className="slider-label">transient 5xx rate</label>
        <input type="range" min="0" max="30" value={errPct} onChange={e => setErrPct(+e.target.value)} className="flex-1" />
        <span className="slider-value">{errPct}%</span>
      </div>

      <p className="font-mono text-[11px] viz-dim mb-2">
        cluster: {cl.lat}ms base RTT, {cl.cap} concurrent bulk requests before it queues.{' '}
        {fixedZone === 'under' && `The fixed limit of ${STATIC_N} leaves ${cl.cap - STATIC_N} slots of headroom unused — no amount of load will ever push past it.`}
        {fixedZone === 'exact' && `The fixed limit of ${STATIC_N} happens to match — the only slowdown setting where the constant is right.`}
        {fixedZone === 'over' && `The fixed limit of ${STATIC_N} now exceeds what the cluster can take: queueing, 429s, and retries that make it worse.`}
      </p>
      <p className="font-mono text-[11px] viz-muted mb-4">ARC: {snap.lastEvent}</p>

      <div className="flex flex-wrap gap-2">
        <button className={running ? 'btn-sim-danger' : 'btn-sim-success'} onClick={() => setRunning(r => !r)}>
          {running ? '⏸ pause' : '▶ start'}
        </button>
        <button className="btn-sim ml-auto" onClick={reset}>reset</button>
      </div>
    </div>
  )
}
