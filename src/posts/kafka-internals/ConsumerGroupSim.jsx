import { useEffect, useRef, useState } from 'react'

/**
 * Section 2 — consumer groups and partition assignment.
 *
 * The group leader (first member to join) runs the assignor locally and ships
 * the result back through SyncGroup. This implements the four shipped
 * assignors so you can watch churn differ between them.
 */

const STRATEGIES = [
  { id: 'range',       label: 'range',             note: 'RangeAssignor — contiguous blocks per topic. Skews load on the first consumers.' },
  { id: 'roundrobin',  label: 'roundrobin',        note: 'RoundRobinAssignor — even spread, but every rebalance reshuffles everything.' },
  { id: 'sticky',      label: 'sticky',            note: 'StickyAssignor — even spread AND keeps prior ownership where possible. Still eager.' },
  { id: 'cooperative', label: 'cooperative-sticky',note: 'CooperativeStickyAssignor — sticky plus incremental revocation. The modern default choice.' },
]

function assign(strategy, partitions, consumers, previous) {
  const result = Object.fromEntries(consumers.map(c => [c, []]))
  if (consumers.length === 0) return result

  if (strategy === 'range') {
    const per = Math.floor(partitions.length / consumers.length)
    const extra = partitions.length % consumers.length
    let p = 0
    consumers.forEach((c, i) => {
      const take = per + (i < extra ? 1 : 0)
      result[c] = partitions.slice(p, p + take)
      p += take
    })
    return result
  }

  if (strategy === 'roundrobin') {
    partitions.forEach((p, i) => result[consumers[i % consumers.length]].push(p))
    return result
  }

  // sticky / cooperative-sticky share the same target assignment; they differ
  // only in HOW they get there (see the rebalance visualizer).
  const max = Math.ceil(partitions.length / consumers.length)
  const min = Math.floor(partitions.length / consumers.length)
  const unassigned = []

  partitions.forEach(p => {
    const owner = consumers.find(c => previous?.[c]?.includes(p))
    if (owner && result[owner].length < max) result[owner].push(p)
    else unassigned.push(p)
  })

  unassigned.forEach(p => {
    const target = consumers
      .slice()
      .sort((a, b) => result[a].length - result[b].length || consumers.indexOf(a) - consumers.indexOf(b))[0]
    result[target].push(p)
  })

  // Level out any consumer still below the floor by pulling from the fullest.
  consumers.forEach(c => {
    while (result[c].length < min) {
      const donor = consumers.slice().sort((a, b) => result[b].length - result[a].length)[0]
      if (result[donor].length <= min) break
      result[c].push(result[donor].pop())
    }
  })

  Object.values(result).forEach(list => list.sort((a, b) => a - b))
  return result
}

