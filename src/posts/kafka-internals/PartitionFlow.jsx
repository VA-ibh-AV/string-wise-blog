import { useEffect, useRef, useState } from 'react'

/**
 * Hero visualizer — how a record reaches a partition.
 *
 * Shows the producer-side partitioner: murmur2(key) % numPartitions for keyed
 * records, sticky batching for null keys. The record lands on the tail of one
 * partition log and a consumer walks the offsets behind it.
 */

const MAX_P   = 8
const WINDOW  = 9   // records kept on screen per partition
const KEYS = ['user-42', 'user-7', 'order-991', 'user-42', 'cart-3', 'order-991', 'user-7', 'sku-88']

// Kafka uses murmur2; this stand-in has the same shape: stable hash → modulo.
function hashKey(key) {
  let h = 0x9747b28c
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 0x5bd1e995)
    h ^= h >>> 15
  }
  return Math.abs(h)
}

const emptyLogs = () => Array.from({ length: MAX_P }, () => [])

export default function PartitionFlow() {
  const [numPartitions, setNumPartitions] = useState(4)
  const [keyed, setKeyed]         = useState(true)
  const [logs, setLogs]           = useState(emptyLogs)      // [{ key, offset }] windowed
  const [produced, setProduced]   = useState(() => Array(MAX_P).fill(0))  // next offset per partition
  const [committed, setCommitted] = useState(() => Array(MAX_P).fill(0))  // consumer position
  const [seq, setSeq]             = useState(0)
  const [inFlight, setInFlight]   = useState(null)
  const [running, setRunning]     = useState(false)

  // Latest-value refs so the auto-stream interval never needs re-registering.
  const latest = useRef({})
  latest.current = { numPartitions, keyed, produced, seq }

  const produce = () => {
    const { numPartitions: n, keyed: k, produced: prod, seq: s } = latest.current
    const key = k ? KEYS[s % KEYS.length] : null
    const partition = key ? hashKey(key) % n : Math.floor(s / 3) % n
    const offset = prod[partition]

    setInFlight({ key, partition, offset })
    setSeq(x => x + 1)

    setTimeout(() => {
      setLogs(prev => {
        const next = prev.map(p => [...p])
        next[partition] = [...next[partition], { key, offset }].slice(-WINDOW)
        return next
      })
      setProduced(prev => prev.map((v, i) => (i === partition ? v + 1 : v)))
      setInFlight(null)
    }, 400)
  }

  const consume = () => {
    setCommitted(prev => prev.map((c, i) => (c < latest.current.produced[i] ? c + 1 : c)))
  }

  const reset = () => {
    setRunning(false)
    setLogs(emptyLogs())
    setProduced(Array(MAX_P).fill(0))
    setCommitted(Array(MAX_P).fill(0))
    setSeq(0)
    setInFlight(null)
  }

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => {
      produce()
      setTimeout(consume, 620)
    }, 1100)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running])

  const active     = produced.slice(0, numPartitions)
  const totalRecords = active.reduce((a, v) => a + v, 0)
  const totalLag     = active.reduce((a, v, i) => a + (v - committed[i]), 0)

  return (
    <div className="viz-card">
      <p className="viz-title">↳ producer → partitioner → log</p>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="stat-card">
          <div className="stat-value text-accent-600">{numPartitions}</div>
          <div className="stat-label">partitions</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-emerald-600">{totalRecords}</div>
          <div className="stat-label">records appended</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value ${totalLag > 4 ? 'text-rose-600' : 'text-zinc-700'}`}>{totalLag}</div>
          <div className="stat-label">consumer lag</div>
        </div>
      </div>

      <div className="slider-row">
        <span className="slider-label">partitions</span>
        <input
          type="range" min="1" max={MAX_P} value={numPartitions}
          onChange={e => setNumPartitions(Number(e.target.value))}
          className="flex-1 accent-blue-600"
        />
        <span className="slider-value">{numPartitions}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <button className={keyed ? 'btn-sim-accent' : 'btn-sim'} onClick={() => setKeyed(true)}>
          key = user-id
        </button>
        <button className={!keyed ? 'btn-sim-accent' : 'btn-sim'} onClick={() => setKeyed(false)}>
          key = null (sticky)
        </button>
      </div>
      <p className="font-mono text-[10px] k-muted mb-5">
        {keyed
          ? 'partition = murmur2(key) % numPartitions — same key always lands on the same partition, so it stays ordered'
          : 'no key → the sticky partitioner fills one batch on one partition, then rotates. Better batching, no ordering guarantee.'}
      </p>

      <div className="k-panel mb-4">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <span className="font-mono text-[10px] k-muted w-20 shrink-0">producer</span>
          <div className="h-9 px-3 flex items-center rounded-lg border font-mono text-[11px] k-dim"
               style={{ borderColor: 'var(--border)', background: 'var(--surface-solid)' }}>
            send(&quot;events&quot;, key={inFlight ? `"${inFlight.key ?? 'null'}"` : keyed ? '"…"' : 'null'})
          </div>
          {inFlight && (
            <span className="font-mono text-[10px] text-accent-600">
              → hash % {numPartitions} = <strong>p{inFlight.partition}</strong>
            </span>
          )}
        </div>

        {Array.from({ length: numPartitions }, (_, p) => (
          <div key={p} className="flex items-center gap-3 mb-2">
            <span className="font-mono text-[10px] k-muted w-20 shrink-0 text-right">partition {p}</span>
            <div className="flex gap-1 flex-wrap items-center min-h-[34px]">
              {logs[p].map(r => {
                const isConsumed = r.offset < committed[p]
                return (
                  <div
                    key={r.offset}
                    className={`w-16 h-8 k-chip ${isConsumed ? '' : 'k-chip-ok'}`}
                    title={`offset ${r.offset} · key ${r.key ?? 'null'}${isConsumed ? ' · already consumed' : ' · unread'}`}
                  >
                    <span className="font-mono text-[8px] opacity-70">off {r.offset}</span>
                    <span className="font-mono text-[9px]">{r.key ?? 'null'}</span>
                  </div>
                )
              })}
              {inFlight?.partition === p && (
                <div className="w-16 h-8 k-chip-dashed font-mono text-[9px] animate-pulse">in flight</div>
              )}
              {logs[p].length === 0 && inFlight?.partition !== p && (
                <span className="font-mono text-[10px] k-muted">empty</span>
              )}
            </div>
          </div>
        ))}

        <p className="font-mono text-[9px] k-muted mt-3">
          green = not yet read by the consumer group · grey = behind the committed offset (still on disk, reads don&apos;t delete)
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button className="btn-sim-accent" onClick={produce}>produce record</button>
        <button className="btn-sim-success" onClick={consume}>consumer poll()</button>
        <button className={running ? 'btn-sim-danger' : 'btn-sim'} onClick={() => setRunning(r => !r)}>
          {running ? 'stop stream' : 'auto stream'}
        </button>
        <button className="btn-sim ml-auto" onClick={reset}>reset</button>
      </div>
    </div>
  )
}
