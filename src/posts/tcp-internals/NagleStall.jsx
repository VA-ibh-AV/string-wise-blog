import { useEffect, useRef, useState } from 'react'

/**
 * Section 7 — Nagle's algorithm meeting delayed ACKs.
 *
 * Two optimisations that are individually sensible and jointly pathological.
 * Nagle will not send a second small segment while an earlier one is still
 * unacknowledged; the peer's delayed-ACK timer will not acknowledge a lone
 * segment for up to 40ms, hoping to piggyback the ACK on a reply. Neither side
 * is broken, and the round trip takes 100ms instead of 20ms.
 *
 * Three writes of 50 bytes, one-way delay 20ms, drawn on a real time axis.
 */

const ONE_WAY   = 20
const DELACK_MS = 40      // Linux caps the delayed-ACK timer at 40ms
const SPAN      = 130     // ms drawn on the axis
const WRITES    = 3
const BYTES     = 50

/** Builds the whole timeline for a given pair of socket options. */
function timeline({ nodelay, quickack }) {
  const ev = []
  const add = (row, t, dur, label, tone) => ev.push({ row, t, dur, label, tone })

  add('app', 0, 3, `${WRITES} × write(${BYTES}B)`, 'accent')

  if (nodelay) {
    // TCP_NODELAY: every write goes out the moment it is written.
    add('sender', 0, 3, `send ${WRITES * BYTES}B — no Nagle hold`, 'accent')
    add('wire', 0, ONE_WAY, `${WRITES * BYTES}B in flight`, 'accent')
    add('receiver', ONE_WAY, 4, 'full message delivered to app', 'green')
    return { ev, complete: ONE_WAY, note: 'The application sees the whole message after one one-way delay. The ACK rides back on the reply.' }
  }

  // Nagle: the first segment goes immediately, because nothing is unacked yet.
  add('sender', 0, 3, `send ${BYTES}B (nothing unacked yet)`, 'accent')
  add('wire', 0, ONE_WAY, `${BYTES}B in flight`, 'accent')
  add('receiver', ONE_WAY, 3, `${BYTES}B received — partial message`, 'warn')

  const ackAt = quickack ? ONE_WAY : ONE_WAY + DELACK_MS
  if (!quickack) {
    add('receiver', ONE_WAY, DELACK_MS, `delayed ACK timer — ${DELACK_MS}ms of nothing`, 'bad')
  }
  add('sender', 3, ackAt + ONE_WAY - 3, `Nagle holds ${(WRITES - 1) * BYTES}B — waiting for the ACK`, 'bad')

  add('receiver', ackAt, 3, 'ACK sent', 'green')
  add('wire', ackAt, ONE_WAY, 'ACK in flight', 'green')

  const release = ackAt + ONE_WAY
  add('sender', release, 3, `ACK in — release ${(WRITES - 1) * BYTES}B`, 'accent')
  add('wire', release, ONE_WAY, `${(WRITES - 1) * BYTES}B in flight`, 'accent')
  add('receiver', release + ONE_WAY, 4, 'full message delivered to app', 'green')

  return {
    ev,
    complete: release + ONE_WAY,
    note: quickack
      ? 'TCP_QUICKACK removes the 40ms wait, but Nagle still costs you an extra round trip before the tail of the message moves.'
      : `Nagle is waiting for an ACK. The ACK is waiting for a reply. The reply is waiting for the rest of the message. ${DELACK_MS}ms of dead air, on every single request.`,
  }
}

const TONES = {
  accent: { bg: 'color-mix(in srgb, var(--accent) 16%, var(--surface-solid))', bd: 'var(--accent)',  fg: 'var(--accent-strong)' },
  green:  { bg: 'color-mix(in srgb, var(--green) 14%, var(--surface-solid))',  bd: 'var(--green)',   fg: 'var(--green)' },
  warn:   { bg: 'color-mix(in srgb, #f59e0b 14%, var(--surface-solid))',       bd: '#f59e0b',        fg: '#d08700' },
  bad:    { bg: 'color-mix(in srgb, #ef4444 12%, var(--surface-solid))',       bd: '#ef6b73',        fg: '#ef6b73' },
}

const ROWS = [
  { key: 'app',      label: 'application' },
  { key: 'sender',   label: 'sender TCP' },
  { key: 'wire',     label: 'wire' },
  { key: 'receiver', label: 'receiver' },
]

