import { useState } from 'react'

function initTuples() {
  return Array.from({ length: 10 }, (_, i) => ({
    id: i + 1,
    val: `row_${i + 1}`,
    state: 'live',
  }))
}

function StatCard({ label, value, color }) {
  return (
    <div className="stat-card">
      <div className={`stat-value ${color}`}>{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

export default function MVCCVisualizer() {
  const [tuples, setTuples]     = useState(initTuples)
  const [nextId, setNextId]     = useState(11)
  const [log, setLog]           = useState([{ msg: '-- table initialized with 10 rows', type: 'muted' }])
  const [vacRunning, setVacRunning] = useState(false)

  const live  = tuples.filter(t => t.state === 'live')
  const dead  = tuples.filter(t => t.state === 'dead')
  const total = live.length + dead.length
  const bloat = total > 0 ? Math.round((dead.length / total) * 100) : 0

  const THRESHOLD = 5
  const pct = Math.min(100, Math.round((dead.length / THRESHOLD) * 100))

  const addLog = (msg, type = 'muted') =>
    setLog(prev => [...prev.slice(-30), { msg, type }])

  const doInsert = () => {
    const id = nextId
    setTuples(prev => [...prev, { id, val: `row_${id}`, state: 'live' }])
    setNextId(n => n + 1)
    addLog(`INSERT INTO tbl VALUES (${id})  →  t${id} is now LIVE`, 'ok')
  }

  const doUpdate = () => {
    const liveTuples = tuples.filter(t => t.state === 'live')
    if (!liveTuples.length) { addLog('-- no live rows to update', 'warn'); return }
    const target = liveTuples[Math.floor(Math.random() * liveTuples.length)]
    const newId  = nextId
    setTuples(prev => [
      ...prev.map(t => t.id === target.id ? { ...t, state: 'dead' } : t),
      { id: newId, val: target.val, state: 'live' },
    ])
    setNextId(n => n + 1)
    addLog(`UPDATE tbl SET … WHERE id=${target.id}  →  t${target.id} DEAD · t${newId} LIVE`, 'warn')
  }

  const doDelete = () => {
    const liveTuples = tuples.filter(t => t.state === 'live')
    if (!liveTuples.length) { addLog('-- no live rows to delete', 'warn'); return }
    const target = liveTuples[Math.floor(Math.random() * liveTuples.length)]
    setTuples(prev => prev.map(t => t.id === target.id ? { ...t, state: 'dead' } : t))
    addLog(`DELETE FROM tbl WHERE id=${target.id}  →  t${target.id} DEAD (space NOT freed yet)`, 'warn')
  }

  const doVacuum = () => {
    if (!dead.length || vacRunning) return
    const count = dead.length
    setVacRunning(true)
    addLog(`VACUUM — scanning ${count} dead tuples…`, 'info')
    setTimeout(() => {
      setTuples(prev => prev.filter(t => t.state !== 'dead'))
      addLog(`VACUUM done — ${count} dead tuples reclaimed as free space ✓`, 'ok')
      setVacRunning(false)
    }, 900)
  }

  const doReset = () => {
    setTuples(initTuples())
    setNextId(11)
    setLog([{ msg: '-- table reset to 10 rows', type: 'muted' }])
    setVacRunning(false)
  }

  // Chunk tuples into pages of 5
  const padded = [...tuples]
  while (padded.length % 5 !== 0) padded.push(null)
  const pages = []
  for (let i = 0; i < padded.length; i += 5) pages.push(padded.slice(i, i + 5))

  const barColor =
    pct >= 100 ? 'bg-rose-500' :
    pct >= 60  ? 'bg-amber-500' :
    'bg-emerald-500'

  const logColor = {
    ok:   'text-emerald-400',
    warn: 'text-amber-400',
    info: 'text-sky-400',
    muted:'text-zinc-500',
  }

  return (
    <div className="viz-card">
      <p className="viz-title">↳ storage page simulator</p>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <StatCard label="Live tuples"  value={live.length}  color="text-emerald-600" />
        <StatCard label="Dead tuples"  value={dead.length}  color="text-rose-600"    />
        <StatCard label="Bloat ratio"  value={`${bloat}%`}  color="text-accent-600"  />
      </div>

      {/* Autovacuum threshold bar */}
      <div className="mb-6">
        <div className="flex justify-between mb-1.5">
          <span className="font-mono text-xs text-zinc-500">Autovacuum threshold</span>
          <span className="font-mono text-xs text-zinc-400">{dead.length} / {THRESHOLD} dead tuples</span>
        </div>
        <div className="h-2 bg-zinc-100 rounded-full overflow-hidden border border-zinc-200">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="font-mono text-[10px] text-zinc-400">0%</span>
          <span className="font-mono text-[10px] text-zinc-400">⚡ triggers at 100%</span>
          <span className="font-mono text-[10px] text-zinc-400">100%</span>
        </div>
      </div>

      {/* Page view */}
      <div className="space-y-2 mb-6 p-4 bg-zinc-50 rounded-xl border border-zinc-100">
        {pages.map((page, pi) => (
          <div key={pi} className="flex items-center gap-3">
            <span className="font-mono text-[10px] text-zinc-400 w-12 text-right shrink-0">
              page {pi + 1}
            </span>
            <div className="flex gap-2 flex-wrap">
              {page.map((t, ti) =>
                !t ? (
                  <div key={`empty-${ti}`} className="tuple-empty w-14 h-10" />
                ) : (
                  <div
                    key={t.id}
                    className={`w-14 h-10 flex flex-col items-center justify-center transition-all duration-300 ${
                      t.state === 'live' ? 'tuple-live' : 'tuple-dead'
                    }`}
                  >
                    <span className="font-mono text-[9px] opacity-60">t{t.id}</span>
                    <span className="font-mono text-[10px]">{t.val.slice(0, 5)}</span>
                  </div>
                )
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-2 mb-5">
        <button className="btn-sim"         onClick={doInsert}>INSERT row</button>
        <button className="btn-sim"         onClick={doUpdate}>UPDATE random</button>
        <button className="btn-sim-danger"  onClick={doDelete}>DELETE random</button>
        <button
          className="btn-sim-success"
          onClick={doVacuum}
          disabled={!dead.length || vacRunning}
        >
          {vacRunning ? 'VACUUM running…' : 'VACUUM'}
        </button>
        <button className="btn-sim ml-auto" onClick={doReset}>Reset</button>
      </div>

      {/* Log */}
      <div className="sim-log">
        {log.map((entry, i) => (
          <div key={i} className={`py-px ${logColor[entry.type] ?? 'text-zinc-500'}`}>
            {entry.msg}
          </div>
        ))}
      </div>
    </div>
  )
}
