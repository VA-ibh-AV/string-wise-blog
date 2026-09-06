import { useState } from 'react'

/**
 * Section 4 — select internals, and section 7.6's nil-channel case reuses
 * this same widget (toggle "chC is nil" below).
 *
 * selectgo() builds a poll order over every non-nil case, walks it once
 * looking for anything ready, and if more than one case is ready picks
 * pseudo-randomly among them — so two always-ready cases in one select
 * don't starve each other by source order. A nil channel is never added to
 * the poll order at all: not "checked and found not ready," just skipped,
 * which is why a nil case blocks forever without spinning a CPU. With no
 * default and nothing ready, the goroutine parks with one sudog per non-nil
 * case simultaneously — whichever fires first dequeues the sudogs on all
 * the others.
 */

export default function SelectFiring() {
  const [readyA, setReadyA]   = useState(false)
  const [readyB, setReadyB]   = useState(false)
  const [nilC, setNilC]       = useState(true)
  const [readyC, setReadyC]   = useState(false)
  const [hasDefault, setHasDefault] = useState(false)
  const [fired, setFired]     = useState(null)
  const [log, setLog]         = useState([])

  const cases = [
    { name: 'A', label: 'case v := <-chA:', ready: readyA, nil: false },
    { name: 'B', label: 'case v := <-chB:', ready: readyB, nil: false },
    { name: 'C', label: 'case v := <-chC:', ready: readyC, nil: nilC },
  ]

  const run = () => {
    const polled = cases.filter(c => !c.nil)
    const skipped = cases.filter(c => c.nil).map(c => c.name)
    const ready = polled.filter(c => c.ready)

    if (ready.length > 0) {
      const pick = ready[Math.floor(Math.random() * ready.length)]
      setFired(pick.name)
      setLog(prev => [...prev.slice(-5),
        `poll order: [${polled.map(c => c.name).join(', ')}]${skipped.length ? `, chC skipped (nil)` : ''} — ready: [${ready.map(c => c.name).join(', ')}]${ready.length > 1 ? ` — tie, pseudo-random pick` : ''} → case ${pick.name} fires`,
      ])
      return
    }
    if (hasDefault) {
      setFired('default')
      setLog(prev => [...prev.slice(-5), `poll order: [${polled.map(c => c.name).join(', ')}] — nothing ready, default: fires immediately, no parking`])
      return
    }
    setFired(null)
    setLog(prev => [...prev.slice(-5), `poll order: [${polled.map(c => c.name).join(', ')}] — nothing ready, no default → parks with ${polled.length} sudogs at once, one per case`])
  }

  return (
    <div className="viz-card">
      <p className="viz-title">↳ selectgo(): poll order, tie-break, and nil channels</p>

      <div className="grid grid-cols-3 gap-3 mb-5">
        {cases.map(c => (
          <div key={c.name} className={`viz-panel text-center ${fired === c.name ? 'viz-panel-active' : ''} ${c.nil ? 'opacity-40' : ''}`}>
            <p className="font-mono text-[10px] mb-2">{c.label}</p>
            <p className={`font-mono text-xs mb-3 ${c.nil ? 'text-rose-500' : c.ready ? 'text-emerald-600' : 'viz-dim'}`}>
              {c.nil ? 'nil — never polled' : c.ready ? 'ready' : 'not ready'}
            </p>
            {c.name !== 'C' ? (
              <button
                className={c.ready ? 'btn-sim-accent' : 'btn-sim'}
                onClick={() => (c.name === 'A' ? setReadyA(r => !r) : setReadyB(r => !r))}
              >
                toggle ready
              </button>
            ) : (
              <div className="flex flex-col gap-1">
                <button className={nilC ? 'btn-sim-danger' : 'btn-sim'} onClick={() => setNilC(n => !n)}>
                  {nilC ? 'chC is nil' : 'chC is a real channel'}
                </button>
                {!nilC && (
                  <button className={readyC ? 'btn-sim-accent' : 'btn-sim'} onClick={() => setReadyC(r => !r)}>toggle ready</button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 mb-5">
        <button className={hasDefault ? 'btn-sim-accent' : 'btn-sim'} onClick={() => setHasDefault(d => !d)}>
          {hasDefault ? 'default: included' : 'no default case'}
        </button>
        {fired && <span className={`font-mono text-[11px] ${fired === 'default' ? 'text-amber-600' : 'text-emerald-600'}`}>fired: {fired}</span>}
      </div>

      <div className="sim-log mb-5">
        {log.length === 0
          ? <p className="viz-dim">toggle readiness above, then run select</p>
          : log.map((l, i) => <div key={i}>{l}</div>)}
      </div>

      <button className="btn-sim-accent" onClick={run}>run select</button>
    </div>
  )
}
