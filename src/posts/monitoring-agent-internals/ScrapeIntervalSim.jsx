import { useMemo, useState } from 'react'

/**
 * Section 2 — polling interval vs syscall cost.
 *
 * NUM_METRICS small reads per tick (assumes FDs are already pooled, per
 * Section 1 — this isolates the read/parse cost alone). Sweeps the whole
 * interval range for the tradeoff curve, then drops a live marker at the
 * slider's current position so the curve and the numbers agree.
 */

const NUM_METRICS   = 12     // /proc/stat, /proc/[pid]/stat, /proc/net/dev, etc.
const COST_PER_READ_US = 6   // small read + string parse, generalized estimate
const MIN_MS = 100
const MAX_MS = 15000

function syscallsPerSec(intervalMs) { return (NUM_METRICS * 1000) / intervalMs }
function cpuPct(intervalMs) {
  const busyUsPerSec = syscallsPerSec(intervalMs) * COST_PER_READ_US
  return Math.min(100, (busyUsPerSec / 10_000) * 100)
}

function fmt1(n) { return n.toFixed(n < 10 ? 2 : 1) }

function Chart({ current }) {
  const width = 660, height = 200
  const padding = { top: 14, right: 16, bottom: 26, left: 46 }
  const plotW = width - padding.left - padding.right
  const plotH = height - padding.top - padding.bottom

  const points = useMemo(() => {
    const pts = []
    for (let ms = MIN_MS; ms <= MAX_MS; ms += (MAX_MS - MIN_MS) / 120) pts.push({ ms, sps: syscallsPerSec(ms) })
    return pts
  }, [])

  const maxSps = syscallsPerSec(MIN_MS)
  const x = ms => padding.left + (Math.log(ms / MIN_MS) / Math.log(MAX_MS / MIN_MS)) * plotW
  const y = sps => padding.top + (1 - sps / maxSps) * plotH
  const line = points.map(p => `${x(p.ms)},${y(p.sps)}`).join(' ')
  const curSps = syscallsPerSec(current)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(maxSps * f))

  return (
    <svg className="sim-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Syscalls per second vs polling interval">
      {ticks.map(v => (
        <g key={v}>
          <line x1={padding.left} x2={width - padding.right} y1={y(v)} y2={y(v)} className="sim-chart-grid" />
          <text x={padding.left - 8} y={y(v) + 3} textAnchor="end" className="sim-chart-label">{v}</text>
        </g>
      ))}
      <polyline points={line} className="sim-chart-line" />
      <line x1={x(current)} x2={x(current)} y1={padding.top} y2={height - padding.bottom} className="sim-chart-trigger" strokeOpacity="0.7" />
      <circle cx={x(current)} cy={y(curSps)} r="4" className="sim-chart-dot" />
      <text x={width - padding.right} y={height - 6} textAnchor="end" className="sim-chart-label">interval (log scale, {MIN_MS}ms–{MAX_MS / 1000}s)</text>
      <text x={padding.left} y={height - 6} textAnchor="start" className="sim-chart-label">syscalls/sec</text>
    </svg>
  )
}

export default function ScrapeIntervalSim() {
  const [interval, setInterval_] = useState(1000)

  const sps = syscallsPerSec(interval)
  const cpu = cpuPct(interval)
  const staleness = interval / 2

  return (
    <div className="viz-card">
      <p className="viz-title">↳ polling interval — freshness vs syscall cost</p>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className={`stat-card`}>
          <div className={`stat-value text-lg ${sps > 60 ? 'text-rose-600' : ''}`}>{fmt1(sps)}</div>
          <div className="stat-label">syscalls/sec</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value text-lg ${cpu > 3 ? 'text-rose-600' : ''}`}>{cpu.toFixed(2)}%</div>
          <div className="stat-label">est. CPU from scraping alone</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-lg text-accent-600">{Math.round(staleness)}ms</div>
          <div className="stat-label">avg. metric staleness</div>
        </div>
      </div>

      <div className="bg-zinc-50 rounded-xl border border-zinc-100 p-4 mb-5">
        <p className="font-mono text-[10px] text-zinc-400 uppercase tracking-widest mb-3">syscalls/sec across the whole interval range</p>
        <Chart current={interval} />
      </div>

      <div className="slider-row">
        <label className="slider-label">polling interval</label>
        <input
          type="range" min={MIN_MS} max={MAX_MS} step="50"
          value={interval}
          onChange={e => setInterval_(+e.target.value)}
          className="flex-1 accent-accent-600"
        />
        <span className="slider-value">{interval >= 1000 ? `${(interval / 1000).toFixed(2)}s` : `${interval}ms`}</span>
      </div>

      <p className="font-mono text-[11px] viz-dim mt-3">
        {NUM_METRICS} metric sources read per tick, {COST_PER_READ_US}µs assumed per small read + parse. Below ~300ms the syscall
        floor alone becomes measurable CPU; above ~5s freshness starts to matter for anything alerting on the data.
        The right answer is rarely one interval for everything — batch the reads that share a tick, and give cheap,
        low-priority metrics (disk labels, static host tags) a much slower interval than CPU or memory.
      </p>
    </div>
  )
}
