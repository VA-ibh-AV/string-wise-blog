import { useMemo, useState } from 'react'

/**
 * Section 7.7 — chan struct{} as a semaphore. The buffer size is the
 * concurrency limit: acquire is a send into the buffer, release is a
 * receive that frees a slot. Size it below the downstream's real ceiling
 * and you serialize work that could run in parallel; size it above and the
 * buffer stops limiting anything — every extra slot is just another
 * goroutine queued on the same downstream resource, holding memory for no
 * throughput gain.
 */

const CEILING   = 16   // downstream's real safe concurrency, e.g. DB pool size
const BASE_RATE = 9    // req/s one concurrent worker can push through the downstream
const MAX_N     = 48
const STACK_KB  = 8

function throughputFor(n) {
  const effective = Math.min(n, CEILING)
  if (n <= CEILING) return effective * BASE_RATE
  const overshoot = n - CEILING
  return Math.max(effective * BASE_RATE * (1 - overshoot * 0.012), effective * BASE_RATE * 0.55)
}

function Chart({ n }) {
  const width = 660, height = 190
  const padding = { top: 12, right: 16, bottom: 24, left: 40 }
  const plotW = width - padding.left - padding.right
  const plotH = height - padding.top - padding.bottom
  const maxThroughput = CEILING * BASE_RATE * 1.05
  const points = useMemo(() => Array.from({ length: MAX_N }, (_, i) => i + 1).map(v => ({ v, t: throughputFor(v) })), [])
  const x = v => padding.left + ((v - 1) / (MAX_N - 1)) * plotW
  const y = t => padding.top + (1 - t / maxThroughput) * plotH
  const pts = points.map(p => `${x(p.v)},${y(p.t)}`).join(' ')
  const cur = points[n - 1]

  return (
    <svg className="sim-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="throughput vs semaphore buffer size">
      {[0, 0.5, 1].map(f => (
        <line key={f} x1={padding.left} x2={width - padding.right} y1={padding.top + f * plotH} y2={padding.top + f * plotH} className="sim-chart-grid" />
      ))}
      <line x1={x(CEILING)} x2={x(CEILING)} y1={padding.top} y2={height - padding.bottom} className="sim-chart-threshold" />
      <text x={x(CEILING) + 4} y={padding.top + 10} className="sim-chart-label">downstream ceiling ({CEILING})</text>
      <polyline points={pts} className="sim-chart-line" />
      {cur && <circle cx={x(cur.v)} cy={y(cur.t)} r="4" className="sim-chart-dot" />}
      <text x={padding.left} y={height - 5} textAnchor="start" className="sim-chart-label">throughput (req/s) vs. semaphore size N</text>
    </svg>
  )
}

export default function SemaphoreSizingSim() {
  const [n, setN] = useState(4)
  const throughput = throughputFor(n)
  const memMB = ((n * STACK_KB) / 1024).toFixed(2)
  const zone = n < CEILING ? 'under' : n === CEILING ? 'right-sized' : 'over'

  return (
    <div className="viz-card">
      <p className="viz-title">↳ sem := make(chan struct{}, N) — sizing the limiter</p>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="stat-card">
          <div className="stat-value text-lg">{throughput.toFixed(0)}/s</div>
          <div className="stat-label">throughput</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value text-lg ${zone === 'over' ? 'text-rose-600' : ''}`}>{memMB}MB</div>
          <div className="stat-label">stacks held at N in flight</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value text-lg ${zone === 'right-sized' ? 'text-emerald-600' : zone === 'over' ? 'text-rose-600' : 'text-amber-600'}`}>
            {zone === 'under' ? 'serialized' : zone === 'right-sized' ? 'right-sized' : 'over-provisioned'}
          </div>
          <div className="stat-label">zone</div>
        </div>
      </div>

      <div className="bg-zinc-50 rounded-xl border border-zinc-100 p-4 mb-5">
        <Chart n={n} />
      </div>

      <div className="slider-row">
        <label className="slider-label">semaphore buffer size N</label>
        <input type="range" min="1" max={MAX_N} value={n} onChange={e => setN(+e.target.value)} className="flex-1 accent-accent-600" />
        <span className="slider-value">{n}</span>
      </div>

      <p className="font-mono text-[11px] viz-dim">
        {zone === 'under' && `N=${n} caps concurrency below what the downstream (${CEILING}) can safely take — work that could run in parallel serializes instead.`}
        {zone === 'right-sized' && `N=${CEILING} matches the downstream ceiling — maximum throughput, no goroutine holds a token it can't use.`}
        {zone === 'over' && `N=${n} exceeds the downstream ceiling of ${CEILING} — throughput has already flattened (contention on the real resource), and every extra slot is another goroutine's stack and closure sitting in memory for no gain. This is how a semaphore "defeats the limiter" without ever looking wrong in the code.`}
      </p>
    </div>
  )
}
