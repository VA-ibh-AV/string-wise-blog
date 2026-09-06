import { useEffect, useRef, useState } from 'react'

/**
 * Section 7.1 — a memory alert where the heap profile alone is misleading.
 * The growth isn't from allocations directly, it's from goroutines parked in
 * sendq/recvq, each still holding whatever it was about to send — a closure,
 * a request context, a buffer. The goroutine never returns, so none of that
 * is ever collected. Heap and goroutine count climb in lockstep; allocation
 * *rate* doesn't move, which is what makes this one easy to miss.
 */

const TICK_MS = 500
const MAX_HISTORY = 60
const RETAINED_KB = 6 // avg bytes each stuck goroutine pins, in KB

function Chart({ data }) {
  const width = 660, height = 190
  const padding = { top: 12, right: 16, bottom: 24, left: 16 }
  const plotW = width - padding.left - padding.right
  const plotH = height - padding.top - padding.bottom
  const minTick = data[0]?.tick ?? 0
  const maxTick = Math.max(data[data.length - 1]?.tick ?? 1, minTick + 10)
  const maxHeap = Math.max(...data.map(d => d.heap), 20)
  const maxGor  = Math.max(...data.map(d => d.goroutines), 20)
  const x = t => padding.left + ((t - minTick) / (maxTick - minTick)) * plotW
  const yNorm = v => padding.top + (1 - v) * plotH
  const heapPts = data.map(d => `${x(d.tick)},${yNorm(d.heap / maxHeap)}`).join(' ')
  const gorPts  = data.map(d => `${x(d.tick)},${yNorm(d.goroutines / maxGor)}`).join(' ')

  return (
    <svg className="sim-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="heap size and goroutine count over time, each normalized to its own peak">
      {[0, 0.5, 1].map(f => (
        <line key={f} x1={padding.left} x2={width - padding.right} y1={yNorm(f)} y2={yNorm(f)} className="sim-chart-grid" />
      ))}
      {data.length > 1 && <polyline points={heapPts} className="sim-chart-line" />}
      {data.length > 1 && <polyline points={gorPts} className="sim-chart-line-alt" />}
      <text x={padding.left} y={height - 5} textAnchor="start" className="sim-chart-label">— heap in use &nbsp;&nbsp; - - goroutine count (each normalized to its own peak)</text>
    </svg>
  )
}

export default function HeapGoroutineCorrelation() {
  const [leaking, setLeaking] = useState(false)
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState([])
  const stateRef = useRef({ tick: 0, heap: 40, goroutines: 20, history: [] })
  const leakingRef = useRef(leaking)
  leakingRef.current = leaking

  useEffect(() => {
    if (!running) return
    const iv = setInterval(() => {
      const s = stateRef.current
      const tick = s.tick + 1
      let goroutines, heap
      if (!leakingRef.current) {
        goroutines = 20 + Math.random() * 3
        heap = 40 + Math.random() * 4 // GC keeps the live set flat — allocation rate is unchanged
      } else {
        goroutines = s.goroutines + 4
        heap = 40 + goroutines * RETAINED_KB / 100 // RSS/heap tracks pinned-goroutine count, not alloc rate
      }
      const newHistory = [...s.history, { tick, heap, goroutines }].slice(-MAX_HISTORY)
      stateRef.current = { tick, heap, goroutines, history: newHistory }
      setHistory(newHistory)
    }, TICK_MS)
    return () => clearInterval(iv)
  }, [running])

  const reset = () => {
    setRunning(false); setLeaking(false)
    setHistory([])
    stateRef.current = { tick: 0, heap: 40, goroutines: 20, history: [] }
  }

  const last = history[history.length - 1]

  return (
    <div className="viz-card">
      <p className="viz-title">↳ pprof heap vs. pprof goroutine — correlate, don't read alone</p>

      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="stat-card">
          <div className={`stat-value text-lg ${last && last.heap > 100 ? 'text-rose-600' : ''}`}>{last ? last.heap.toFixed(0) : 40}MB</div>
          <div className="stat-label">heap in use</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value text-lg ${last && last.goroutines > 100 ? 'text-rose-600' : ''}`}>{last ? Math.round(last.goroutines) : 20}</div>
          <div className="stat-label">live goroutines</div>
        </div>
      </div>

      <div className="bg-zinc-50 rounded-xl border border-zinc-100 p-4 mb-5">
        {history.length < 2
          ? <div className="h-44 flex items-center justify-center"><p className="font-mono text-xs text-zinc-400">{running ? 'collecting data…' : 'press start'}</p></div>
          : <Chart data={history} />}
      </div>

      <p className="font-mono text-[11px] viz-dim mb-4">
        {!leaking
          ? 'Steady state — allocation rate is flat, so both heap and goroutine count sit flat with GC doing its job.'
          : `Leaking. Nothing here allocates faster — alloc_objects in a heap profile alone wouldn't move. What grows is the number of goroutines parked in sendq/recvq, each pinning ~${RETAINED_KB}KB of closures and context it was about to send. Overlay pprof heap on pprof goroutine and the two lines move together — that's the tell an allocation-rate alert misses.`}
      </p>

      <div className="flex flex-wrap gap-2">
        <button className={leaking ? 'btn-sim-danger' : 'btn-sim-success'} onClick={() => setLeaking(l => !l)}>
          {leaking ? 'stop the leak' : 'start leaking senders'}
        </button>
        <button className={running ? 'btn-sim-danger' : 'btn-sim-accent'} onClick={() => setRunning(r => !r)}>
          {running ? '⏸ pause' : '▶ start'}
        </button>
        <button className="btn-sim ml-auto" onClick={reset}>reset</button>
      </div>
    </div>
  )
}
