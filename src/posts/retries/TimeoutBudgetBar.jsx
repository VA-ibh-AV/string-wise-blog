import { useState } from 'react'
import { C } from './charts'

/**
 * Section 6: one bar per hop, on a shared time axis. A hop's work can only
 * matter while every caller above it is still waiting. Anything past the
 * tightest caller deadline is orphaned: it still costs the dependency, and
 * nobody will read the answer.
 */

const HOPS_GOOD = [
  { name: 'user / browser', timeout: 2000 },
  { name: 'API gateway',    timeout: 1800 },
  { name: 'service A',      timeout: 1500 },
  { name: 'service B',      timeout: 1000 },
  { name: 'database query', timeout: 800 },
]
const HOPS_BAD = [
  { name: 'user / browser', timeout: 2000 },
  { name: 'API gateway',    timeout: 1800 },
  { name: 'service A',      timeout: 3000, note: '3 attempts × 1s' },
  { name: 'service B',      timeout: 5000, note: 'library default' },
  { name: 'database query', timeout: 6000, note: 'no timeout set' },
]
const HOP_DELAY = 20 // ms each hop adds before it calls the next
const AXIS = 6000
const W = 660, LABEL_W = 120, ROW = 30

export default function TimeoutBudgetBar() {
  const [bad, setBad] = useState(false)
  const hops = bad ? HOPS_BAD : HOPS_GOOD
  const x = t => LABEL_W + (Math.min(t, AXIS) / AXIS) * (W - LABEL_W - 12)

  let deadline = Infinity
  const rows = hops.map((h, i) => {
    const start = i * HOP_DELAY
    const end = start + h.timeout
    const live = Math.min(end, deadline)
    deadline = live
    return { ...h, start, end, live, orphan: Math.max(0, end - live) }
  })
  const wasted = rows.reduce((a, r) => a + r.orphan, 0)

  return (
    <div className="viz-card">
      <p className="viz-title">↳ timeout budget per hop</p>
      <div className="viz-panel mb-4">
        <svg viewBox={`0 0 ${W} ${rows.length * ROW + 26}`} className="block w-full" role="img" aria-label="timeout per hop on a shared time axis">
          {[0, 1000, 2000, 3000, 4000, 5000, 6000].map(t => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={0} y2={rows.length * ROW} className="sim-chart-grid" />
              <text x={x(t)} y={rows.length * ROW + 16} textAnchor="middle" className="sim-chart-label">{t / 1000}s</text>
            </g>
          ))}
          {rows.map((r, i) => (
            <g key={r.name}>
              <text x={0} y={i * ROW + 19} className="sim-chart-label">{r.name}</text>
              <rect x={x(r.start)} y={i * ROW + 7} width={Math.max(1, x(r.live) - x(r.start))} height={16} rx={4} fill={C.accent} opacity={0.75} />
              {r.orphan > 0 && (
                <rect x={x(r.live)} y={i * ROW + 7} width={Math.max(1, x(r.end) - x(r.live))} height={16} rx={4} fill={C.bad} opacity={0.55} />
              )}
              <text x={Math.min(x(r.end), W - 12) - 4} y={i * ROW + 19} textAnchor="end" style={{ fill: 'var(--surface-solid)', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600 }}>
                {r.note || `${r.timeout}ms`}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <p className="font-mono text-[11px] viz-dim mb-4">
        {bad
          ? `red = work that keeps running after its caller gave up: ${(wasted / 1000).toFixed(1)}s of orphaned work for one request that the user saw fail at 2s.`
          : 'every inner timeout ends before its caller\'s. When the user gives up, everything below has already stopped.'}
      </p>
      <button className={bad ? 'btn-sim-danger' : 'btn-sim'} onClick={() => setBad(b => !b)}>
        {bad ? '✓ inner timeout > outer timeout' : 'inner timeout > outer timeout'}
      </button>
    </div>
  )
}
