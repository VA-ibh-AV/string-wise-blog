import { useEffect, useRef, useState } from 'react'

/**
 * Section 4 — allocation rate drives GC frequency, not heap size.
 *
 * GOGC=100 (default): GC triggers when live heap doubles since the last
 * collection. Pause cost scales with the volume of live data marked, so it's
 * modeled here as roughly proportional to heap size at trigger time. The
 * before/after presets are the JSON vs MessagePack allocation rates from
 * Section 3 — one fix, and both the trigger frequency and pause time drop.
 */

const TICK_MS     = 500
const MAX_HISTORY = 70
const GOGC         = 100      // trigger when live heap doubles
const BASE_LIVE_MB = 24       // steady live heap the agent actually needs

const PRESETS = {
  before: { label: 'before — JSON encoding', allocRateMBs: 42 },
  after:  { label: 'after — MessagePack encoding', allocRateMBs: 11 },
}

function fmt1(n) { return n.toFixed(1) }

function Chart({ data, triggers }) {
  const width = 660, height = 190
  const padding = { top: 12, right: 16, bottom: 24, left: 46 }
  const plotW = width - padding.left - padding.right
  const plotH = height - padding.top - padding.bottom
  const minTick = data[0]?.tick ?? 0
  const maxTick = Math.max(data[data.length - 1]?.tick ?? 1, minTick + 10)
  const maxHeap = Math.max(BASE_LIVE_MB * 2.4, ...data.map(d => d.heap), 1)
  const x = t => padding.left + ((t - minTick) / (maxTick - minTick)) * plotW
  const y = v => padding.top + (1 - v / maxHeap) * plotH
  const points = data.map(d => `${x(d.tick)},${y(d.heap)}`).join(' ')
  const ticks = [0, 0.33, 0.66, 1].map(f => Math.round(maxHeap * f))
  const last = data[data.length - 1]
  const visibleTriggers = triggers.filter(t => t >= minTick)

  return (
    <svg className="sim-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Heap size and GC trigger events over time">
      {ticks.map(v => (
        <g key={v}>
          <line x1={padding.left} x2={width - padding.right} y1={y(v)} y2={y(v)} className="sim-chart-grid" />
          <text x={padding.left - 8} y={y(v) + 3} textAnchor="end" className="sim-chart-label">{v}MB</text>
        </g>
      ))}
      {visibleTriggers.map(t => (
        <line key={t} x1={x(t)} x2={x(t)} y1={padding.top} y2={height - padding.bottom} className="sim-chart-trigger" />
      ))}
      {data.length > 1 && <polyline points={points} className="sim-chart-line" />}
      {last && <circle cx={x(last.tick)} cy={y(last.heap)} r="3.5" className="sim-chart-dot" />}
      <text x={width - padding.right} y={height - 5} textAnchor="end" className="sim-chart-label">tick</text>
      <text x={padding.left} y={height - 5} textAnchor="start" className="sim-chart-label">heap in use · dashed = GC</text>
    </svg>
  )
}

