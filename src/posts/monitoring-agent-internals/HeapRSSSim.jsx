import { useEffect, useRef, useState } from 'react'

/**
 * Section 5 — RSS vs Go heap-in-use, sawtooth vs staircase.
 *
 * Healthy: heap-in-use oscillates as GC reclaims garbage each cycle (sawtooth),
 * RSS sits slightly above the peak and stays flat — Go doesn't hand pages back
 * to the OS immediately, so a stable RSS-heap gap is normal, not a leak.
 * Problem: something retains references (a growing slice, a cache with no
 * eviction, goroutines piling up) so the post-GC floor itself keeps rising —
 * a staircase. RSS climbs in lockstep because the OS never sees any pages to
 * reclaim from.
 */

const TICK_MS     = 500
const MAX_HISTORY = 70
const GC_PERIOD    = 6        // ticks between GC cycles

const PATTERNS = {
  healthy: { label: 'healthy — sawtooth', floorDrift: 0,   growthPerTick: 9  },
  leak:    { label: 'problem — staircase', floorDrift: 2.2, growthPerTick: 6 },
}

function Chart({ data }) {
  const width = 660, height = 210
  const padding = { top: 14, right: 16, bottom: 26, left: 46 }
  const plotW = width - padding.left - padding.right
  const plotH = height - padding.top - padding.bottom
  const minTick = data[0]?.tick ?? 0
  const maxTick = Math.max(data[data.length - 1]?.tick ?? 1, minTick + 10)
  const maxVal = Math.max(...data.map(d => d.rss), 40)
  const x = t => padding.left + ((t - minTick) / (maxTick - minTick)) * plotW
  const y = v => padding.top + (1 - v / maxVal) * plotH
  const rssLine = data.map(d => `${x(d.tick)},${y(d.rss)}`).join(' ')
  const heapLine = data.map(d => `${x(d.tick)},${y(d.heap)}`).join(' ')
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(maxVal * f))
  const last = data[data.length - 1]

  return (
    <svg className="sim-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="RSS and heap-in-use over time">
      {ticks.map(v => (
        <g key={v}>
          <line x1={padding.left} x2={width - padding.right} y1={y(v)} y2={y(v)} className="sim-chart-grid" />
          <text x={padding.left - 8} y={y(v) + 3} textAnchor="end" className="sim-chart-label">{v}MB</text>
        </g>
      ))}
      {data.length > 1 && <polyline points={rssLine} className="sim-chart-line-alt" />}
      {data.length > 1 && <polyline points={heapLine} className="sim-chart-line" />}
      {last && <circle cx={x(last.tick)} cy={y(last.rss)} r="3.5" className="sim-chart-dot-alt" />}
      {last && <circle cx={x(last.tick)} cy={y(last.heap)} r="3.5" className="sim-chart-dot" />}
      <text x={width - padding.right} y={height - 6} textAnchor="end" className="sim-chart-label">tick</text>
      <text x={padding.left} y={height - 6} textAnchor="start" className="sim-chart-label">MB resident</text>
    </svg>
  )
}

export default function HeapRSSSim() {
  const [pattern, setPattern] = useState('healthy')
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState([])

  const stateRef = useRef({ tick: 0, heap: 30, rssHigh: 34, history: [] })

  useEffect(() => {
    if (!running) return
    const p = PATTERNS[pattern]
    const iv = setInterval(() => {
      const s = stateRef.current
      const tick = s.tick + 1
      let heap = s.heap + p.growthPerTick
      let rssHigh = s.rssHigh

      const floor = 30 + (tick / GC_PERIOD) * p.floorDrift
      if (tick % GC_PERIOD === 0) heap = floor

      // Go returns memory to the OS lazily — RSS tracks the historical peak, not the current heap.
      rssHigh = Math.max(rssHigh, heap + 4)

      const newHistory = [...s.history, { tick, heap, rss: rssHigh }].slice(-MAX_HISTORY)
      stateRef.current = { tick, heap, rssHigh, history: newHistory }
      setHistory(newHistory)
    }, TICK_MS)
    return () => clearInterval(iv)
  }, [running, pattern])

  const setPatternAndReset = p => {
    setPattern(p)
    setRunning(false)
    setHistory([])
    stateRef.current = { tick: 0, heap: 30, rssHigh: 34, history: [] }
  }

  const last = history[history.length - 1]
  const gap = last ? (last.rss - last.heap).toFixed(0) : 0

  return (
    <div className="viz-card">
      <p className="viz-title">↳ RSS vs heap-in-use — sawtooth vs staircase</p>

      <div className="flex flex-wrap gap-2 mb-5">
        {Object.entries(PATTERNS).map(([key, p]) => (
          <button key={key} className={pattern === key ? 'btn-sim-accent' : 'btn-sim'} onClick={() => setPatternAndReset(key)}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <span className="font-mono text-[10px] flex items-center gap-1.5" style={{ color: 'var(--accent)' }}>
          <span style={{ width: 16, height: 2, background: 'var(--accent)', display: 'inline-block' }} /> heap in use (pprof)
        </span>
        <span className="font-mono text-[10px] flex items-center gap-1.5" style={{ color: 'var(--green)' }}>
          <span style={{ width: 16, height: 2, background: 'var(--green)', display: 'inline-block', borderTop: '2px dashed var(--green)' }} /> RSS (VmRSS)
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="stat-card">
          <div className="stat-value text-lg text-accent-600">{last?.heap.toFixed(0) ?? 0}MB</div>
          <div className="stat-label">heap in use</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-lg" style={{ color: 'var(--green)' }}>{last?.rss.toFixed(0) ?? 0}MB</div>
          <div className="stat-label">RSS</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value text-lg ${pattern === 'leak' ? 'text-rose-600' : ''}`}>{gap}MB</div>
          <div className="stat-label">RSS − heap gap</div>
        </div>
      </div>

      <div className="bg-zinc-50 rounded-xl border border-zinc-100 p-4 mb-5">
        {history.length < 2 ? (
          <div className="h-44 flex items-center justify-center">
            <p className="font-mono text-xs text-zinc-400">{running ? 'collecting data…' : 'press start to begin'}</p>
          </div>
        ) : (
          <Chart data={history} />
        )}
      </div>

      <p className="font-mono text-[11px] viz-dim mb-4">
        {pattern === 'healthy'
          ? `Heap sawtooths between the same floor and ceiling every GC cycle — the live set isn't growing. RSS holds flat slightly above the ceiling, because Go doesn't return freed pages to the OS on every collection. A stable gap here is normal.`
          : `The post-GC floor itself climbs every cycle — something is retaining references the live set doesn't actually need (an unbounded cache, a growing slice, goroutines that never exit). RSS climbs in lockstep because there's never anything for the OS to reclaim. pprof heap diff (-base) between two points in time is the fastest way to see what grew.`}
      </p>
    </div>
  )
}
