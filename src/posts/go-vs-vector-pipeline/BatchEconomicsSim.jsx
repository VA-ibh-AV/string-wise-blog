import { useMemo, useState } from 'react'

/**
 * Section 5 — batch size under a fixed concurrency ceiling, plus the
 * worker-vs-partition mismatch in the parse/bridge service.
 *
 * Throughput model: each bulk request pays a fixed overhead (network RTT,
 * HTTP framing, ES coordinating-node fan-out) plus a per-event cost, and
 * only `CONC` requests are ever in flight:
 *
 *   events/s = CONC × batch / (OVERHEAD_MS + batch × PER_EVENT_MS) × 1000
 *
 * capped by a cluster-wide ingest ceiling. Constants are illustrative —
 * the shape (fixed overhead amortised away, then a plateau) is the point.
 */

const CONC         = 16
const OVERHEAD_MS  = 40
const PER_EVENT_MS = 0.012
const ES_CEILING   = 260_000
const EVENT_KB     = 2
const MAX_BATCH    = 6000
const OURS         = 250
const VECTOR       = Math.round((10 * 1024) / EVENT_KB)   // 10MB of 2KB events

function eps(batch) {
  return Math.min(ES_CEILING, (CONC * batch) / (OVERHEAD_MS + batch * PER_EVENT_MS) * 1000)
}

function Chart({ batch }) {
  const width = 660, height = 190
  const padding = { top: 14, right: 16, bottom: 24, left: 44 }
  const plotW = width - padding.left - padding.right
  const plotH = height - padding.top - padding.bottom
  const maxY = ES_CEILING * 1.1
  const points = useMemo(() => Array.from({ length: 120 }, (_, i) => 10 + (i / 119) * (MAX_BATCH - 10)).map(b => ({ b, e: eps(b) })), [])
  const x = b => padding.left + (b / MAX_BATCH) * plotW
  const y = e => padding.top + (1 - e / maxY) * plotH
  const marker = (b, label) => (
    <g>
      <line x1={x(b)} x2={x(b)} y1={padding.top} y2={height - padding.bottom} className="sim-chart-trigger" />
      <text x={x(b) + 4} y={padding.top + 10} className="sim-chart-label">{label}</text>
    </g>
  )

  return (
    <svg className="sim-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="events per second vs bulk batch size">
      {[0, 0.5, 1].map(f => (
        <g key={f}>
          <line x1={padding.left} x2={width - padding.right} y1={padding.top + f * plotH} y2={padding.top + f * plotH} className="sim-chart-grid" />
          <text x={padding.left - 6} y={padding.top + f * plotH + 3} textAnchor="end" className="sim-chart-label">{Math.round((maxY * (1 - f)) / 1000)}k</text>
        </g>
      ))}
      <line x1={padding.left} x2={width - padding.right} y1={y(ES_CEILING)} y2={y(ES_CEILING)} className="sim-chart-threshold" />
      {marker(OURS, 'ours: 250')}
      {marker(VECTOR, 'vector: 10MB')}
      <polyline points={points.map(p => `${x(p.b)},${y(p.e)}`).join(' ')} className="sim-chart-line" />
      <circle cx={x(batch)} cy={y(eps(batch))} r="4" className="sim-chart-dot" />
      <text x={padding.left} y={height - 5} className="sim-chart-label">events/s vs. events per bulk request ({CONC} in flight, {EVENT_KB}KB events)</text>
    </svg>
  )
}

function WorkerGrid({ partitions, workers }) {
  return (
    <div className="grid gap-[3px] mb-3" style={{ gridTemplateColumns: 'repeat(32, minmax(0, 1fr))' }}>
      {Array.from({ length: workers }, (_, i) => (
        <div key={i} className={`viz-cell ${i < partitions ? 'viz-cell-active' : 'viz-cell-idle'}`} style={{ height: 10 }} />
      ))}
    </div>
  )
}

export default function BatchEconomicsSim() {
  const [batch, setBatch]           = useState(OURS)
  const [partitions, setPartitions] = useState(12)
  const [workers, setWorkers]       = useState(96)

  const e = eps(batch)
  const overheadShare = OVERHEAD_MS / (OVERHEAD_MS + batch * PER_EVENT_MS)
  const idle = Math.max(0, workers - partitions)

  return (
    <div className="viz-card">
      <p className="viz-title">↳ batch economics — who pays the per-request overhead</p>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="stat-card">
          <div className="stat-value text-lg">{(e / 1000).toFixed(0)}k</div>
          <div className="stat-label">events/s</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value text-lg ${overheadShare > 0.5 ? 'text-rose-600' : ''}`}>{(overheadShare * 100).toFixed(0)}%</div>
          <div className="stat-label">of each request spent on fixed overhead</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-lg">{((batch * EVENT_KB) / 1024).toFixed(1)}MB</div>
          <div className="stat-label">bulk body size</div>
        </div>
      </div>

      <div className="viz-panel mb-5">
        <Chart batch={batch} />
      </div>

      <div className="slider-row">
        <label className="slider-label">events per bulk request</label>
        <input type="range" min="10" max={MAX_BATCH} step="10" value={batch} onChange={ev => setBatch(+ev.target.value)} className="flex-1" />
        <span className="slider-value">{batch}</span>
      </div>
      <div className="flex flex-wrap gap-2 mb-6">
        <button className={batch === OURS ? 'btn-sim-accent' : 'btn-sim'} onClick={() => setBatch(OURS)}>our cap: 250 events</button>
        <button className={batch === VECTOR ? 'btn-sim-accent' : 'btn-sim'} onClick={() => setBatch(VECTOR)}>vector default: 10MB</button>
      </div>

      <hr className="viz-hr mb-5" />

      <p className="font-mono text-[10px] viz-muted uppercase tracking-widest mb-3">parse/bridge workers vs. partitions — routing is partition % workers</p>
      <WorkerGrid partitions={partitions} workers={workers} />
      <div className="slider-row">
        <label className="slider-label">partitions on the topic</label>
        <input type="range" min="1" max="64" value={partitions} onChange={ev => setPartitions(+ev.target.value)} className="flex-1" />
        <span className="slider-value">{partitions}</span>
      </div>
      <div className="flex flex-wrap gap-2 mb-3">
        {[96, 256].map(w => (
          <button key={w} className={workers === w ? 'btn-sim-accent' : 'btn-sim'} onClick={() => setWorkers(w)}>{w} workers (hardcoded)</button>
        ))}
      </div>
      <p className="font-mono text-[11px] viz-dim">
        {Math.min(partitions, workers)} workers can ever receive work. {idle} sit idle forever, each still waking on a 10ms flush
        timer — {(idle * 100).toLocaleString('en-US')} empty wakeups/s that buy nothing.
      </p>
    </div>
  )
}