export default function GCTraceSim() {
  const [mode, setMode]       = useState('before')
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState([])
  const [triggers, setTriggers] = useState([])
  const [stats, setStats]     = useState({ gcCount: 0, totalPauseUs: 0, lastPauseUs: 0 })

  const stateRef = useRef({ tick: 0, heap: BASE_LIVE_MB, history: [], triggers: [], gcCount: 0, totalPauseUs: 0, lastPauseUs: 0 })
  const rateRef  = useRef(PRESETS[mode].allocRateMBs)
  rateRef.current = PRESETS[mode].allocRateMBs

  useEffect(() => {
    if (!running) return
    const iv = setInterval(() => {
      const s = stateRef.current
      const tick = s.tick + 1
      const gain = rateRef.current * (TICK_MS / 1000)
      let heap = s.heap + gain
      let triggers = s.triggers
      let gcCount = s.gcCount
      let totalPauseUs = s.totalPauseUs
      let lastPauseUs = s.lastPauseUs

      const threshold = BASE_LIVE_MB * (1 + GOGC / 100)
      if (heap >= threshold) {
        // Pause cost scales with the live set being marked — bigger heap, longer STW-adjacent mark work.
        lastPauseUs = Math.round(60 + heap * 3.2)
        totalPauseUs += lastPauseUs
        gcCount += 1
        triggers = [...triggers, tick]
        heap = BASE_LIVE_MB
      }

      const newHistory = [...s.history, { tick, heap }].slice(-MAX_HISTORY)
      stateRef.current = { tick, heap, history: newHistory, triggers, gcCount, totalPauseUs, lastPauseUs }

      setHistory(newHistory)
      setTriggers(triggers)
      setStats({ gcCount, totalPauseUs, lastPauseUs })
    }, TICK_MS)
    return () => clearInterval(iv)
  }, [running, mode])

  const setModeAndReset = m => {
    setMode(m)
    setRunning(false)
    setHistory([])
    setTriggers([])
    setStats({ gcCount: 0, totalPauseUs: 0, lastPauseUs: 0 })
    stateRef.current = { tick: 0, heap: BASE_LIVE_MB, history: [], triggers: [], gcCount: 0, totalPauseUs: 0, lastPauseUs: 0 }
  }

  const elapsedSec = (stateRef.current.tick * TICK_MS) / 1000
  const gcPerSec = elapsedSec > 0 ? stats.gcCount / elapsedSec : 0

  return (
    <div className="viz-card">
      <p className="viz-title">↳ allocation rate drives GC frequency — not heap size</p>

      <div className="flex flex-wrap gap-2 mb-5">
        {Object.entries(PRESETS).map(([key, preset]) => (
          <button key={key} className={mode === key ? 'btn-sim-accent' : 'btn-sim'} onClick={() => setModeAndReset(key)}>
            {preset.label} ({preset.allocRateMBs} MB/s)
          </button>
        ))}
      </div>

      <div className="grid grid-cols-4 gap-3 mb-5">
        <div className="stat-card">
          <div className={`stat-value text-lg ${gcPerSec > 5 ? 'text-rose-600' : ''}`}>{fmt1(gcPerSec)}</div>
          <div className="stat-label">GC/sec</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-lg">{stats.lastPauseUs}µs</div>
          <div className="stat-label">last pause</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-lg text-accent-600">{stats.gcCount}</div>
          <div className="stat-label">total GC cycles</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-lg">{(stats.totalPauseUs / 1000).toFixed(2)}ms</div>
          <div className="stat-label">cumulative pause time</div>
        </div>
      </div>

      <div className="bg-zinc-50 rounded-xl border border-zinc-100 p-4 mb-5">
        <p className="font-mono text-[10px] text-zinc-400 uppercase tracking-widest mb-3">GODEBUG=gctrace=1 — heap in use, GC events as dashed lines</p>
        {history.length < 2 ? (
          <div className="h-44 flex items-center justify-center">
            <p className="font-mono text-xs text-zinc-400">{running ? 'collecting data…' : 'press start to begin'}</p>
          </div>
        ) : (
          <Chart data={history} triggers={triggers} />
        )}
      </div>

      <p className="font-mono text-[11px] viz-dim mb-4">
        GOGC=100 means: trigger a GC when the live heap has doubled since the last one. The live heap here never grows —
        it's the same {BASE_LIVE_MB}MB of real state — but a higher allocation rate reaches that doubling point faster,
        so GC fires more often. Heap size was never the driver. Allocation rate was.
      </p>

      <div className="flex gap-2">
        <button className={running ? 'btn-sim-danger' : 'btn-sim-accent'} onClick={() => setRunning(r => !r)}>
          {running ? '⏸ pause' : '▶ start simulation'}
        </button>
        <button className="btn-sim" onClick={() => setModeAndReset(mode)}>reset</button>
      </div>
    </div>
  )
}
