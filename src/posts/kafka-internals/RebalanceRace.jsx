import { useEffect, useRef, useState } from 'react'

/**
 * Section 3 — eager vs cooperative rebalance, same event, side by side.
 *
 * Event: a 4th consumer joins a group of 3 that owns 6 partitions.
 * Eager  — every member revokes everything, rejoins, waits for SyncGroup.
 * Cooperative — members keep what they keep; only the 2 partitions that must
 * move are revoked, and only in the second of two rebalances.
 */

const PARTITIONS = [0, 1, 2, 3, 4, 5]
const TICKS = 14

// before: c1=[0,1] c2=[2,3] c3=[4,5]   after: c1=[0] c2=[2,3] c3=[4] c4=[1,5]
const OWNER_BEFORE = { 0: 'c1', 1: 'c1', 2: 'c2', 3: 'c2', 4: 'c3', 5: 'c3' }
const OWNER_AFTER  = { 0: 'c1', 1: 'c4', 2: 'c2', 3: 'c2', 4: 'c3', 5: 'c4' }
const MOVING = PARTITIONS.filter(p => OWNER_BEFORE[p] !== OWNER_AFTER[p])

// tick → state per partition. 'active' = processing, 'paused' = stop-the-world.
function eagerState(p, tick) {
  if (tick < 3) return { s: 'active', owner: OWNER_BEFORE[p] }
  if (tick < 10) return { s: 'paused', owner: null }        // revoke → JoinGroup → SyncGroup
  return { s: 'active', owner: OWNER_AFTER[p] }
}

function cooperativeState(p, tick) {
  if (tick < 3) return { s: 'active', owner: OWNER_BEFORE[p] }
  if (!MOVING.includes(p)) return { s: 'active', owner: OWNER_AFTER[p] }
  if (tick < 6) return { s: 'active', owner: OWNER_BEFORE[p] } // 1st rebalance: still owned
  if (tick < 9) return { s: 'paused', owner: null }            // revoked, 2nd rebalance
  return { s: 'active', owner: OWNER_AFTER[p] }
}

const PHASES = {
  eager: [
    [0, 'steady state — c1, c2, c3 processing'],
    [3, 'consumer-4 joins → coordinator marks group rebalancing'],
    [4, 'onPartitionsRevoked(ALL) — every member drops every partition'],
    [6, 'JoinGroup — coordinator waits for all members (or session.timeout.ms)'],
    [8, 'SyncGroup — leader ships the new assignment'],
    [10, 'onPartitionsAssigned — processing resumes after ~7 ticks of nothing'],
  ],
  cooperative: [
    [0, 'steady state — c1, c2, c3 processing'],
    [3, 'consumer-4 joins → rebalance #1, assignment computed, nothing revoked yet'],
    [5, 'members compare old vs new: only p1 and p5 must move'],
    [6, 'onPartitionsRevoked(p1, p5) — those two pause, the other four keep going'],
    [8, 'rebalance #2 assigns p1, p5 to consumer-4'],
    [9, 'fully assigned — 4 of 6 partitions never stopped'],
  ],
}

function Timeline({ mode, tick }) {
  const fn = mode === 'eager' ? eagerState : cooperativeState
  const paused = PARTITIONS.reduce(
    (a, p) => a + Array.from({ length: TICKS }, (_, t) => fn(p, t).s).filter(s => s === 'paused').length,
    0
  )
  const phase = [...PHASES[mode]].reverse().find(([t]) => tick >= t)?.[1] ?? ''

  return (
    <div className="k-panel">
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-[11px] k-strong">
          {mode === 'eager' ? 'eager (default before 2.4)' : 'cooperative-sticky'}
        </span>
        <span className={`font-mono text-[10px] ${mode === 'eager' ? 'text-rose-500' : 'text-emerald-600'}`}>
          {paused} partition-ticks paused
        </span>
      </div>

      {PARTITIONS.map(p => (
        <div key={p} className="flex items-center gap-2 mb-1">
          <span className="font-mono text-[9px] k-muted w-5 shrink-0">p{p}</span>
          <div className="grid gap-[2px] flex-1" style={{ gridTemplateColumns: `repeat(${TICKS}, 1fr)` }}>
            {Array.from({ length: TICKS }, (_, t) => {
              const { s } = fn(p, t)
              const revealed = t <= tick
              return (
                <div
                  key={t}
                  className={`k-cell ${!revealed ? 'k-cell-idle' : s === 'active' ? 'k-cell-active' : 'k-cell-paused'}`}
                  style={{ opacity: t === tick ? 1 : revealed ? 0.85 : 1 }}
                />
              )
            })}
          </div>
          <span className="font-mono text-[9px] k-muted w-6 shrink-0 text-right">
            {fn(p, tick).owner ?? '—'}
          </span>
        </div>
      ))}

      <p className="font-mono text-[10px] k-dim mt-3 min-h-[28px]">{phase}</p>
    </div>
  )
}

export default function RebalanceRace() {
  const [tick, setTick]       = useState(0)
  const [playing, setPlaying] = useState(false)
  const timer = useRef(null)

  useEffect(() => {
    if (!playing) return
    timer.current = setInterval(() => {
      setTick(t => {
        if (t >= TICKS - 1) { setPlaying(false); return t }
        return t + 1
      })
    }, 520)
    return () => clearInterval(timer.current)
  }, [playing])

  const start = () => { setTick(0); setPlaying(true) }

  return (
    <div className="viz-card">
      <p className="viz-title">↳ eager vs cooperative — same consumer joining</p>

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <button className="btn-sim-accent" onClick={start}>consumer-4 joins</button>
        <button className="btn-sim" onClick={() => setPlaying(p => !p)} disabled={tick >= TICKS - 1}>
          {playing ? 'pause' : 'resume'}
        </button>
        <button className="btn-sim" onClick={() => { setPlaying(false); setTick(0) }}>reset</button>
        <span className="font-mono text-[10px] k-muted ml-auto">tick {tick} / {TICKS - 1}</span>
      </div>

      <div className="grid gap-3 mb-4">
        <Timeline mode="eager" tick={tick} />
        <Timeline mode="cooperative" tick={tick} />
      </div>

      <div className="flex flex-wrap gap-4 font-mono text-[10px] k-muted">
        <span className="flex items-center gap-1.5">
          <i className="k-cell k-cell-active inline-block w-4 h-3 rounded-[2px]" /> processing
        </span>
        <span className="flex items-center gap-1.5">
          <i className="k-cell k-cell-paused inline-block w-4 h-3 rounded-[2px]" /> revoked / paused
        </span>
        <span className="flex items-center gap-1.5">
          <i className="k-cell k-cell-idle inline-block w-4 h-3 rounded-[2px]" /> not reached yet
        </span>
      </div>
    </div>
  )
}
