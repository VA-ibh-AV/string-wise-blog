import { useEffect, useState } from 'react'

/**
 * Section 8 — the same payload leaving the parse/bridge service, stage by
 * stage. Go side: json.Marshal allocates the bytes (necessary), then
 * cloneSaramaMessage and WriteSaramaBatch each deep-copy them (not
 * necessary — nothing else holds a reference). Vector side: input arrives
 * as a refcounted Bytes and a LogEvent keeps its fields behind an Arc, so
 * a clone between stages is an atomic increment, not a memcpy.
 *
 * Throughput and payload size are sliders; the bytes/sec figures are plain
 * arithmetic on those, not measurements.
 */

const GO_STAGES = [
  { name: 'json.Marshal(event)',    note: 'allocates the payload — this one is necessary', copy: true, needed: true },
  { name: 'cloneSaramaMessage(m)',  note: 'deep copy; the original is never touched again', copy: true, needed: false },
  { name: 'WriteSaramaBatch(msgs)', note: 'copies again into sarama.ByteEncoder', copy: true, needed: false },
  { name: 'producer.SendMessages',  note: 'hands the last copy to sarama', copy: false },
]

const VEC_STAGES = [
  { name: 'source: Bytes::from(buf)', note: 'one allocation, refcount 1', rc: 1 },
  { name: 'transform: event.clone()', note: 'Arc refcount 2 — pointer bump, no memcpy', rc: 2 },
  { name: 'sink: encode + batch',     note: 'transform handle dropped, refcount 1', rc: 1 },
  { name: 'request sent, dropped',    note: 'refcount 0 — buffer freed once', rc: 0 },
]

function fmtBytes(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} MB`
  return `${(n / 1e3).toFixed(0)} KB`
}

export default function CopyChainSim() {
  const [step, setStep]       = useState(0)
  const [playing, setPlaying] = useState(false)
  const [fixed, setFixed]     = useState(false)
  const [sizeKB, setSizeKB]   = useState(2)
  const [eps, setEps]         = useState(100_000)

  useEffect(() => {
    if (!playing) return
    const iv = setInterval(() => setStep(s => (s >= GO_STAGES.length ? 0 : s + 1)), 900)
    return () => clearInterval(iv)
  }, [playing])

  const goStages = fixed ? GO_STAGES.filter(s => s.needed !== false) : GO_STAGES
  const goCopies = goStages.filter(s => s.copy).length
  const shownGo  = Math.min(step, goStages.length)
  const copiesSoFar = goStages.slice(0, shownGo).filter(s => s.copy).length
  const bytesPerSec = goCopies * sizeKB * 1024 * eps
  const wastedPerSec = (fixed ? 0 : 2) * sizeKB * 1024 * eps

  return (
    <div className="viz-card">
      <p className="viz-title">↳ one payload, two pipelines — copies vs. a shared handle</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        <div className="viz-panel">
          <p className="font-mono text-[10px] viz-muted uppercase tracking-widest mb-3">go parse/bridge service{fixed ? ' (fixed)' : ''}</p>
          <div className="flex flex-col gap-2">
            {goStages.map((s, i) => {
              const reached = i < shownGo
              const cls = !reached ? 'viz-chip' : s.copy ? (s.needed === false ? 'viz-chip viz-chip-bad' : 'viz-chip viz-chip-warn') : 'viz-chip viz-chip-ok'
              return (
                <div key={s.name} className={`${cls} items-start px-3 py-2`}>
                  <span className="font-mono text-[11px]">{s.name}</span>
                  <span className="font-mono text-[10px] opacity-80">{reached ? (s.copy ? `buffer #${goStages.slice(0, i + 1).filter(x => x.copy).length} — ${s.note}` : s.note) : '…'}</span>
                </div>
              )
            })}
          </div>
          <p className="font-mono text-[11px] viz-strong mt-3">buffers allocated: {copiesSoFar} × {sizeKB}KB</p>
        </div>

        <div className="viz-panel">
          <p className="font-mono text-[10px] viz-muted uppercase tracking-widest mb-3">vector pipeline</p>
          <div className="flex flex-col gap-2">
            {VEC_STAGES.map((s, i) => {
              const reached = i < step
              return (
                <div key={s.name} className={`${reached ? 'viz-chip viz-chip-ok' : 'viz-chip'} items-start px-3 py-2`}>
                  <span className="font-mono text-[11px]">{s.name}</span>
                  <span className="font-mono text-[10px] opacity-80">{reached ? s.note : '…'}</span>
                </div>
              )
            })}
          </div>
          <p className="font-mono text-[11px] viz-strong mt-3">
            buffers allocated: {step > 0 ? 1 : 0} × {sizeKB}KB · refcount {step > 0 ? VEC_STAGES[Math.min(step, VEC_STAGES.length) - 1].rc : '—'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="stat-card">
          <div className={`stat-value text-lg ${fixed ? '' : 'text-rose-600'}`}>{fmtBytes(bytesPerSec)}/s</div>
          <div className="stat-label">Go: payload bytes allocated + copied</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value text-lg ${fixed ? 'text-emerald-600' : 'text-rose-600'}`}>{fmtBytes(wastedPerSec)}/s</div>
          <div className="stat-label">of which pure waste (becomes garbage)</div>
        </div>
      </div>

      <div className="slider-row">
        <label className="slider-label">payload size</label>
        <input type="range" min="1" max="32" value={sizeKB} onChange={e => setSizeKB(+e.target.value)} className="flex-1" />
        <span className="slider-value">{sizeKB}KB</span>
      </div>
      <div className="slider-row">
        <label className="slider-label">events/sec</label>
        <input type="range" min="10000" max="200000" step="10000" value={eps} onChange={e => setEps(+e.target.value)} className="flex-1" />
        <span className="slider-value">{(eps / 1000).toFixed(0)}k</span>
      </div>

      <div className="flex flex-wrap gap-2 mt-4">
        <button className="btn-sim-accent" onClick={() => setStep(s => (s >= GO_STAGES.length ? 0 : s + 1))}>step →</button>
        <button className={playing ? 'btn-sim-danger' : 'btn-sim-success'} onClick={() => setPlaying(p => !p)}>{playing ? '⏸ pause' : '▶ play'}</button>
        <button className={fixed ? 'btn-sim-success' : 'btn-sim'} onClick={() => setFixed(f => !f)}>{fixed ? 'showing: redundant copies removed' : 'remove the two redundant copies'}</button>
        <button className="btn-sim ml-auto" onClick={() => { setStep(0); setPlaying(false) }}>reset</button>
      </div>
    </div>
  )
}
