import { useState } from 'react'
import { C } from './charts'

/**
 * Section 4: every layer retries on its own, so a hard failure at the bottom
 * multiplies. Calls into layer k = product of (1 + retries) of every layer
 * above it. Worst case: the database is down and every attempt fails.
 */

const LAYERS = ['client SDK', 'API gateway', 'service A', 'service B']
const W = 660
const MAX_DOTS = 243
const PER_LINE = 81

function positions(n) {
  const shown = Math.min(n, MAX_DOTS)
  if (shown <= PER_LINE) {
    const gap = (W - 40) / shown
    return Array.from({ length: shown }, (_, i) => ({ x: 20 + gap * (i + 0.5), line: 0 }))
  }
  const gap = (W - 40) / PER_LINE
  return Array.from({ length: shown }, (_, i) => ({ x: 20 + gap * ((i % PER_LINE) + 0.5), line: Math.floor(i / PER_LINE) }))
}

export default function AmplificationTree() {
  const [retries, setRetries] = useState([2, 2, 2, 2])
  const edgeOnly = retries.slice(1).every(r => r === 0)

  const setAt = (i, v) => setRetries(rs => rs.map((r, j) => (j === i ? v : r)))
  const toggleEdge = () => setRetries(rs => (edgeOnly ? [rs[0], 2, 2, 2] : [rs[0], 0, 0, 0]))

  // counts[k] = calls arriving at node k: 0 = the user click, 1..4 = gateway..database
  const counts = [1]
  retries.forEach(r => counts.push(counts[counts.length - 1] * (r + 1)))
  const names = ['user click', ...LAYERS.slice(1), 'database']
  const totalCalls = counts.slice(1).reduce((a, b) => a + b, 0)

  // layout
  let yCursor = 16
  const rows = counts.map((n, k) => {
    const pos = positions(n)
    const lines = pos.length ? pos[pos.length - 1].line + 1 : 1
    const y = yCursor
    yCursor += lines * 9 + 38
    return { n, k, pos, y }
  })
  const height = yCursor - 18

  return (
    <div className="viz-card">
      <p className="viz-title">↳ amplification tree — one click, database down</p>

      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="stat-card">
          <div className="stat-value text-lg" style={{ color: counts[4] > 3 ? C.bad : C.ok }}>{counts[4].toLocaleString()}</div>
          <div className="stat-label">calls hitting the database</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-lg">{totalCalls.toLocaleString()}</div>
          <div className="stat-label">network calls in total</div>
        </div>
      </div>

      <div className="viz-panel mb-5">
        <svg viewBox={`0 0 ${W} ${height}`} className="block w-full" role="img" aria-label={`one user request becomes ${counts[4]} database calls`}>
          {rows.slice(1).map(row => {
            const parent = rows[row.k - 1]
            if (row.n > PER_LINE || parent.n > PER_LINE) return null
            const fan = retries[row.k - 1] + 1
            return row.pos.map((p, i) => {
              const pp = parent.pos[Math.floor(i / fan)]
              return <line key={`e${row.k}-${i}`} x1={pp.x} y1={parent.y} x2={p.x} y2={row.y} stroke="var(--border)" strokeWidth={row.n > 27 ? 0.5 : 1} />
            })
          })}
          {rows.map(row => (
            <g key={row.k}>
              {row.pos.map((p, i) => (
                <circle key={i} cx={p.x} cy={row.y + p.line * 9} r={row.n > 27 ? 2.6 : 4.5}
                  fill={row.k === 4 ? (row.n > 3 ? C.bad : C.ok) : row.k === 0 ? C.accent : 'var(--ink-faint)'} />
              ))}
              <text x={4} y={row.y - 7} className="sim-chart-label">{names[row.k]}</text>
              <text x={W - 4} y={row.y - 7} textAnchor="end" className="sim-chart-label">
                {row.k === 0 ? '1' : `${row.k > 1 ? retries.slice(0, row.k).map(r => r + 1).join(' × ') + ' = ' : ''}${row.n.toLocaleString()}`}
                {row.n > MAX_DOTS ? ` (${MAX_DOTS} drawn)` : ''}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {LAYERS.map((name, i) => (
        <div className="slider-row" key={name}>
          <label className="slider-label">{name} retries</label>
          <input type="range" min="0" max="5" value={retries[i]} onChange={e => setAt(i, +e.target.value)} className="flex-1" />
          <span className="slider-value">{retries[i]} → {retries[i] + 1} tries</span>
        </div>
      ))}

      <div className="flex flex-wrap gap-2 mt-2">
        <button className={edgeOnly ? 'btn-sim-accent' : 'btn-sim'} onClick={toggleEdge}>
          {edgeOnly ? '✓ retry only at the edge' : 'retry only at the edge'}
        </button>
        <button className="btn-sim ml-auto" onClick={() => setRetries([2, 2, 2, 2])}>reset</button>
      </div>
    </div>
  )
}
