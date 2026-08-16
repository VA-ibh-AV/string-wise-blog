import { useState, useEffect, useRef } from 'react'

const LIVE_ROWS     = 1_000_000
const TICK_MS       = 600          // simulation step every 600ms
const MAX_HISTORY   = 80           // chart shows last 80 ticks

function fmt(n) { return n.toLocaleString('en-US') }

function StatCard({ label, value, sub, color = 'text-zinc-800' }) {
  return (
    <div className="stat-card">
      <div className={`stat-value ${color}`}>{value}</div>
      {sub && <div className="font-mono text-[10px] text-zinc-400 mt-0.5">{sub}</div>}
      <div className="stat-label">{label}</div>
    </div>
  )
}

function StatusBadge({ status }) {
  const map = {
    idle:      { label: 'idle',      cls: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
    healthy:   { label: 'healthy',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    vacuuming: { label: 'vacuuming', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
    critical:  { label: 'critical',  cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  }
  const { label, cls } = map[status] ?? map.idle
  return (
    <span className={`font-mono text-xs font-semibold px-2.5 py-1 rounded-full border ${cls}`}>
      {label}
    </span>
  )
}

function SimulationChart({ data, threshold, triggers }) {
  const width = 760
  const height = 176
  const padding = { top: 12, right: 18, bottom: 24, left: 54 }
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom
  const minTick = data[0]?.tick ?? 0
  const maxTick = data[data.length - 1]?.tick ?? 1
  const maxDead = Math.max(threshold, ...data.map(point => point.dead), 1)
  const x = tick => padding.left + ((tick - minTick) / Math.max(1, maxTick - minTick)) * plotWidth
  const y = value => padding.top + (1 - value / maxDead) * plotHeight
  const points = data.map(point => `${x(point.tick)},${y(point.dead)}`).join(' ')
  const gridValues = [0, 0.33, 0.66, 1].map(ratio => Math.round(maxDead * ratio))

  return (
    <svg className="sim-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Dead tuples over time">
      {gridValues.map(value => (
        <g key={value}>
          <line x1={padding.left} x2={width - padding.right} y1={y(value)} y2={y(value)} className="sim-chart-grid" />
          <text x={padding.left - 8} y={y(value) + 3} textAnchor="end" className="sim-chart-label">{value >= 1000 ? `${Math.round(value / 1000)}k` : value}</text>
        </g>
      ))}
      {triggers.map(tick => (
        <line key={tick} x1={x(tick)} x2={x(tick)} y1={padding.top} y2={height - padding.bottom} className="sim-chart-trigger" />
      ))}
      <line x1={padding.left} x2={width - padding.right} y1={y(threshold)} y2={y(threshold)} className="sim-chart-threshold" />
      {data.length > 1 && <polyline points={points} className="sim-chart-line" />}
      {data.length > 0 && (
        <circle cx={x(data[data.length - 1].tick)} cy={y(data[data.length - 1].dead)} r="3.5" className="sim-chart-dot">
          <title>tick {data[data.length - 1].tick}: {fmt(data[data.length - 1].dead)} dead tuples</title>
        </circle>
      )}
      <text x={width - padding.right} y={height - 5} textAnchor="end" className="sim-chart-label">tick</text>
    </svg>
  )
}

export default function AutovacuumSim() {
  const [running,     setRunning]     = useState(false)
  const [updateRate,  setUpdateRate]  = useState(800)   // rows/sec
  const [scaleFactor, setScaleFactor] = useState(0.2)
  const [costDelay,   setCostDelay]   = useState(2)     // ms
  const [chartData,   setChartData]   = useState([])
  const [triggers,    setTriggers]    = useState([])    // tick numbers where vacuum fired
  const [status,      setStatus]      = useState('idle')
  const [totalVacuums, setTotalVacuums] = useState(0)

  const stateRef = useRef({
    dead:        0,
    tick:        0,
    vacuuming:   false,
    chartData:   [],
    triggers:    [],
    totalVacuums: 0,
  })

  const threshold = Math.round(50 + scaleFactor * LIVE_ROWS)
  // vacuum speed: tuples cleaned per tick, inversely proportional to cost_delay
  const vacSpeed  = Math.round(60_000 / (costDelay + 1))

  useEffect(() => {
    if (!running) return
    const interval = setInterval(() => {
      const s = stateRef.current
      const newTick = s.tick + 1
      const gain    = Math.round(updateRate * (TICK_MS / 1000))

      let newDead      = s.dead
      let newVacuuming = s.vacuuming
      let newTriggers  = [...s.triggers]
      let newTotalVac  = s.totalVacuums
      let newStatus    = 'healthy'

      if (s.vacuuming) {
        newDead = Math.max(0, newDead - vacSpeed)
        newStatus = 'vacuuming'
        if (newDead === 0) newVacuuming = false
      } else {
        newDead += gain
        if (newDead > threshold) {
          newVacuuming = true
          newStatus    = 'vacuuming'
          newTriggers  = [...newTriggers, newTick]
          newTotalVac  += 1
        } else if (newDead > threshold * 0.8) {
          newStatus = 'critical'
        }
      }

      const point = { tick: newTick, dead: newDead }
      const newChartData = [...s.chartData, point].slice(-MAX_HISTORY)

      stateRef.current = {
        dead: newDead,
        tick: newTick,
        vacuuming: newVacuuming,
        chartData: newChartData,
        triggers: newTriggers,
        totalVacuums: newTotalVac,
      }

      setChartData([...newChartData])
      setTriggers([...newTriggers])
      setStatus(newStatus)
      setTotalVacuums(newTotalVac)
    }, TICK_MS)

    return () => clearInterval(interval)
  }, [running, updateRate, scaleFactor, costDelay, threshold, vacSpeed])

  const handleReset = () => {
    setRunning(false)
    setChartData([])
    setTriggers([])
    setStatus('idle')
    setTotalVacuums(0)
    stateRef.current = { dead: 0, tick: 0, vacuuming: false, chartData: [], triggers: [], totalVacuums: 0 }
  }

  const currentDead = stateRef.current.dead
  const bloat = Math.round((currentDead / (currentDead + LIVE_ROWS)) * 100)

  // Only show last few trigger lines on chart to avoid clutter
  const visibleTicks    = chartData.map(d => d.tick)
  const minTick         = visibleTicks[0] ?? 0
  const visibleTriggers = triggers.filter(t => t >= minTick).slice(-5)

  return (
    <div className="viz-card">
      <p className="viz-title">↳ autovacuum race simulator</p>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <StatCard
          label="Dead tuples"
          value={fmt(currentDead)}
          color={currentDead > threshold ? 'text-rose-600' : 'text-zinc-800'}
        />
        <StatCard
          label="Threshold"
          value={fmt(threshold)}
          sub={`scale=${scaleFactor}`}
          color="text-zinc-500"
        />
        <StatCard
          label="Bloat"
          value={`${bloat}%`}
          color={bloat > 10 ? 'text-rose-600' : 'text-emerald-600'}
        />
        <StatCard
          label="Vacuums run"
          value={totalVacuums}
          color="text-accent-600"
        />
      </div>

      {/* Status */}
      <div className="flex items-center gap-3 mb-5">
        <StatusBadge status={running ? status : 'idle'} />
        {running && status === 'vacuuming' && (
          <span className="font-mono text-xs text-sky-600">
            cleaning ~{fmt(vacSpeed)} tuples/tick
          </span>
        )}
        {running && status === 'critical' && (
          <span className="font-mono text-xs text-rose-600">
            approaching threshold — vacuum will fire soon
          </span>
        )}
      </div>

      {/* Chart */}
      <div className="bg-zinc-50 rounded-xl border border-zinc-100 p-4 mb-5">
        <p className="font-mono text-[10px] text-zinc-400 uppercase tracking-widest mb-3">
          dead tuples over time
        </p>
        {chartData.length < 2 ? (
          <div className="h-44 flex items-center justify-center">
            <p className="font-mono text-xs text-zinc-400">
              {running ? 'collecting data…' : 'press start to begin simulation'}
            </p>
          </div>
        ) : (
          <SimulationChart data={chartData} threshold={threshold} triggers={visibleTriggers} />
        )}
        <p className="font-mono text-[10px] text-zinc-400 mt-2">
          ⚡ blue dashed lines = autovacuum trigger events · red dashed = threshold
        </p>
      </div>

      {/* Sliders */}
      <div className="bg-zinc-50 rounded-xl border border-zinc-100 p-4 mb-5 space-y-3">
        <p className="font-mono text-[10px] text-zinc-400 uppercase tracking-widest mb-3">
          parameters
        </p>

        <div className="slider-row">
          <label className="slider-label">update_rate (rows/sec)</label>
          <input
            type="range" min="100" max="5000" step="100"
            value={updateRate}
            onChange={e => setUpdateRate(+e.target.value)}
            className="flex-1 accent-accent-600"
          />
          <span className="slider-value">{fmt(updateRate)}</span>
        </div>

        <div className="slider-row">
          <label className="slider-label">autovacuum_vacuum_scale_factor</label>
          <input
            type="range" min="0.01" max="0.5" step="0.01"
            value={scaleFactor}
            onChange={e => setScaleFactor(+e.target.value)}
            className="flex-1 accent-accent-600"
          />
          <span className="slider-value">{scaleFactor.toFixed(2)}</span>
        </div>

        <div className="slider-row">
          <label className="slider-label">autovacuum_vacuum_cost_delay (ms)</label>
          <input
            type="range" min="0" max="20" step="1"
            value={costDelay}
            onChange={e => setCostDelay(+e.target.value)}
            className="flex-1 accent-accent-600"
          />
          <span className="slider-value">{costDelay}ms</span>
        </div>

        <div className="pt-1 border-t border-zinc-200">
          <p className="font-mono text-[10px] text-zinc-500">
            trigger formula:  dead &gt; <span className="text-accent-600">50</span> + (<span className="text-accent-600">{scaleFactor.toFixed(2)}</span> × {fmt(LIVE_ROWS)}) = <span className="text-accent-600">{fmt(threshold)}</span>
          </p>
          <p className="font-mono text-[10px] text-zinc-500 mt-1">
            vacuum speed: ~<span className="text-accent-600">{fmt(vacSpeed)}</span> tuples/tick &nbsp;·&nbsp; table size: {fmt(LIVE_ROWS)} live rows
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex gap-2">
        <button
          className={running ? 'btn-sim-danger' : 'btn-sim-accent'}
          onClick={() => setRunning(r => !r)}
        >
          {running ? '⏸ pause' : '▶ start simulation'}
        </button>
        <button className="btn-sim" onClick={handleReset}>reset</button>
      </div>
    </div>
  )
}
