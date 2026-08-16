import { useEffect, useRef, useState } from 'react'

/**
 * Section 4 — replication, ISR and the high watermark.
 *
 * One leader, two followers. Followers fetch from the leader; the HWM is the
 * minimum LEO across the ISR, and only records below the HWM are visible to
 * consumers. Slow a follower past replica.lag.time.max.ms and it drops out —
 * the HWM starts moving again, at the cost of durability.
 */

const REPLICA_LAG_MAX = 4   // ticks a follower may trail before leaving the ISR

const initial = () => ({
  leo: { b1: 0, b2: 0, b3: 0 },
  isr: ['b1', 'b2', 'b3'],
  hwm: 0,
  behind: { b2: 0, b3: 0 },
})

export default function ISRReplication() {
  const [acks, setAcks]       = useState('all')
  const [slow, setSlow]       = useState(null)      // 'b2' | 'b3' | null
  const [state, setState]     = useState(initial)
  const [log, setLog]         = useState([{ t: 'muted', m: '-- topic events, partition 0, replication.factor=3, min.insync.replicas=2' }])
  const [pending, setPending] = useState([])        // produce requests waiting on acks
  const tickRef = useRef(0)

  const addLog = (m, t = 'muted') => setLog(prev => [...prev.slice(-40), { m, t }])

  const produce = () => {
    setState(s => {
      const leo = { ...s.leo, b1: s.leo.b1 + 1 }
      return { ...s, leo }
    })
    const offset = state.leo.b1
    if (acks === '0') {
      addLog(`produce(offset ${offset}) — acks=0, fire and forget, no response at all`, 'warn')
    } else if (acks === '1') {
      addLog(`produce(offset ${offset}) — acks=1, leader wrote it, acked immediately`, 'info')
    } else {
      addLog(`produce(offset ${offset}) — acks=all, waiting for every ISR member to fetch it`, 'info')
      setPending(p => [...p, { offset, at: tickRef.current }])
    }
  }

  // Replication loop: followers fetch, ISR shrinks/heals, HWM advances.
  const stateRef = useRef(state)
  stateRef.current = state
  const pendingRef = useRef(pending)
  pendingRef.current = pending

  useEffect(() => {
    const t = setInterval(() => {
      tickRef.current += 1
      const s = stateRef.current
      const leo = { ...s.leo }
      const behind = { ...s.behind }
      let isr = [...s.isr]
      const events = []

      for (const b of ['b2', 'b3']) {
        if (slow !== b && leo[b] < leo.b1) leo[b] = Math.min(leo.b1, leo[b] + 1)
        behind[b] = leo[b] >= leo.b1 ? 0 : behind[b] + 1

        if (behind[b] > REPLICA_LAG_MAX && isr.includes(b)) {
          isr = isr.filter(x => x !== b)
          events.push([`${b} trailed the leader for > replica.lag.time.max.ms → removed from ISR. ISR = [${isr.join(', ')}]`, 'err'])
        }
        if (behind[b] === 0 && !isr.includes(b)) {
          isr = [...isr, b].sort()
          events.push([`${b} caught up to the leader's LEO → rejoined ISR. ISR = [${isr.join(', ')}]`, 'ok'])
        }
      }

      const hwm = Math.min(...isr.map(b => leo[b]))
      if (hwm > s.hwm) {
        events.push([`high watermark ${s.hwm} → ${hwm} — offsets below it are now readable by consumers`, 'ok'])
        const done = pendingRef.current.filter(r => r.offset < hwm)
        done.forEach(r => events.push([`acks=all satisfied for offset ${r.offset} after ${tickRef.current - r.at} ticks`, 'ok']))
        if (done.length) setPending(p => p.filter(r => r.offset >= hwm))
      }

      setState({ leo, isr, hwm, behind })
      if (events.length) setLog(prev => [...prev.slice(-40), ...events.map(([m, t2]) => ({ m, t: t2 }))])
    }, 700)
    return () => clearInterval(t)
  }, [slow])

  const reset = () => {
    setState(initial())
    setPending([])
    setSlow(null)
    setLog([{ t: 'muted', m: '-- reset' }])
  }

  const brokers = [
    { id: 'b1', role: 'leader',   epoch: 5 },
    { id: 'b2', role: 'follower', epoch: 5 },
    { id: 'b3', role: 'follower', epoch: 5 },
  ]

  const underMinIsr = state.isr.length < 2
  const guarantee = {
    '0':  'no guarantee — the record can vanish in the socket buffer and the producer never knows',
    '1':  'leader-only — safe until the leader dies before followers fetch, then the write is gone',
    all:  'durable — the record survives any failure that leaves one ISR member alive',
  }[acks]

  const logColor = { ok: 'text-emerald-400', warn: 'text-amber-400', info: 'text-sky-400', err: 'text-rose-400', muted: 'text-zinc-500' }

  return (
    <div className="viz-card">
      <p className="viz-title">↳ ISR, high watermark &amp; acks</p>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="stat-card">
          <div className="stat-value text-accent-600">{state.leo.b1}</div>
          <div className="stat-label">leader LEO</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-emerald-600">{state.hwm}</div>
          <div className="stat-label">high watermark</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value ${underMinIsr ? 'text-rose-600' : 'text-zinc-700'}`}>{state.isr.length}</div>
          <div className="stat-label">ISR size</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="font-mono text-[10px] k-muted mr-1">acks =</span>
        {['0', '1', 'all'].map(a => (
          <button key={a} className={acks === a ? 'btn-sim-accent' : 'btn-sim'} onClick={() => setAcks(a)}>
            {a}
          </button>
        ))}
      </div>
      <p className="font-mono text-[10px] k-muted mb-5">{guarantee}</p>

      <div className="grid gap-2 mb-5">
        {brokers.map(b => {
          const inIsr = state.isr.includes(b.id)
          const isSlow = slow === b.id
          return (
            <div key={b.id} className={`k-panel ${inIsr ? '' : 'opacity-75'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[11px] k-strong">
                  broker-{b.id.slice(1)} · {b.role}
                  <span className="k-muted"> · leader epoch {b.epoch}</span>
                </span>
                <span className={`font-mono text-[10px] ${inIsr ? 'text-emerald-600' : 'text-rose-500'}`}>
                  {inIsr ? 'in ISR' : `out of ISR (${state.behind[b.id]} ticks behind)`}
                </span>
              </div>

              <div className="flex gap-1 flex-wrap items-center">
                {Array.from({ length: Math.max(state.leo.b1, 1) }, (_, o) => {
                  const has = o < state.leo[b.id]
                  const visible = o < state.hwm
                  return (
                    <div
                      key={o}
                      className={`w-9 h-7 k-chip ${!has ? '' : visible ? 'k-chip-ok' : 'k-chip-warn'}`}
                      title={`offset ${o}${!has ? ' — not replicated yet' : visible ? ' — below HWM, readable' : ' — above HWM, invisible to consumers'}`}
                    >
                      <span className="font-mono text-[9px]">{has ? o : '·'}</span>
                    </div>
                  )
                })}
                <span className="font-mono text-[10px] k-muted ml-2">LEO {state.leo[b.id]}</span>
              </div>

              {b.role === 'follower' && (
                <button
                  className={`mt-2 ${isSlow ? 'btn-sim-danger' : 'btn-sim'}`}
                  onClick={() => setSlow(isSlow ? null : b.id)}
                >
                  {isSlow ? `resume ${b.id} fetches` : `stall ${b.id} (GC pause / slow disk)`}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {underMinIsr && (
        <p className="font-mono text-[10px] mb-3 text-rose-500">
          ⚠ ISR ({state.isr.length}) &lt; min.insync.replicas (2) — with acks=all the broker now rejects
          every produce with NOT_ENOUGH_REPLICAS. The partition is read-only until a follower catches up.
        </p>
      )}

      <div className="flex flex-wrap gap-2 mb-5">
        <button className="btn-sim-accent" onClick={produce}>produce record</button>
        <button className="btn-sim ml-auto" onClick={reset}>reset</button>
      </div>

      <div className="sim-log">
        {log.map((l, i) => <div key={i} className={`py-px ${logColor[l.t]}`}>{l.m}</div>)}
      </div>
    </div>
  )
}
