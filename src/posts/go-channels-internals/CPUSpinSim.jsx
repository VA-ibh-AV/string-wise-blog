import { useEffect, useRef, useState } from 'react'

/**
 * Section 7.4 — a CPU alert with flat traffic. select{default:} added "to
 * make it non-blocking" turns an idle park into a busy-poll: instead of
 * gopark() until data arrives, the goroutine calls chanrecv's non-blocking
 * fast path every iteration of a for loop and never sleeps between tries.
 */

const TICK_MS = 400
const MAX_HISTORY = 50

function Chart({ data }) {
  const width = 660, height = 170
  const padding = { top: 12, right: 16, bottom: 24, left: 30 }
  const plotW = width - padding.left - padding.right
  const plotH = height - padding.top - padding.bottom
  const minTick = data[0]?.tick ?? 0
  const maxTick = Math.max(data[data.length - 1]?.tick ?? 1, minTick + 10)
  const x = t => padding.left + ((t - minTick) / (maxTick - minTick)) * plotW
  const y = v => padding.top + (1 - v / 100) * plotH
  const pts = data.map(d => `${x(d.tick)},${y(d.cpu)}`).join(' ')

  return (
    <svg className="sim-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="single core CPU utilization over time">
      {[0, 50, 100].map(v => (
        <g key={v}>
          <line x1={padding.left} x2={width - padding.right} y1={y(v)} y2={y(v)} className="sim-chart-grid" />
          <text x={padding.left - 6} y={y(v) + 3} textAnchor="end" className="sim-chart-label">{v}%</text>
        </g>
      ))}
      {data.length > 1 && <polyline points={pts} className="sim-chart-line" />}
    </svg>
  )
}

export default function CPUSpinSim() {
  const [spinning, setSpinning] = useState(false)
  const [running, setRunning]   = useState(false)
  const [history, setHistory]   = useState([])
  const stateRef = useRef({ tick: 0, cpu: 2, iters: 0, history: [] })
  const spinRef = useRef(spinning)
  spinRef.current = spinning

  useEffect(() => {
    if (!running) return
    const iv = setInterval(() => {
      const s = stateRef.current
      const tick = s.tick + 1
      const target = spinRef.current ? 98 : 2
      const cpu = s.cpu + (target - s.cpu) * 0.5
      const iters = spinRef.current ? s.iters + 4_200_000 + Math.random() * 300_000 : 0
      const newHistory = [...s.history, { tick, cpu }].slice(-MAX_HISTORY)
      stateRef.current = { tick, cpu, iters, history: newHistory }
      setHistory(newHistory)
    }, TICK_MS)
    return () => clearInterval(iv)
  }, [running])

  const reset = () => {
    setRunning(false); setSpinning(false)
    setHistory([])
    stateRef.current = { tick: 0, cpu: 2, iters: 0, history: [] }
  }

  const last = history[history.length - 1]

  return (
    <div className="viz-card">
      <p className="viz-title">↳ select{'{'} default: {'}'} turning an idle wait into a busy-poll</p>

      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="stat-card">
          <div className={`stat-value text-lg ${last && last.cpu > 80 ? 'text-rose-600' : ''}`}>{last ? last.cpu.toFixed(0) : 2}%</div>
          <div className="stat-label">core 3 utilization</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-lg">{spinning ? `${(stateRef.current.iters / 1e6).toFixed(1)}M/s` : '—'}</div>
          <div className="stat-label">loop iterations/sec</div>
        </div>
      </div>

      <div className="bg-zinc-50 rounded-xl border border-zinc-100 p-4 mb-5">
        {history.length < 2
          ? <div className="h-40 flex items-center justify-center"><p className="font-mono text-xs text-zinc-400">{running ? 'collecting data…' : 'press start'}</p></div>
          : <Chart data={history} />}
      </div>

      <p className="font-mono text-[11px] viz-dim mb-4">
        {spinning
          ? 'for { select { case v := <-ch: … ; default: } } — chanrecv finds nothing, default fires, the loop goes right back around. No gopark(), no scheduling, one core pegged regardless of traffic.'
          : 'for { select { case v := <-ch: … } } — no default, so an empty channel parks the goroutine. Zero traffic costs zero CPU.'}
      </p>

      <div className="flex flex-wrap gap-2">
        <button className={spinning ? 'btn-sim-danger' : 'btn-sim-accent'} onClick={() => setSpinning(s => !s)}>
          {spinning ? 'remove the default: case' : 'add a default: case'}
        </button>
        <button className={running ? 'btn-sim-danger' : 'btn-sim-success'} onClick={() => setRunning(r => !r)}>
          {running ? '⏸ pause' : '▶ start'}
        </button>
        <button className="btn-sim ml-auto" onClick={reset}>reset</button>
      </div>
    </div>
  )
}
