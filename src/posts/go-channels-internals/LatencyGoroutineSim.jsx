import { useEffect, useRef, useState } from 'react'

/**
 * Section 7.0 — the 2am page. p99 climbs because requests are stuck waiting
 * to send a result on a channel: the consumer that drains it died or blocked
 * earlier, sendq backs up, and every new request queues behind the backlog.
 * Latency and goroutine count climb together because they're the same cause.
 */

const TICK_MS = 500
const MAX_HISTORY = 60
const BASE_LATENCY = 4
const INCOMING = 9

function Chart({ data }) {
  const width = 660, height = 190
  const padding = { top: 12, right: 16, bottom: 24, left: 16 }
  const plotW = width - padding.left - padding.right
  const plotH = height - padding.top - padding.bottom
  const minTick = data[0]?.tick ?? 0
  const maxTick = Math.max(data[data.length - 1]?.tick ?? 1, minTick + 10)
  const maxLat = Math.max(...data.map(d => d.latency), 20)
  const maxGor = Math.max(...data.map(d => d.goroutines), 20)
  const x = t => padding.left + ((t - minTick) / (maxTick - minTick)) * plotW
  const yNorm = v => padding.top + (1 - v) * plotH
  const latPts = data.map(d => `${x(d.tick)},${yNorm(d.latency / maxLat)}`).join(' ')
  const gorPts = data.map(d => `${x(d.tick)},${yNorm(d.goroutines / maxGor)}`).join(' ')

  return (
    <svg className="sim-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="p99 latency and goroutine count over time, each normalized to its own peak">
      {[0, 0.5, 1].map(f => (
        <line key={f} x1={padding.left} x2={width - padding.right} y1={yNorm(f)} y2={yNorm(f)} className="sim-chart-grid" />
      ))}
      {data.length > 1 && <polyline points={latPts} className="sim-chart-line" />}
      {data.length > 1 && <polyline points={gorPts} className="sim-chart-line-alt" />}
      <text x={padding.left} y={height - 5} textAnchor="start" className="sim-chart-label">— p99 latency &nbsp;&nbsp; - - goroutines (each normalized to its own peak)</text>
    </svg>
  )
}

export default function LatencyGoroutineSim() {
  const [alive, setAlive]     = useState(true)
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState([])
  const stateRef = useRef({ tick: 0, latency: BASE_LATENCY, goroutines: 12, history: [] })
  const aliveRef = useRef(alive)
  aliveRef.current = alive

  useEffect(() => {
    if (!running) return
    const iv = setInterval(() => {
      const s = stateRef.current
      const tick = s.tick + 1
      let goroutines, latency
      if (aliveRef.current) {
        goroutines = Math.max(8, s.goroutines + (Math.random() * 2 - 1))
        latency = BASE_LATENCY + Math.random() * 1.5
      } else {
        goroutines = s.goroutines + INCOMING
        latency = BASE_LATENCY + goroutines * 0.55
      }
      const newHistory = [...s.history, { tick, latency, goroutines }].slice(-MAX_HISTORY)
      stateRef.current = { tick, latency, goroutines, history: newHistory }
      setHistory(newHistory)
    }, TICK_MS)
    return () => clearInterval(iv)
  }, [running])

  const reset = () => {
    setRunning(false); setAlive(true)
    setHistory([])
    stateRef.current = { tick: 0, latency: BASE_LATENCY, goroutines: 12, history: [] }
  }

  const last = history[history.length - 1]

  return (
    <div className="viz-card">
      <p className="viz-title">↳ consumer stalls → sendq backs up → every request queues behind it</p>

      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="stat-card">
          <div className={`stat-value text-lg ${last && last.latency > 40 ? 'text-rose-600' : ''}`}>{last ? last.latency.toFixed(0) : BASE_LATENCY}ms</div>
          <div className="stat-label">p99 latency</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value text-lg ${last && last.goroutines > 60 ? 'text-rose-600' : ''}`}>{last ? Math.round(last.goroutines) : 12}</div>
          <div className="stat-label">goroutines in chansend()</div>
        </div>
      </div>

      <div className="bg-zinc-50 rounded-xl border border-zinc-100 p-4 mb-5">
        {history.length < 2
          ? <div className="h-44 flex items-center justify-center"><p className="font-mono text-xs text-zinc-400">{running ? 'collecting data…' : 'press start'}</p></div>
          : <Chart data={history} />}
      </div>

      <p className="font-mono text-[11px] viz-dim mb-4">
        {alive
          ? 'Consumer draining normally — latency and goroutine count both sit flat.'
          : 'Consumer stopped. Every new request still starts a goroutine that tries to send its result — none of them can, so both graphs climb together. A goroutine profile at this point shows hundreds parked in chansend(), all pointing at the one consumer that stopped calling receive.'}
      </p>

      <div className="flex flex-wrap gap-2">
        <button className={alive ? 'btn-sim-danger' : 'btn-sim-success'} onClick={() => setAlive(a => !a)}>
          {alive ? 'kill the consumer' : 'revive the consumer'}
        </button>
        <button className={running ? 'btn-sim-danger' : 'btn-sim-accent'} onClick={() => setRunning(r => !r)}>
          {running ? '⏸ pause' : '▶ start'}
        </button>
        <button className="btn-sim ml-auto" onClick={reset}>reset</button>
      </div>
    </div>
  )
}