export default function ConsumerGroupSim() {
  const [numPartitions, setNumPartitions] = useState(8)
  const [numConsumers, setNumConsumers]   = useState(3)
  const [strategy, setStrategy]           = useState('range')
  const [assignment, setAssignment]       = useState({})
  const [moved, setMoved]                 = useState(0)
  const [lag, setLag]                     = useState(() => Array(12).fill(0))
  const prevRef = useRef({})

  useEffect(() => {
    const partitions = Array.from({ length: numPartitions }, (_, i) => i)
    const consumers  = Array.from({ length: numConsumers }, (_, i) => `c${i + 1}`)
    const next = assign(strategy, partitions, consumers, prevRef.current)

    let churn = 0
    partitions.forEach(p => {
      const before = Object.keys(prevRef.current).find(c => prevRef.current[c]?.includes(p))
      const after  = consumers.find(c => next[c].includes(p))
      if (before && after && before !== after) churn++
    })

    prevRef.current = next
    setAssignment(next)
    setMoved(churn)
  }, [numPartitions, numConsumers, strategy])

  useEffect(() => {
    const t = setInterval(() => {
      setLag(prev => prev.map((l, i) => {
        if (i >= numPartitions) return 0
        const owned = Object.values(assignment).some(list => list.includes(i))
        const produced = 1 + Math.floor(Math.random() * 3)
        const consumed = owned ? 2 + Math.floor(Math.random() * 3) : 0
        return Math.max(0, Math.min(99, l + produced - consumed))
      }))
    }, 900)
    return () => clearInterval(t)
  }, [assignment, numPartitions])

  const consumers = Array.from({ length: numConsumers }, (_, i) => `c${i + 1}`)
  const idle = consumers.filter(c => (assignment[c] ?? []).length === 0)
  const strategyNote = STRATEGIES.find(s => s.id === strategy)?.note

  return (
    <div className="viz-card">
      <p className="viz-title">↳ group membership &amp; assignment</p>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="stat-card">
          <div className="stat-value text-accent-600">{numConsumers}</div>
          <div className="stat-label">group members</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value ${idle.length ? 'text-amber-500' : 'text-emerald-600'}`}>{idle.length}</div>
          <div className="stat-label">idle consumers</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value ${moved > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{moved}</div>
          <div className="stat-label">partitions moved</div>
        </div>
      </div>

      <div className="slider-row">
        <span className="slider-label">topic partitions</span>
        <input type="range" min="1" max="12" value={numPartitions}
          onChange={e => setNumPartitions(Number(e.target.value))}
          className="flex-1 accent-blue-600" />
        <span className="slider-value">{numPartitions}</span>
      </div>
      <div className="slider-row">
        <span className="slider-label">consumers in group</span>
        <input type="range" min="1" max="8" value={numConsumers}
          onChange={e => setNumConsumers(Number(e.target.value))}
          className="flex-1 accent-blue-600" />
        <span className="slider-value">{numConsumers}</span>
      </div>

      <div className="flex flex-wrap gap-2 mb-2 mt-4">
        {STRATEGIES.map(s => (
          <button
            key={s.id}
            className={strategy === s.id ? 'btn-sim-accent' : 'btn-sim'}
            onClick={() => setStrategy(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="font-mono text-[10px] k-muted mb-5">{strategyNote}</p>

      <div className="grid gap-2 mb-5">
        {consumers.map((c, i) => {
          const owned = assignment[c] ?? []
          const consumerLag = owned.reduce((a, p) => a + lag[p], 0)
          return (
            <div key={c} className={`k-panel ${owned.length === 0 ? 'opacity-70' : ''}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[11px] k-strong">
                  consumer-{i + 1}
                  {i === 0 && <span className="k-muted"> · group leader</span>}
                </span>
                <span className="font-mono text-[10px] k-muted">
                  {owned.length === 0
                    ? 'idle — no partitions, no work'
                    : `${owned.length} partition${owned.length === 1 ? '' : 's'} · lag ${consumerLag}`}
                </span>
              </div>
              <div className="flex gap-1.5 flex-wrap min-h-[34px]">
                {owned.map(p => (
                  <div key={p} className="w-[74px] h-8 k-chip k-chip-ok">
                    <span className="font-mono text-[9px]">p{p}</span>
                    <span className="font-mono text-[8px] opacity-70">lag {lag[p]}</span>
                  </div>
                ))}
                {owned.length === 0 && (
                  <span className="font-mono text-[10px] k-muted self-center">— nothing assigned —</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {numConsumers > numPartitions && (
        <p className="font-mono text-[10px] mb-3" style={{ color: '#d08700' }}>
          ⚠ {numConsumers - numPartitions} consumer(s) sit idle. A partition is owned by exactly one member
          of a group — extra consumers buy you failover, not throughput.
        </p>
      )}

      <div className="sim-log">
        <div className="text-zinc-500">-- assignment computed by the group leader, not the broker</div>
        <div className="text-sky-400">JoinGroup  → coordinator picks leader = consumer-1, sends it the full member list</div>
        <div className="text-sky-400">SyncGroup  → leader runs {strategy} assignor, uploads assignment</div>
        <div className="text-emerald-400">
          SyncGroup response → {consumers.map(c => `${c}:[${(assignment[c] ?? []).join(',')}]`).join('  ')}
        </div>
      </div>
    </div>
  )
}
