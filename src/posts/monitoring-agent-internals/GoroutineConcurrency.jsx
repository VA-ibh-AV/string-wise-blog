import { useEffect, useRef, useState } from 'react'

/**
 * Section 6 — unbounded buffer vs worker pool under the same load.
 *
 * Unbounded: one goroutine per connection/file watched. Under sustained
 * overload the count never stops climbing — it shows up as scheduler
 * overhead and memory growth long before anything crashes.
 * Worker pool: goroutines capped at POOL_SIZE. Excess work queues in a
 * bounded channel with an explicit policy — here, drop-oldest once the
 * queue is full — so backpressure is visible instead of hidden as memory.
 */

const TICK_MS      = 500
const MAX_HISTORY  = 70
const POOL_SIZE     = 32
const QUEUE_CAP     = 64
const SERVICE_RATE  = 30   // items a worker pool can drain per tick, in aggregate

const STACK_KB = 8   // typical goroutine stack, generalized estimate

function Chart({ data, cap }) {
  const width = 660, height = 190
  const padding = { top: 12, right: 16, bottom: 24, left: 46 }
  const plotW = width - padding.left - padding.right
  const plotH = height - padding.top - padding.bottom
  const minTick = data[0]?.tick ?? 0
  const maxTick = Math.max(data[data.length - 1]?.tick ?? 1, minTick + 10)
  const maxVal = Math.max(cap ? cap * 1.3 : 0, ...data.map(d => d.goroutines), 40)
  const x = t => padding.left + ((t - minTick) / (maxTick - minTick)) * plotW
  const y = v => padding.top + (1 - v / maxVal) * plotH
  const points = data.map(d => `${x(d.tick)},${y(d.goroutines)}`).join(' ')
  const ticks = [0, 0.33, 0.66, 1].map(f => Math.round(maxVal * f))
  const last = data[data.length - 1]

  return (
    <svg className="sim-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Goroutine count over time">
      {ticks.map(v => (
        <g key={v}>
          <line x1={padding.left} x2={width - padding.right} y1={y(v)} y2={y(v)} className="sim-chart-grid" />
          <text x={padding.left - 8} y={y(v) + 3} textAnchor="end" className="sim-chart-label">{v}</text>
        </g>
      ))}
      {cap && (
        <line x1={padding.left} x2={width - padding.right} y1={y(cap)} y2={y(cap)} className="sim-chart-threshold" />
      )}
      {data.length > 1 && <polyline points={points} className="sim-chart-line" />}
      {last && <circle cx={x(last.tick)} cy={y(last.goroutines)} r="3.5" className="sim-chart-dot" />}
      <text x={width - padding.right} y={height - 5} textAnchor="end" className="sim-chart-label">tick</text>
      <text x={padding.left} y={height - 5} textAnchor="start" className="sim-chart-label">goroutines · dashed = pool cap</text>
    </svg>
  )
}

