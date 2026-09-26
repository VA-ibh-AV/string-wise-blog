import { useMemo, useState } from 'react'
import { simulateJitter, STRATEGIES, CLIENTS, BUCKET_MS, CAP_PER_BUCKET, BASE_MS, CAP_MS } from './jitter'
import { C } from './charts'

/**
 * Section 3: one row per client, one dot per attempt, all four strategies
 * computed up front on the same seed so the time axis is shared and the
 * shapes compare honestly. "re-roll" picks a new seed.
 */

const W = 660
const PAD_L = 8, PAD_R = 8
const ROW_H = 5
const HIST_H = 90

export default function JitterPlayground() {
  const [strategy, setStrategy] = useState('none')
  const [seed, setSeed] = useState(3)
  const runs = useMemo(() => Object.fromEntries(STRATEGIES.map(s => [s.id, simulateJitter(s.id, seed)])), [seed])
  const run = runs[strategy]
  const maxT = Math.max(...Object.values(runs).map(r => r.doneAt)) + BUCKET_MS
  const x = t => PAD_L + (t / maxT) * (W - PAD_L - PAD_R)
  const bw = (BUCKET_MS / maxT) * (W - PAD_L - PAD_R)
  const histMax = CLIENTS
  const info = STRATEGIES.find(s => s.id === strategy)
  const ticks = []
  for (let s = 0; s * 1000 <= maxT; s += maxT > 6000 ? 2 : 1) ticks.push(s)

  return (
    <div className="viz-card">
      <p className="viz-title">↳ jitter playground — {CLIENTS} clients fail at t=0</p>

      <div className="flex flex-wrap gap-2 mb-4">
        {STRATEGIES.map(s => (
          <button key={s.id} className={strategy === s.id ? 'btn-sim-accent' : 'btn-sim'} onClick={() => setStrategy(s.id)}>{s.label}</button>
        ))}
        <button className="btn-sim ml-auto" onClick={() => setSeed(s => s + 1)}>re-roll</button>
      </div>
      <p className="font-mono text-[11px] viz-dim mb-4">{info.formula} &nbsp;·&nbsp; base {BASE_MS}ms, cap {CAP_MS / 1000}s</p>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="stat-card">
          <div className="stat-value text-lg">{run.peak}</div>
          <div className="stat-label">peak retries / 100ms</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-lg">{run.calls}</div>
          <div className="stat-label">total calls</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-lg">{(run.doneAt / 1000).toFixed(1)}s</div>
          <div className="stat-label">until all succeed</div>
        </div>
      </div>

      <div className="viz-panel">
        <svg viewBox={`0 0 ${W} ${CLIENTS * ROW_H + 6}`} className="block w-full" role="img" aria-label={`attempt timeline per client, ${info.label} jitter`}>
          {ticks.map(s => <line key={s} x1={x(s * 1000)} x2={x(s * 1000)} y1={0} y2={CLIENTS * ROW_H + 6} className="sim-chart-grid" />)}
          {run.rows.map((row, i) => row.map((a, j) => (
            <circle key={`${i}-${j}`} cx={x(a.t)} cy={i * ROW_H + 5} r={1.9} fill={a.ok ? C.ok : C.bad} opacity={a.ok ? 1 : 0.75} />
          )))}
        </svg>
        <svg viewBox={`0 0 ${W} ${HIST_H + 18}`} className="block w-full mt-2" role="img" aria-label="arrivals per 100ms bucket">
          <line x1={PAD_L} x2={W - PAD_R} y1={HIST_H - (CAP_PER_BUCKET / histMax) * HIST_H} y2={HIST_H - (CAP_PER_BUCKET / histMax) * HIST_H} className="sim-chart-threshold" />
          {run.buckets.map((n, i) => n > 0 && (
            <rect key={i} x={x(i * BUCKET_MS)} y={HIST_H - (n / histMax) * HIST_H} width={Math.max(1, bw - 0.6)} height={(n / histMax) * HIST_H}
              fill={n > CAP_PER_BUCKET ? C.bad : C.accent} opacity={0.8} />
          ))}
          {ticks.map(s => <text key={s} x={x(s * 1000)} y={HIST_H + 14} textAnchor="middle" className="sim-chart-label">{s}s</text>)}
        </svg>
        <p className="font-mono text-[10px] viz-muted mt-2">
          top: one row per client, <span style={{ color: C.bad }}>●</span> rejected, <span style={{ color: C.ok }}>●</span> succeeded.
          bottom: arrivals per 100ms; dashed line = the {CAP_PER_BUCKET} the server accepts per bucket.
        </p>
      </div>
    </div>
  )
}
