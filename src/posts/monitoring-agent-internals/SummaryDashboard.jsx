import { useEffect, useRef, useState } from 'react'

/**
 * Section 7 — cumulative before/after across every fix in the post.
 *
 * Numbers match the presets used in each section's own visualizer (GC
 * alloc rate, RSS pattern, goroutine cap) so a reader who played with all
 * seven arrives here and recognizes them, rather than meeting a fresh set
 * of unexplained figures.
 */

const METRICS = [
  { key: 'cpu',       label: 'steady-state CPU (fleet avg)', before: 18,   after: 6,    unit: '%',      decimals: 0 },
  { key: 'alloc',     label: 'allocation rate',               before: 42,   after: 11,   unit: ' MB/s',  decimals: 0 },
  { key: 'gc',        label: 'GC frequency',                   before: 9.0,  after: 2.3,  unit: '/sec',   decimals: 1 },
  { key: 'rss',       label: 'RSS (steady state)',             before: 340,  after: 130,  unit: 'MB',     decimals: 0 },
  { key: 'goroutines', label: 'goroutines under sustained load', before: 5200, after: 32, unit: '',       decimals: 0 },
]

const REPLAY_MS = 1800

function lerp(a, b, t) { return a + (b - a) * t }

function fmtVal(v, decimals, unit) {
  const n = decimals === 0 ? Math.round(v) : v.toFixed(decimals)
  return `${Number(n).toLocaleString('en-US')}${unit}`
}

export default function SummaryDashboard() {
  const [t, setT] = useState(0)          // 0 = before, 1 = after
  const [replaying, setReplaying] = useState(false)
  const rafRef = useRef(null)
  const startRef = useRef(0)

  const replay = () => {
    setReplaying(true)
    setT(0)
    startRef.current = performance.now()
    const step = now => {
      const elapsed = now - startRef.current
      const progress = Math.min(1, elapsed / REPLAY_MS)
      setT(progress)
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step)
      } else {
        setReplaying(false)
      }
    }
    rafRef.current = requestAnimationFrame(step)
  }

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

  const reset = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    setReplaying(false)
    setT(0)
  }

  return (
    <div className="viz-card">
      <p className="viz-title">↳ every fix, one dashboard — the floor came back down</p>

      <div className="space-y-4 mb-5">
        {METRICS.map(m => {
          const value = lerp(m.before, m.after, t)
          const maxVal = Math.max(m.before, m.after)
          const pct = Math.max(2, Math.round((value / maxVal) * 100))
          const improved = t > 0.02
          return (
            <div key={m.key}>
              <div className="flex justify-between mb-1">
                <span className="font-mono text-[11px] viz-muted">{m.label}</span>
                <span className={`font-mono text-[11px] font-semibold ${improved ? '' : 'text-rose-600'}`} style={improved ? { color: 'var(--green)' } : undefined}>
                  {fmtVal(value, m.decimals, m.unit)}
                </span>
              </div>
              <div className="h-3 rounded-full overflow-hidden" style={{ background: 'var(--surface-muted)' }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${pct}%`,
                    background: improved ? 'var(--green)' : '#ef6b73',
                    transition: replaying ? 'none' : 'width 300ms ease, background 300ms ease',
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>

      <p className="font-mono text-[11px] viz-dim mb-4">
        {t < 0.05
          ? 'This is the incident state — every cost from the last six sections stacked on the same fleet of hosts.'
          : t > 0.95
          ? 'Fixed: pooled file descriptors, batched /proc reads, MessagePack over JSON, and a bounded worker pool instead of one goroutine per connection. None of these individually would have explained the whole gap — together they were the whole gap.'
          : 'applying fixes…'}
      </p>

      <div className="flex gap-2">
        <button className="btn-sim-accent" onClick={replay} disabled={replaying}>▶ replay the incident → the fix</button>
        <button className="btn-sim" onClick={reset}>reset to before</button>
      </div>
    </div>
  )
}