export default function GoroutineConcurrency() {
  const [design, setDesign]   = useState('unbounded')
  const [rate, setRate]       = useState(40)   // incoming connections/tick
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState([])
  const [dropped, setDropped] = useState(0)

  const stateRef = useRef({ tick: 0, goroutines: 0, queued: 0, dropped: 0, history: [] })
  const rateRef  = useRef(rate)
  rateRef.current = rate

  useEffect(() => {
    if (!running) return
    const iv = setInterval(() => {
      const s = stateRef.current
      const tick = s.tick + 1
      const incoming = rateRef.current
      let goroutines, queued, dropped

      if (design === 'unbounded') {
        // Each connection gets its own goroutine that lingers until a slow consumer drains it.
        const completed = Math.min(s.goroutines, SERVICE_RATE * 0.6)
        goroutines = Math.max(0, s.goroutines + incoming - completed)
        queued = 0
        dropped = s.dropped
      } else {
        const active = Math.min(POOL_SIZE, s.goroutines + incoming)
        const overflow = Math.max(0, s.goroutines + incoming - POOL_SIZE)
        const completedFromPool = Math.min(active, SERVICE_RATE)
        goroutines = Math.max(0, active - completedFromPool + Math.min(overflow, 0))
        queued = Math.min(QUEUE_CAP, Math.max(0, s.queued + overflow - SERVICE_RATE * 0.4))
        const overQueue = Math.max(0, (s.queued + overflow) - QUEUE_CAP)
        dropped = s.dropped + overQueue
      }

      const newHistory = [...s.history, { tick, goroutines, queued }].slice(-MAX_HISTORY)
      stateRef.current = { tick, goroutines, queued, dropped, history: newHistory }
      setHistory(newHistory)
      setDropped(dropped)
    }, TICK_MS)
    return () => clearInterval(iv)
  }, [running, design])

  const setDesignAndReset = d => {
    setDesign(d)
    setRunning(false)
    setHistory([])
    setDropped(0)
    stateRef.current = { tick: 0, goroutines: 0, queued: 0, dropped: 0, history: [] }
  }

  const last = history[history.length - 1]
  const goroutines = last?.goroutines ?? 0
  const memMB = ((goroutines * STACK_KB) / 1024).toFixed(1)
  const cap = design === 'pool' ? POOL_SIZE : null

  return (
    <div className="viz-card">
      <p className="viz-title">↳ unbounded goroutines vs a bounded worker pool</p>

      <div className="flex flex-wrap gap-2 mb-5">
        <button className={design === 'unbounded' ? 'btn-sim-accent' : 'btn-sim'} onClick={() => setDesignAndReset('unbounded')}>
          one goroutine per connection
        </button>
        <button className={design === 'pool' ? 'btn-sim-accent' : 'btn-sim'} onClick={() => setDesignAndReset('pool')}>
          worker pool ({POOL_SIZE}) + bounded queue ({QUEUE_CAP})
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className={`stat-card`}>
          <div className={`stat-value text-lg ${design === 'unbounded' && goroutines > POOL_SIZE * 3 ? 'text-rose-600' : ''}`}>{Math.round(goroutines)}</div>
          <div className="stat-label">goroutines</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-lg text-accent-600">{memMB}MB</div>
          <div className="stat-label">est. stack memory ({STACK_KB}KB each)</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value text-lg ${dropped > 0 ? 'text-rose-600' : ''}`}>
            {design === 'pool' ? Math.round(last?.queued ?? 0) : '—'}
          </div>
          <div className="stat-label">{design === 'pool' ? 'queued (visible backpressure)' : 'no queue — memory absorbs it'}</div>
        </div>
      </div>

      <div className="bg-zinc-50 rounded-xl border border-zinc-100 p-4 mb-5">
        <p className="font-mono text-[10px] text-zinc-400 uppercase tracking-widest mb-3">runtime.NumGoroutine() over time</p>
        {history.length < 2 ? (
          <div className="h-44 flex items-center justify-center">
            <p className="font-mono text-xs text-zinc-400">{running ? 'collecting data…' : 'press start to begin'}</p>
          </div>
        ) : (
          <Chart data={history} cap={cap} />
        )}
      </div>

      <div className="slider-row">
        <label className="slider-label">incoming connections/tick</label>
        <input type="range" min="5" max="120" step="5" value={rate} onChange={e => setRate(+e.target.value)} className="flex-1 accent-accent-600" />
        <span className="slider-value">{rate}</span>
      </div>

      <p className="font-mono text-[11px] viz-dim mt-3 mb-4">
        {design === 'unbounded'
          ? `Every connection spawns its own goroutine. If the consumer can't keep pace with ${rate}/tick incoming, the count only ever grows — this shows up in pprof's goroutine profile as thousands blocked on the same channel send long before anything OOMs.`
          : `Concurrency is capped at ${POOL_SIZE} regardless of load. Past that, work waits in a bounded channel — backpressure you can see and alert on — and once the queue itself is full (${fmt(dropped)} dropped so far), the drop policy is explicit instead of accidental.`}
      </p>
      {design === 'pool' && dropped > 0 && (
        <p className="font-mono text-[10px] mb-4" style={{ color: '#ef6b73' }}>
          {fmt(dropped)} items dropped — the queue policy is doing its job of failing loudly instead of growing memory silently.
        </p>
      )}

      <div className="flex gap-2">
        <button className={running ? 'btn-sim-danger' : 'btn-sim-accent'} onClick={() => setRunning(r => !r)}>
          {running ? '⏸ pause' : '▶ start simulation'}
        </button>
        <button className="btn-sim" onClick={() => setDesignAndReset(design)}>reset</button>
      </div>
    </div>
  )
}

function fmt(n) { return Math.round(n).toLocaleString('en-US') }
