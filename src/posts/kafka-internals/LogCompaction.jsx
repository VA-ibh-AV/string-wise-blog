import { useState } from 'react'

/**
 * Section 5 — log compaction.
 *
 * The cleaner never touches the active segment. It builds an offset map of the
 * dirty portion, keeps only the last record per key, and turns tombstones into
 * deletions once delete.retention.ms has elapsed.
 */

const KEYS = ['user:1', 'user:2', 'user:3', 'user:4']
const VALUES = ['{"plan":"free"}', '{"plan":"pro"}', '{"plan":"team"}', '{"plan":"trial"}']

const seed = [
  { key: 'user:1', value: '{"plan":"free"}' },
  { key: 'user:2', value: '{"plan":"pro"}' },
  { key: 'user:1', value: '{"plan":"pro"}' },
  { key: 'user:3', value: '{"plan":"free"}' },
  { key: 'user:2', value: null },
  { key: 'user:1', value: '{"plan":"team"}' },
  { key: 'user:4', value: '{"plan":"trial"}' },
  { key: 'user:3', value: '{"plan":"pro"}' },
].map((r, i) => ({ ...r, offset: i, id: i }))

export default function LogCompaction() {
  const [records, setRecords]   = useState(seed)
  const [cleanUpto, setCleanUpto] = useState(0)   // offsets < cleanUpto are the clean portion
  const [nextId, setNextId]     = useState(seed.length)
  const [tombstoneAge, setTombstoneAge] = useState(0)
  const [log, setLog] = useState([{ m: '-- cleanup.policy=compact, segment.ms=100, delete.retention.ms=short', t: 'muted' }])

  const addLog = (m, t = 'muted') => setLog(prev => [...prev.slice(-30), { m, t }])

  const activeStart = Math.max(0, records.length - 3)   // last 3 records = active segment

  const append = (value) => {
    const key = KEYS[Math.floor(Math.random() * KEYS.length)]
    const v = value === null ? null : VALUES[Math.floor(Math.random() * VALUES.length)]
    const offset = records.length ? records[records.length - 1].offset + 1 : 0
    setRecords(prev => [...prev, { key, value: v, offset, id: nextId }])
    setNextId(n => n + 1)
    addLog(
      v === null
        ? `append offset ${offset} — key=${key} value=null (tombstone: delete this key)`
        : `append offset ${offset} — key=${key} value=${v}`,
      v === null ? 'warn' : 'ok'
    )
  }

  const runCleaner = () => {
    const dirty = records.filter(r => r.offset >= cleanUpto && r.offset < records[activeStart]?.offset)
    if (dirty.length === 0) { addLog('cleaner pass — nothing dirty outside the active segment', 'muted'); return }

    const cleanable = records.filter(r => r.offset < records[activeStart].offset)
    const active    = records.filter(r => r.offset >= records[activeStart].offset)

    // Keep the last record per key in the cleanable region.
    const lastByKey = new Map()
    cleanable.forEach(r => lastByKey.set(r.key, r))
    const kept = cleanable.filter(r => lastByKey.get(r.key) === r)
    const removed = cleanable.length - kept.length

    setRecords([...kept, ...active])
    setCleanUpto(records[activeStart].offset)
    setTombstoneAge(a => a + 1)

    addLog(`cleaner pass — read ${cleanable.length} records, built offset map of ${lastByKey.size} keys`, 'info')
    addLog(`cleaner pass — dropped ${removed} superseded record${removed === 1 ? '' : 's'}, offsets of survivors unchanged`, 'ok')

    // Second pass: tombstones that have outlived delete.retention.ms disappear.
    if (tombstoneAge >= 1) {
      const tombs = kept.filter(r => r.value === null)
      if (tombs.length) {
        setRecords([...kept.filter(r => r.value !== null), ...active])
        addLog(`delete.retention.ms elapsed — purged ${tombs.length} tombstone(s) for [${tombs.map(t => t.key).join(', ')}]`, 'warn')
      }
    }
  }

  const reset = () => {
    setRecords(seed)
    setCleanUpto(0)
    setNextId(seed.length)
    setTombstoneAge(0)
    setLog([{ m: '-- reset', t: 'muted' }])
  }

  const liveKeys = new Map()
  records.forEach(r => (r.value === null ? liveKeys.delete(r.key) : liveKeys.set(r.key, r.value)))

  const logColor = { ok: 'text-emerald-400', warn: 'text-amber-400', info: 'text-sky-400', muted: 'text-zinc-500' }

  return (
    <div className="viz-card">
      <p className="viz-title">↳ log cleaner pass</p>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="stat-card">
          <div className="stat-value text-accent-600">{records.length}</div>
          <div className="stat-label">records on disk</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-emerald-600">{liveKeys.size}</div>
          <div className="stat-label">distinct live keys</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-zinc-700">
            {records.length ? Math.round((1 - liveKeys.size / records.length) * 100) : 0}%
          </div>
          <div className="stat-label">reclaimable</div>
        </div>
      </div>

      <div className="k-panel mb-4">
        <div className="flex items-center justify-between mb-3">
          <span className="font-mono text-[10px] k-muted">partition log — left to right, offsets never change</span>
          <span className="font-mono text-[10px] k-muted">cleaner point: offset {cleanUpto}</span>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {records.map((r, i) => {
            const isActive = i >= activeStart
            const isTomb = r.value === null
            return (
              <div
                key={r.id}
                className={`w-[92px] h-14 k-chip ${isTomb ? 'k-chip-bad' : isActive ? 'k-chip-warn' : 'k-chip-ok'}`}
                title={isActive ? 'active segment — the cleaner never touches it' : 'cleanable'}
              >
                <span className="font-mono text-[8px] opacity-70">offset {r.offset}</span>
                <span className="font-mono text-[10px] font-semibold">{r.key}</span>
                <span className="font-mono text-[8px] opacity-80">{r.value === null ? '⌦ tombstone' : r.value.slice(8, -2)}</span>
              </div>
            )
          })}
        </div>
        <div className="flex flex-wrap gap-4 font-mono text-[9px] k-muted mt-3">
          <span>green = cleanable segment</span>
          <span>amber = active segment (never compacted)</span>
          <span>red = tombstone (null value)</span>
        </div>
      </div>

      <div className="k-panel mb-5">
        <p className="font-mono text-[10px] k-muted mb-2">
          materialized view — what a consumer that reads the whole log from offset 0 ends up with
        </p>
        <div className="flex gap-2 flex-wrap">
          {[...liveKeys.entries()].map(([k, v]) => (
            <span key={k} className="k-tag k-tag-hl">{k} → {v}</span>
          ))}
          {liveKeys.size === 0 && <span className="font-mono text-[10px] k-muted">— empty —</span>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        <button className="btn-sim-accent" onClick={() => append('v')}>append record</button>
        <button className="btn-sim-danger" onClick={() => append(null)}>append tombstone</button>
        <button className="btn-sim-success" onClick={runCleaner}>run log cleaner</button>
        <button className="btn-sim ml-auto" onClick={reset}>reset</button>
      </div>

      <div className="sim-log">
        {log.map((l, i) => <div key={i} className={`py-px ${logColor[l.t]}`}>{l.m}</div>)}
      </div>
    </div>
  )
}
