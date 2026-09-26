import { useState } from 'react'

/**
 * Section 6 — cost per call of one field-extraction regex on a ~300-byte
 * log line, Go regexp vs. Rust regex, under the choices that actually move
 * the number. Both engines are RE2-class (no backtracking blowup), so every
 * figure here is a constant factor, not a complexity class.
 *
 * Figures are illustrative, shaped after typical go test -bench / criterion
 * results rather than taken from one machine. Worth noticing: compiling per
 * call is worse in Rust than in Go — regex::Regex::new does more up-front
 * work (literal extraction, prefilter setup) precisely so matching is cheap.
 */

const COST = {
  go:   { compile: 18000, compileAllocs: 40, match: 900, captureExtra: 700, captureAllocs: 2, unanchoredMul: 1.9 },
  rust: { compile: 45000, compileAllocs: 60, match: 140, captureExtra: 220, captureAllocs: 1, unanchoredMul: 1.15 },
}

function costFor(side, { perCall, captures, unanchored }) {
  const c = COST[side]
  let ns = c.match * (unanchored ? c.unanchoredMul : 1)
  let allocs = 0
  if (captures) { ns += c.captureExtra; allocs += c.captureAllocs }
  if (perCall)  { ns += c.compile; allocs += c.compileAllocs }
  return { ns: Math.round(ns), allocs }
}

function fmt(n) { return n.toLocaleString('en-US') }

function BarRow({ label, goVal, rustVal, unit }) {
  const max = Math.max(goVal, rustVal, 1)
  const bar = (v, color) => (
    <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: 'var(--surface-muted)' }}>
      <div className="h-full rounded-full transition-all duration-300" style={{ width: `${Math.max(1, Math.round((v / max) * 100))}%`, background: color }} />
    </div>
  )
  return (
    <div className="mb-3">
      <span className="font-mono text-[11px] viz-muted">{label}</span>
      <div className="flex items-center gap-2 mt-1 mb-1">
        <span className="font-mono text-[10px] viz-muted w-12 shrink-0">Go</span>
        {bar(goVal, 'var(--accent)')}
        <span className="font-mono text-[10px] viz-strong w-24 text-right shrink-0">{fmt(goVal)}{unit}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] viz-muted w-12 shrink-0">Rust</span>
        {bar(rustVal, 'var(--green)')}
        <span className="font-mono text-[10px] viz-strong w-24 text-right shrink-0">{fmt(rustVal)}{unit}</span>
      </div>
    </div>
  )
}

const TOGGLES = [
  { key: 'perCall',    on: 'MustCompile inside the handler', off: 'compiled once, package-level var' },
  { key: 'captures',   on: 'FindStringSubmatch (captures)',  off: 'MatchString (no captures)' },
  { key: 'unanchored', on: 'unanchored .* prefix',           off: 'anchored ^ with a literal' },
]

export default function RegexCostBars() {
  const [opts, setOpts] = useState({ perCall: true, captures: true, unanchored: true })
  const go = costFor('go', opts)
  const rust = costFor('rust', opts)
  const bestGo = costFor('go', { perCall: false, captures: opts.captures, unanchored: false })

  return (
    <div className="viz-card">
      <p className="viz-title">↳ same regex, same algorithm class — where the constant factor goes</p>

      <div className="flex flex-col gap-2 mb-5">
        {TOGGLES.map(t => (
          <button key={t.key} className={opts[t.key] ? 'btn-sim-danger text-left' : 'btn-sim-success text-left'} onClick={() => setOpts(o => ({ ...o, [t.key]: !o[t.key] }))}>
            {opts[t.key] ? `✗ ${t.on}` : `✓ ${t.off}`}
          </button>
        ))}
      </div>

      <BarRow label="time per log line" goVal={go.ns} rustVal={rust.ns} unit=" ns" />
      <BarRow label="heap allocations per log line" goVal={go.allocs} rustVal={rust.allocs} unit="" />

      <p className="font-mono text-[11px] viz-dim mt-4">
        {opts.perCall
          ? `Compile-per-call dominates both sides — Rust's is actually the more expensive compile. At 1 lakh events/s this alone is ${(go.ns * 100_000 / 1e9).toFixed(1)} core-seconds per second in Go. Fix it first; nothing else on this card matters until you do.`
          : `With compile hoisted out, ${opts.unanchored ? `anchoring the pattern would take Go from ${fmt(go.ns)} to ${fmt(bestGo.ns)} ns.` : 'and the pattern anchored, Go is as cheap as this regex gets.'} What's left between Go and Rust is engine-level: Rust's lazy DFA and SIMD literal prefilters (memchr, Teddy) vs. Go's NFA/backtracker with a simpler literal prefix check.`}
      </p>
    </div>
  )
}
