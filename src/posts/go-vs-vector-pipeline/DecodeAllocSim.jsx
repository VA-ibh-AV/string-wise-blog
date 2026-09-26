import { useEffect, useState } from 'react'

/**
 * Section 7 — heap allocations per JSON token, three ways to handle the
 * nested "message" payload in parseSaramaMessage:
 *
 *   any       — json.Unmarshal into interface{}, then json.Marshal it back
 *   typed     — json.Unmarshal into a concrete struct
 *   raw       — json.Valid + pass the bytes through (json.RawMessage)
 *
 * Counts are illustrative, modelled on how encoding/json behaves rather
 * than measured on a specific Go version: every object becomes a
 * map[string]any (map header + buckets), every key a new string, every
 * string or number value a new string plus an interface box, every array
 * a growing []any. The typed decode still allocates string data but
 * nothing else. The raw path allocates nothing per token.
 */

const TOKENS = [
  { t: '{',                          any: 2, typed: 0, note: 'new map[string]any + bucket array' },
  { t: '"ts":',                      any: 1, typed: 0, note: 'map key → new string' },
  { t: '"2026-09-01T10:00:00Z"',     any: 2, typed: 1, note: 'string data + interface box' },
  { t: '"level":',                   any: 1, typed: 0, note: 'map key → new string' },
  { t: '"error"',                    any: 2, typed: 1, note: 'string data + interface box' },
  { t: '"svc":',                     any: 1, typed: 0, note: 'map key → new string' },
  { t: '"checkout"',                 any: 2, typed: 1, note: 'string data + interface box' },
  { t: '"tags":',                    any: 1, typed: 0, note: 'map key → new string' },
  { t: '[',                          any: 1, typed: 1, note: 'new []any backing array' },
  { t: '"db"',                       any: 2, typed: 1, note: 'string + box' },
  { t: '"retry"',                    any: 3, typed: 2, note: 'string + box + slice growth' },
  { t: ']',                          any: 0, typed: 0, note: '' },
  { t: '"http":',                    any: 1, typed: 0, note: 'map key → new string' },
  { t: '{',                          any: 2, typed: 0, note: 'nested map + buckets (typed: inline struct, free)' },
  { t: '"status":',                  any: 1, typed: 0, note: 'map key' },
  { t: '504',                        any: 1, typed: 0, note: 'float64 boxed into interface' },
  { t: '"ms":',                      any: 1, typed: 0, note: 'map key' },
  { t: '1203',                       any: 1, typed: 0, note: 'float64 boxed into interface' },
  { t: '}',                          any: 0, typed: 0, note: '' },
  { t: '}',                          any: 0, typed: 0, note: '' },
  { t: 'json.Marshal(v)',            any: 7, typed: 0, note: 'any path re-encodes what it just decoded: encode buffer, sorted key slices per map, output []byte' },
]

export default function DecodeAllocSim() {
  const [pos, setPos]         = useState(0)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    if (!playing) return
    const iv = setInterval(() => {
      setPos(p => Math.min(TOKENS.length, p + 1))
    }, 380)
    return () => clearInterval(iv)
  }, [playing])

  useEffect(() => {
    if (pos >= TOKENS.length) setPlaying(false)
  }, [pos])

  const seen = TOKENS.slice(0, pos)
  const anyTotal   = seen.reduce((a, t) => a + t.any, 0)
  const typedTotal = seen.reduce((a, t) => a + t.typed, 0)
  const current    = pos > 0 ? TOKENS[pos - 1] : null

  const column = (label, key, total, cls) => (
    <div className="viz-panel">
      <p className="font-mono text-[10px] viz-muted uppercase tracking-widest mb-2">{label}</p>
      <div className="flex flex-wrap gap-1 min-h-[52px] mb-2">
        {seen.flatMap((t, i) => Array.from({ length: t[key] }, (_, j) => (
          <span key={`${i}-${j}`} className={`inline-block w-3 h-3 rounded-sm ${cls}`} style={i === pos - 1 ? undefined : { opacity: 0.5 }} />
        )))}
      </div>
      <div className="stat-value text-lg">{total}</div>
      <div className="stat-label">heap allocations</div>
    </div>
  )

  return (
    <div className="viz-card">
      <p className="viz-title">↳ allocations per token — interface{'{}'} vs. struct vs. raw bytes</p>

      <div className="viz-panel mb-5 font-mono text-[12px] leading-7 break-all">
        {TOKENS.map((t, i) => (
          <span key={i} className={i === pos - 1 ? 'viz-tag viz-tag-hl mr-1' : i < pos ? 'viz-strong mr-1' : 'viz-muted mr-1'}>
            {t.t}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        {column('var v any + re-marshal', 'any', anyTotal, 'viz-cell-paused')}
        {column('typed struct', 'typed', typedTotal, 'viz-cell-active')}
        <div className="viz-panel">
          <p className="font-mono text-[10px] viz-muted uppercase tracking-widest mb-2">json.Valid + RawMessage</p>
          <div className="min-h-[52px] mb-2 font-mono text-[11px] viz-dim">scans the bytes to check syntax, builds nothing</div>
          <div className="stat-value text-lg text-emerald-600">0</div>
          <div className="stat-label">heap allocations</div>
        </div>
      </div>

      <p className="font-mono text-[11px] viz-dim mb-4 min-h-[32px]">
        {current
          ? `${current.t} — ${current.note || 'closing token, nothing new'}`
          : 'Step through the nested "message" payload. Red squares are allocations the generic decode makes, one token at a time.'}
      </p>

      <div className="flex flex-wrap gap-2">
        <button className="btn-sim-accent" disabled={pos >= TOKENS.length} onClick={() => setPos(p => Math.min(TOKENS.length, p + 1))}>next token →</button>
        <button className={playing ? 'btn-sim-danger' : 'btn-sim-success'} onClick={() => { if (pos >= TOKENS.length) setPos(0); setPlaying(p => !p) }}>
          {playing ? '⏸ pause' : '▶ play'}
        </button>
        <button className="btn-sim ml-auto" onClick={() => { setPos(0); setPlaying(false) }}>reset</button>
      </div>
    </div>
  )
}
