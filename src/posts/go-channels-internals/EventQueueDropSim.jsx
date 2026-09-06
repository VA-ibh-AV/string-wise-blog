import { useEffect, useRef, useState } from 'react'

/**
 * Section 7.10 — a bounded event-queue channel under load. Once qcount hits
 * dataqsiz there are exactly two policies: block the send (backpressure onto
 * whatever's producing events — the hot path you're trying not to slow down)
 * or drop it (data loss, but the hot path never stalls). Neither is free;
 * the chart makes the tradeoff visible instead of implicit.
 */

const CAP = 200
const TICK_MS = 400
const MAX_HISTORY = 50
const BASE_RATE  = 60
const SPIKE_RATE = 340
const DRAIN_RATE = 180

function Chart({ data, metric }) {
  const width = 660, height = 170
  const padding = { top: 12, right: 16, bottom: 24, left: 40 }
  const plotW = width - padding.left - padding.right
  const plotH = height - padding.top - padding.bottom
  const minTick = data[0]?.tick ?? 0
  const maxTick = Math.max(data[data.length - 1]?.tick ?? 1, minTick + 10)
  const maxV = Math.max(...data.map(d => d[metric]), 10)
  const x = t => padding.left + ((t - minTick) / (maxTick - minTick)) * plotW
  const y = v => padding.top + (1 - v / maxV) * plotH
  const pts = data.map(d => `${x(d.tick)},${y(d[metric])}`).join(' ')

  return (
    <svg className="sim-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${metric} over time`}>
      {[0, 0.5, 1].map(f => (
        <g key={f}>
          <line x1={padding.left} x2={width - padding.right} y1={padding.top + f * plotH} y2={padding.top + f * plotH} className="sim-chart-grid" />
          <text x={padding.left - 6} y={padding.top + f * plotH + 3} textAnchor="end" className="sim-chart-label">{Math.round(maxV * (1 - f))}</text>
        </g>
      ))}
      <polyline points={pts} className="sim-chart-line" />
    </svg>
  )
}

export default function EventQueueDropSim() {
  const [policy, setPolicy]   = useState('drop') // 'drop' | 'block'
  const [spike, setSpike]     = useState(false)
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState([])
  const stateRef = useRef({ tick: 0, len: 0, dropped: 0, hotPathMs: 0.1, history: [] })
  const cfgRef = useRef({ policy, spike })
  cfgRef.current = { policy, spike }

  useEffect(() => {
    if (!running) return
    const iv = setInterval(() => {
      const s = stateRef.current
      const { policy: p, spike: sp } = cfgRef.current
      const tick = s.tick + 1
      const incoming = sp ? SPIKE_RATE : BASE_RATE
      const room = CAP - s.len

      let len, dropped, hotPathMs
      if (p === 'drop') {
        const accepted = Math.min(incoming, room + DRAIN_RATE)
        len = Math.min(CAP, Math.max(0, s.len + accepted - DRAIN_RATE))
        dropped = s.dropped + Math.max(0, incoming - accepted)
        hotPathMs = 0.1
      } else {
        len = Math.min(CAP, Math.max(0, s.len + incoming - DRAIN_RATE))
        dropped = s.dropped
        const overflow = Math.max(0, incoming - DRAIN_RATE - room)
        hotPathMs = len >= CAP ? 0.1 + overflow * 0.4 : 0.1
      }
      const newHistory = [...s.history, { tick, len, dropped, hotPathMs }].slice(-MAX_HISTORY)
      stateRef.current = { tick, len, dropped, hotPathMs, history: newHistory }
      setHistory(newHistory)
    }, TICK_MS)
    return () => clearInterval(iv)
  }, [running])

  const reset = () => {
    setRunning(false); setSpike(false)
    setHistory([])
    stateRef.current = { tick: 0, len: 0, dropped: 0, hotPathMs: 0.1, history: [] }
  }

  const last = history[history.length - 1]
  const len = last?.len ?? 0
  const full = len >= CAP

  return (
    <div className="viz-card">
      <p className="viz-title">↳ bounded chan Event, {CAP} — block the hot path, or drop the event</p>

      <div className="flex flex-wrap gap-2 mb-5">
        <button className={policy === 'drop' ? 'btn-sim-accent' : 'btn-sim'} onClick={() => setPolicy('drop')}>policy: drop when full</button>
        <button className={policy === 'block' ? 'btn-sim-accent' : 'btn-sim'} onClick={() => setPolicy('block')}>policy: block send when full</button>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="stat-card">
          <div className={`stat-value text-lg ${full ? 'text-rose-600' : ''}`}>{Math.round(len)}/{CAP}</div>
          <div className="stat-label">qcount/dataqsiz</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value text-lg ${last && last.dropped > 0 ? 'text-rose-600' : ''}`}>{last ? Math.round(last.dropped) : 0}</div>
          <div className="stat-label">events dropped</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value text-lg ${last && last.hotPathMs > 5 ? 'text-rose-600' : ''}`}>{last ? last.hotPathMs.toFixed(1) : '0.1'}ms</div>
          <div className="stat-label">added hot-path latency</div>
        </div>
      </div>

      <div className="bg-zinc-50 rounded-xl border border-zinc-100 p-4 mb-5">
        {history.length < 2
          ? <div className="h-40 flex items-center justify-center"><p className="font-mono text-xs text-zinc-400">{running ? 'collecting data…' : 'press start'}</p></div>
          : <Chart data={history} metric={policy === 'drop' ? 'dropped' : 'hotPathMs'} />}
      </div>

      <p className="font-mono text-[11px] viz-dim mb-4">
        {policy === 'drop'
          ? 'Full queue → select { case q <- ev: default: dropCounter.Inc() }. The thing being monitored never slows down; a drop-rate alert is the only signal anything was lost.'
          : 'Full queue → q <- ev blocks. No data loss, but the send now waits behind however much backlog is queued — latency the caller didn\'t ask for, injected straight into its hot path.'}
      </p>

      <div className="flex flex-wrap gap-2">
        <button className={spike ? 'btn-sim-danger' : 'btn-sim-accent'} onClick={() => setSpike(s => !s)}>
          {spike ? 'end load spike' : 'trigger load spike'}
        </button>
        <button className={running ? 'btn-sim-danger' : 'btn-sim-success'} onClick={() => setRunning(r => !r)}>
          {running ? '⏸ pause' : '▶ start'}
        </button>
        <button className="btn-sim ml-auto" onClick={reset}>reset</button>
      </div>
    </div>
  )
}
