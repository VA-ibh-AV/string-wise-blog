import { useEffect, useRef, useState } from 'react'

/**
 * Section 1 — file descriptor churn vs a genuine leak.
 *
 * The pedagogical point: an FD-count graph looks IDENTICAL for a pooled
 * (healthy) scraper and a churning one that reopens the same files every
 * tick. Only the syscall rate gives churn away — which is why `lsof` looks
 * fine while `strace -c` shows a wall of open()/close() pairs. A real leak,
 * by contrast, shows up on the FD-count graph itself.
 */

const NUM_FILES   = 12   // /proc/stat, /proc/net/dev, per-pid stat, log tails...
const TICK_MS     = 700
const MAX_HISTORY = 60

const MODES = {
  pooled: { label: 'pooled (open once, reuse)', opens: 0, closes: 0, reads: NUM_FILES, fdDelta: 0 },
  churn:  { label: 'churn (reopen every scrape)', opens: NUM_FILES, closes: NUM_FILES, reads: NUM_FILES, fdDelta: 0 },
  leak:   { label: 'leak (open, never close)', opens: NUM_FILES, closes: 0, reads: NUM_FILES, fdDelta: NUM_FILES },
}

function fmt(n) { return n.toLocaleString('en-US') }

function Chart({ data, mode }) {
  const width = 660, height = 176
  const padding = { top: 12, right: 16, bottom: 24, left: 46 }
  const plotW = width - padding.left - padding.right
  const plotH = height - padding.top - padding.bottom
  const minTick = data[0]?.tick ?? 0
  const maxTick = Math.max(data[data.length - 1]?.tick ?? 1, minTick + 10)
  const maxFd = Math.max(NUM_FILES * 4, ...data.map(d => d.fdCount), 1)
  const x = t => padding.left + ((t - minTick) / (maxTick - minTick)) * plotW
  const y = v => padding.top + (1 - v / maxFd) * plotH
  const points = data.map(d => `${x(d.tick)},${y(d.fdCount)}`).join(' ')
  const ticks = [0, 0.33, 0.66, 1].map(f => Math.round(maxFd * f))
  const last = data[data.length - 1]

  return (
    <svg className="sim-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Open file descriptor count over time">
      {ticks.map(v => (
        <g key={v}>
          <line x1={padding.left} x2={width - padding.right} y1={y(v)} y2={y(v)} className="sim-chart-grid" />
          <text x={padding.left - 8} y={y(v) + 3} textAnchor="end" className="sim-chart-label">{v}</text>
        </g>
      ))}
      {data.length > 1 && <polyline points={points} className="sim-chart-line" />}
      {last && (
        <circle cx={x(last.tick)} cy={y(last.fdCount)} r="3.5" className="sim-chart-dot">
          <title>tick {last.tick}: {fmt(last.fdCount)} open FDs</title>
        </circle>
      )}
      <text x={width - padding.right} y={height - 5} textAnchor="end" className="sim-chart-label">tick</text>
      <text x={padding.left} y={height - 5} textAnchor="start" className="sim-chart-label">open FDs</text>
    </svg>
  )
}

export default function FDChurnSim() {
  const [mode, setMode]         = useState('churn')
  const [running, setRunning]   = useState(false)
  const [history, setHistory]   = useState([])
  const [syscalls, setSyscalls] = useState(0)
  const [cumulative, setCumulative] = useState(0)

  const stateRef = useRef({ tick: 0, fdCount: 0, history: [], cumulative: 0 })

  useEffect(() => {
    if (!running) return
    const interval = setInterval(() => {
      const s = stateRef.current
      const m = MODES[mode]
      const tick = s.tick + 1
      const fdCount = mode === 'leak' ? s.fdCount + m.fdDelta : NUM_FILES
      const thisTickSyscalls = m.opens + m.closes + m.reads
      const history = [...s.history, { tick, fdCount }].slice(-MAX_HISTORY)
      const cumulative = s.cumulative + thisTickSyscalls

      stateRef.current = { tick, fdCount, history, cumulative }
      setHistory(history)
      setSyscalls(thisTickSyscalls)
      setCumulative(cumulative)
    }, TICK_MS)
    return () => clearInterval(interval)
  }, [running, mode])

  const setModeAndReset = m => {
    setMode(m)
    setRunning(false)
    setHistory([])
    setSyscalls(0)
    setCumulative(0)
    stateRef.current = { tick: 0, fdCount: 0, history: [], cumulative: 0 }
  }

  const reset = () => setModeAndReset(mode)
  const current = MODES[mode]
  const lastFd = history[history.length - 1]?.fdCount ?? 0

  return (
    <div className="viz-card">
      <p className="viz-title">↳ FD count vs syscall rate — they tell different stories</p>

      <div className="flex flex-wrap gap-2 mb-5">
        {Object.entries(MODES).map(([key, m]) => (
          <button key={key} className={mode === key ? 'btn-sim-accent' : 'btn-sim'} onClick={() => setModeAndReset(key)}>
            {m.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="stat-card">
          <div className={`stat-value text-lg ${mode === 'leak' && lastFd > NUM_FILES * 3 ? 'text-rose-600' : ''}`}>{fmt(lastFd)}</div>
          <div className="stat-label">open FDs right now</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value text-lg ${mode === 'churn' ? 'text-rose-600' : ''}`}>{fmt(syscalls)}</div>
          <div className="stat-label">syscalls this tick</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-lg text-accent-600">{fmt(cumulative)}</div>
          <div className="stat-label">cumulative syscalls</div>
        </div>
      </div>

      <div className="bg-zinc-50 rounded-xl border border-zinc-100 p-4 mb-5">
        <p className="font-mono text-[10px] text-zinc-400 uppercase tracking-widest mb-3">open file descriptors over time</p>
        {history.length < 2 ? (
          <div className="h-44 flex items-center justify-center">
            <p className="font-mono text-xs text-zinc-400">{running ? 'collecting data…' : 'press start to begin'}</p>
          </div>
        ) : (
          <Chart data={history} mode={mode} />
        )}
      </div>

      <p className="font-mono text-[11px] viz-dim mb-4">
        {mode === 'pooled' && `Files opened once, held open, read every tick. ${fmt(current.reads)} read() calls per tick, no open()/close() at all.`}
        {mode === 'churn' && `FD count graph looks IDENTICAL to pooled — steady at ${NUM_FILES}. But every scrape does ${fmt(current.opens)} open() + ${fmt(current.reads)} read() + ${fmt(current.closes)} close() calls. lsof shows nothing wrong. strace -c -p PID shows the real cost.`}
        {mode === 'leak' && `Every scrape opens ${fmt(current.opens)} new descriptors and never closes them. FD count climbs without bound — this is the pattern that eventually hits ulimit -n and the process starts failing to open sockets or log files.`}
      </p>

      <div className="flex gap-2">
        <button className={running ? 'btn-sim-danger' : 'btn-sim-accent'} onClick={() => setRunning(r => !r)}>
          {running ? '⏸ pause' : '▶ start simulation'}
        </button>
        <button className="btn-sim" onClick={reset}>reset</button>
      </div>
    </div>
  )
}