export default function NagleStall() {
  const [nodelay, setNodelay]   = useState(false)
  const [quickack, setQuickack] = useState(false)
  const [now, setNow]           = useState(SPAN)
  const [running, setRunning]   = useState(false)

  const { ev, complete, note } = timeline({ nodelay, quickack })
  const baseline = timeline({ nodelay: true, quickack: false }).complete

  const latest = useRef({})
  latest.current = { complete }

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => {
      setNow(v => {
        if (v >= SPAN) { setRunning(false); return SPAN }
        return v + 2
      })
    }, 30)
    return () => clearInterval(t)
  }, [running])

  const replay = () => { setNow(0); setRunning(true) }
  const setOpt = fn => { fn(); setNow(SPAN); setRunning(false) }

  const pct = t => (t / SPAN) * 100

  return (
    <div className="viz-card">
      <p className="viz-title">↳ Nagle × delayed ACK = 40ms of nothing</p>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="stat-card">
          <div className={`stat-value text-lg ${complete > baseline ? 'text-rose-600' : ''}`} style={complete <= baseline ? { color: 'var(--green)' } : undefined}>
            {complete}ms
          </div>
          <div className="stat-label">message complete at</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-lg">{baseline}ms</div>
          <div className="stat-label">best case (one-way delay)</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value text-lg ${complete > baseline ? 'text-rose-600' : ''}`}>
            {complete === baseline ? '1.0×' : `${(complete / baseline).toFixed(1)}×`}
          </div>
          <div className="stat-label">latency multiplier</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <button
          className={nodelay ? 'btn-sim-success' : 'btn-sim'}
          onClick={() => setOpt(() => setNodelay(v => !v))}
        >
          TCP_NODELAY {nodelay ? 'on' : 'off'}
        </button>
        <button
          className={quickack ? 'btn-sim-success' : 'btn-sim'}
          onClick={() => setOpt(() => setQuickack(v => !v))}
          disabled={nodelay}
        >
          TCP_QUICKACK {quickack ? 'on' : 'off'}
        </button>
        <button className="btn-sim-accent ml-auto" onClick={replay}>replay</button>
      </div>

      <div className="viz-panel mb-4">
        {ROWS.map(row => (
          <div key={row.key} className="flex items-center gap-3 mb-1.5">
            <span className="font-mono text-[9px] viz-muted w-[72px] shrink-0 text-right">{row.label}</span>
            <div className="relative flex-1 h-8 rounded-md" style={{ background: 'var(--surface-solid)', border: '1px solid var(--border-soft)' }}>
              {ev.filter(e => e.row === row.key && e.t <= now).map((e, i) => {
                const tone = TONES[e.tone]
                const visibleDur = Math.max(1.5, Math.min(e.dur, now - e.t))
                return (
                  <div
                    key={i}
                    className="absolute top-1 bottom-1 rounded-[4px] border flex items-center px-1.5 overflow-hidden"
                    style={{
                      left: `${pct(e.t)}%`,
                      width: `${pct(visibleDur)}%`,
                      background: tone.bg,
                      borderColor: tone.bd,
                      minWidth: 4,
                    }}
                    title={`${e.label} — starts at ${e.t}ms`}
                  >
                    <span className="font-mono text-[9px] whitespace-nowrap" style={{ color: tone.fg }}>{e.label}</span>
                  </div>
                )
              })}
              {now < SPAN && (
                <div className="absolute top-0 bottom-0" style={{ left: `${pct(now)}%`, width: 1, background: 'var(--ink-faint)' }} />
              )}
            </div>
          </div>
        ))}

        <div className="flex items-center gap-3 mt-2">
          <span className="w-[72px] shrink-0" />
          <div className="relative flex-1 h-4">
            {[0, 20, 40, 60, 80, 100, 120].map(t => (
              <span key={t} className="absolute font-mono text-[9px] viz-muted" style={{ left: `${pct(t)}%`, transform: 'translateX(-50%)' }}>
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>

      <p className="font-mono text-[11px] viz-dim mb-4">{note}</p>

      <p className="font-mono text-[10px] viz-muted">
        Rule of thumb: set <code>TCP_NODELAY</code> on anything request/response — RPC, HTTP, database drivers, Redis clients.
        Leave Nagle on for bulk streaming where you would rather have full segments than low latency.
      </p>
    </div>
  )
}
