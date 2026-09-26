import { useMemo } from 'react'
import { runIncident } from './model'
import { LineChart, C } from './charts'

/**
 * Section 8: the opening incident replayed twice through the same model and
 * the same seed. The only difference is the client and server policy.
 */

const TICKS = 1500   // 150s
const AT = 100       // failover starts at 10s
const OUTAGE = 400   // a 40s failover
const BASE = { ticks: TICKS, at: AT, outage: OUTAGE, rate: 100, capacity: 130, maxAttempts: 3, seed: 9 }
const RUNS = [
  { id: 'before', title: 'before: exponential backoff, no jitter, no budget', p: { policy: 'exp' } },
  { id: 'after',  title: 'after: jitter + retry budget + load shedding', p: { policy: 'jitter', budget: true, shed: true } },
]

function perSecond(rows) {
  const out = []
  for (let i = 0; i < rows.length; i += 10) {
    const w = rows.slice(i, i + 10)
    const sum = k => w.reduce((a, r) => a + r[k], 0) / w.length
    out.push({ t: i / 10, goodput: sum('goodput'), offered: sum('offered'), retries: sum('retries'), wasted: sum('wasted') })
  }
  return out
}

function summarize(sec) {
  const end = (AT + OUTAGE) / 10
  let recovered = null
  for (let s = end; s < sec.length - 3; s++) {
    if ([0, 1, 2].every(k => sec[s + k].goodput >= 90)) { recovered = s - end; break }
  }
  const after = sec.slice(end)
  return {
    recovered,
    retries: Math.round(after.reduce((a, r) => a + r.retries, 0)),
    wasted: Math.round(after.reduce((a, r) => a + r.wasted, 0)),
    peak: Math.round(Math.max(...after.map(r => r.offered))),
  }
}

export default function BeforeAfterDashboard() {
  const runs = useMemo(() => RUNS.map(r => {
    const sec = perSecond(runIncident({ ...BASE, ...r.p }))
    return { ...r, sec, sum: summarize(sec) }
  }), [])
  const marks = [{ x: AT / 10, label: 'failover' }, { x: (AT + OUTAGE) / 10, label: 'DB healthy' }]

  return (
    <div className="viz-card">
      <p className="viz-title">↳ same incident, replayed twice</p>
      <div className="grid gap-4 md:grid-cols-2">
        {runs.map(r => (
          <div key={r.id} className="viz-panel">
            <p className="font-mono text-[11px] viz-strong mb-3">{r.title}</p>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="stat-card p-3">
                <div className="stat-value text-base" style={{ color: r.sum.recovered == null ? C.bad : C.ok }}>
                  {r.sum.recovered == null ? 'never' : `${r.sum.recovered}s`}
                </div>
                <div className="stat-label">recovery after DB is back</div>
              </div>
              <div className="stat-card p-3">
                <div className="stat-value text-base">{r.sum.peak}</div>
                <div className="stat-label">peak offered req/s</div>
              </div>
              <div className="stat-card p-3">
                <div className="stat-value text-base" style={{ color: r.sum.wasted > 0 ? C.bad : undefined }}>{r.sum.wasted.toLocaleString()}</div>
                <div className="stat-label">requests served to nobody</div>
              </div>
            </div>
            <LineChart
              data={r.sec}
              xDomain={[0, TICKS / 10]}
              series={[{ key: 'offered', className: 'sim-chart-line-muted' }, { key: 'goodput', className: 'sim-chart-line-alt' }]}
              hlines={[{ y: BASE.capacity, label: 'capacity' }]}
              vmarks={marks}
              yMax={450}
              width={400}
              height={220}
              label="req/s over 150s · dashed: goodput"
            />
          </div>
        ))}
      </div>
      <p className="font-mono text-[11px] viz-dim mt-4">
        Same demand (100 req/s), same capacity (130 req/s), same 40s failover, same random seed. The before run
        does not come back in the {TICKS / 10 - (AT + OUTAGE) / 10}s after the database is healthy again. In production,
        this is where someone blocks traffic at the edge.
      </p>
    </div>
  )
}
