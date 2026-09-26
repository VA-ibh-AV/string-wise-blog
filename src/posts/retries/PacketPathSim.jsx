import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { packetPath, ACCEPT_RATE } from './packetPath'
import { C } from './charts'

/**
 * Section 5: the packet path under a retry storm. Steady-state numbers come
 * from packetPath.js. The counters tick up in real time from those rates, the
 * way `watch nstat` would show them.
 */

const TICK = 300
const COUNTERS = [
  { key: 'TcpExtListenOverflows', from: 'accept' },
  { key: 'TcpExtTCPSynRetrans',   from: 'retrans' },
  { key: 'conntrack -S drop',     from: 'ct' },
  { key: 'EADDRNOTAVAIL',         from: 'client' },
]

const color = use => (use >= 1 ? C.bad : use >= 0.75 ? C.warn : C.ok)

export default function PacketPathSim() {
  const [rate, setRate] = useState(400)
  const [keepAlive, setKeepAlive] = useState(false)
  const [counts, setCounts] = useState(() => Object.fromEntries(COUNTERS.map(c => [c.key, 0])))
  const [dots, setDots] = useState([])
  const nextId = useRef(0)
  const model = packetPath(rate, keepAlive)
  const modelRef = useRef(model)
  modelRef.current = model

  useEffect(() => {
    const iv = setInterval(() => {
      const m = modelRef.current
      const byId = Object.fromEntries(m.stages.map(s => [s.id, s]))
      setCounts(prev => {
        const next = { ...prev }
        for (const c of COUNTERS) {
          const perSec = c.from === 'retrans' ? m.retrans : byId[c.from].drop
          next[c.key] = prev[c.key] + Math.round(perSec * TICK / 1000)
        }
        return next
      })
      const born = []
      m.stages.forEach((s, i) => {
        if (s.drop <= 0) return
        const n = Math.min(3, 1 + Math.floor(Math.log10(s.drop)))
        for (let k = 0; k < n; k++) born.push({ id: nextId.current++, stage: i, dx: (k - 1) * 12 + (Math.random() - 0.5) * 8 })
      })
      if (born.length) setDots(d => [...d.slice(-40), ...born])
    }, TICK)
    return () => clearInterval(iv)
  }, [])

  const resetCounters = () => setCounts(Object.fromEntries(COUNTERS.map(c => [c.key, 0])))
  const red = model.stages.filter(s => s.use >= 1)

  return (
    <div className="viz-card">
      <p className="viz-title">↳ packet path under a storm</p>

      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 mb-2">
        {model.stages.map((s, i) => (
          <div key={s.id} className="relative">
            <div className={`viz-panel h-full ${s.use >= 1 ? 'viz-panel-active' : ''}`} style={s.use >= 1 ? { borderColor: C.bad } : undefined}>
              <p className="font-mono text-[11px] viz-strong mb-2">{i > 0 && <span className="viz-muted">→ </span>}{s.name}</p>
              <div className="h-16 w-full rounded-md overflow-hidden flex flex-col justify-end" style={{ background: 'var(--surface-solid)', border: '1px solid var(--border)' }}>
                <div className="w-full transition-all duration-300" style={{ height: `${Math.min(100, s.use * 100)}%`, background: color(s.use), opacity: 0.8 }} />
              </div>
              <p className="font-mono text-[10px] viz-dim mt-2 leading-tight">{s.use >= 1 ? 'FULL' : `${Math.round(s.use * 100)}%`}</p>
              <p className="font-mono text-[9px] viz-muted leading-tight">{s.sub}</p>
            </div>
            <div className="pointer-events-none absolute left-1/2 bottom-0 h-0 overflow-visible">
              <AnimatePresence>
                {dots.filter(d => d.stage === i).map(d => (
                  <motion.span key={d.id} className="absolute block rounded-full" style={{ width: 6, height: 6, background: C.bad, left: d.dx }}
                    initial={{ y: -10, opacity: 1 }} animate={{ y: 30, opacity: 0 }} exit={{ opacity: 0 }}
                    transition={{ duration: 0.9, ease: 'easeIn' }}
                    onAnimationComplete={() => setDots(ds => ds.filter(x => x.id !== d.id))} />
                ))}
              </AnimatePresence>
            </div>
          </div>
        ))}
      </div>
      <div className="h-8" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {COUNTERS.map(c => (
          <div className="stat-card" key={c.key}>
            <div className="stat-value text-lg" style={{ color: counts[c.key] > 0 ? C.bad : undefined }}>{counts[c.key].toLocaleString()}</div>
            <div className="stat-label break-all">{c.key}</div>
          </div>
        ))}
      </div>

      <div className="slider-row">
        <label className="slider-label">requests/s (retries included)</label>
        <input type="range" min="100" max="6000" step="100" value={rate} onChange={e => setRate(+e.target.value)} className="flex-1" />
        <span className="slider-value">{rate.toLocaleString()}</span>
      </div>
      <p className="font-mono text-[11px] viz-dim mb-2">
        {keepAlive
          ? `${Math.round(model.conns).toLocaleString()} new connections/s — about 50 requests ride each one.`
          : `${rate.toLocaleString()} new connections/s, one per request${model.retrans > 1 ? `, plus ${Math.round(model.retrans).toLocaleString()} SYN retransmits/s from the kernel` : ''}.`}
        {' '}Served: {Math.round(model.goodput).toLocaleString()} req/s.
      </p>
      <p className="font-mono text-[11px] viz-muted mb-4">
        {red.length
          ? `overflowing: ${red.map(s => s.counter ? `${s.name} ("${s.counter}")` : s.name).join(', ')}.`
          : !keepAlive && rate > ACCEPT_RATE * 0.75 ? 'getting close: the app can only finish about 800 TLS handshakes a second.' : 'every stage has headroom.'}
      </p>

      <div className="flex flex-wrap gap-2">
        <button className={keepAlive ? 'btn-sim-accent' : 'btn-sim'} onClick={() => setKeepAlive(k => !k)}>
          {keepAlive ? '✓ reuse connections (keep-alive)' : 'reuse connections (keep-alive)'}
        </button>
        <button className="btn-sim ml-auto" onClick={resetCounters}>reset counters</button>
      </div>
    </div>
  )
}
