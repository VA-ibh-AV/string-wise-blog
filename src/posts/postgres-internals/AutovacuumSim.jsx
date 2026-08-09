import { useState, useEffect, useRef } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer, Legend,
} from 'recharts'

const LIVE_ROWS     = 1_000_000
const TICK_MS       = 600          // simulation step every 600ms
const MAX_HISTORY   = 80           // chart shows last 80 ticks

function fmt(n) { return n.toLocaleString() }

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

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-zinc-200 rounded-lg px-3 py-2 shadow-sm text-xs font-mono">
      <p className="text-zinc-400 mb-1">tick {label}</p>
      <p className="text-accent-600">dead: {fmt(payload[0]?.value ?? 0)}</p>
    </div>
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
          <ResponsiveContainer width="100%" height={176}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
              <XAxis
                dataKey="tick"
                tick={{ fontSize: 10, fontFamily: '"JetBrains Mono", monospace', fill: '#a1a1aa' }}
                axisLine={false}
                tickLine={false}
                label={{ value: 'tick', position: 'insideBottomRight', offset: -4, fontSize: 10, fill: '#a1a1aa', fontFamily: '"JetBrains Mono", monospace' }}
              />
              <YAxis
                tick={{ fontSize: 10, fontFamily: '"JetBrains Mono", monospace', fill: '#a1a1aa' }}
                axisLine={false}
                tickLine={false}
                width={64}
                tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}
              />
              <Tooltip content={<CustomTooltip />} />
              {/* Autovacuum trigger lines */}
              {visibleTriggers.map(t => (
                <ReferenceLine
                  key={t}
                  x={t}
                  stroke="#4C63D2"
                  strokeDasharray="4 3"
                  strokeOpacity={0.6}
                  label={{ value: '⚡', position: 'top', fontSize: 10 }}
                />
              ))}
              {/* Threshold line */}
              <ReferenceLine
                y={threshold}
                stroke="#ef4444"
                strokeDasharray="5 3"
                strokeOpacity={0.5}
                label={{ value: 'threshold', position: 'insideTopRight', fontSize: 9, fontFamily: '"JetBrains Mono", monospace', fill: '#ef4444' }}
              />
              <Line
                type="monotone"
                dataKey="dead"
                stroke="#4C63D2"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
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
