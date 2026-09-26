import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { createSim, step, TICK_MS } from './model'
import { LineChart, C } from './charts'

/**
 * Section 7: the sustaining loop. Same model as the storm simulator, tuned so
 * the server has 30% headroom (100 req/s of demand, 130 req/s of capacity)
 * and clients make up to 3 attempts. The trigger is a 10s outage. With naive
 * retries the loop keeps itself going after the trigger is gone.
 */

const WINDOW = 600 // 60s
const OUTAGE = 100 // 10s
const BASE = { rate: 100, capacity: 130, maxAttempts: 3 }
const MODES = [
  { id: 'naive',  label: 'naive: exponential',     p: { policy: 'exp' } },
  { id: 'jitter', label: 'jitter only',            p: { policy: 'jitter' } },
  { id: 'shed',   label: 'jitter + load shedding', p: { policy: 'jitter', shed: true } },
  { id: 'budget', label: 'jitter + retry budget',  p: { policy: 'jitter', budget: true } },
]

const fresh = () => ({ sim: createSim({ clients: 200, seed: 5 }), history: [], downUntil: -1, marks: [] })

function avg(rows, key, n = 10) {
  const w = rows.slice(-n)
  return w.length ? w.reduce((a, r) => a + r[key], 0) / w.length : 0
}

// four nodes on a loop, clockwise from the top
const NODES = [
  { key: 'load',     label: 'load',     x: 170, y: 40 },
  { key: 'latency',  label: 'latency',  x: 300, y: 120 },
  { key: 'timeouts', label: 'timeouts', x: 170, y: 200 },
  { key: 'retries',  label: 'retries',  x: 40,  y: 120 },
]

function Loop({ values }) {
  return (
    <svg viewBox="-12 0 364 240" className="block w-full max-w-[420px] mx-auto" role="img" aria-label="load, latency, timeouts and retries feeding each other">
      <defs>
        <marker id="ml-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--ink-faint)" />
        </marker>
      </defs>
      {NODES.map((n, i) => {
        const to = NODES[(i + 1) % NODES.length]
        const heat = values[n.key].heat
        const mx = (n.x + to.x) / 2 + (to.y - n.y) * 0.25
        const my = (n.y + to.y) / 2 - (to.x - n.x) * 0.25
        const d = `M${n.x + (to.x - n.x) * 0.22},${n.y + (to.y - n.y) * 0.22} Q${mx},${my} ${to.x - (to.x - n.x) * 0.22},${to.y - (to.y - n.y) * 0.22}`
        return (
          <motion.path key={n.key} d={d} fill="none" markerEnd="url(#ml-arrow)"
            stroke={heat > 0.66 ? C.bad : heat > 0.33 ? C.warn : 'var(--ink-faint)'}
            strokeWidth={1.5 + heat * 4}
            animate={heat > 0.5 ? { opacity: [0.35, 1, 0.35] } : { opacity: 0.6 }}
            transition={heat > 0.5 ? { duration: 1.6 - heat, repeat: Infinity } : { duration: 0.3 }} />
        )
      })}
      {NODES.map(n => {
        const v = values[n.key]
        return (
          <g key={n.key}>
            <rect x={n.x - 44} y={n.y - 20} width={88} height={40} rx={10}
              fill="var(--surface-solid)" stroke={v.heat > 0.66 ? C.bad : 'var(--border)'} strokeWidth={v.heat > 0.66 ? 2 : 1} />
            <text x={n.x} y={n.y - 4} textAnchor="middle" className="sim-chart-label">{n.label}</text>
            <text x={n.x} y={n.y + 11} textAnchor="middle" style={{ fill: 'var(--ink)', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600 }}>{v.text}</text>
          </g>
        )
      })}
    </svg>
  )
}

export default function MetastableLoop() {
  const [mode, setMode] = useState('naive')
  const [running, setRunning] = useState(false)
  const [, setFrame] = useState(0)
  const ref = useRef(null)
  if (ref.current === null) ref.current = fresh()
  const modeRef = useRef(mode)
  modeRef.current = mode

  useEffect(() => {
    if (!running) return
    const iv = setInterval(() => {
      const r = ref.current
      const m = MODES.find(x => x.id === modeRef.current)
      const row = step(r.sim, { ...BASE, ...m.p, down: r.sim.t < r.downUntil })
      r.history.push(row)
      if (r.history.length > WINDOW) r.history.shift()
      setFrame(f => f + 1)
    }, TICK_MS)
    return () => clearInterval(iv)
  }, [running])

  const trigger = () => {
    const r = ref.current
    const t = r.sim.t
    r.downUntil = t + OUTAGE
    r.marks = [{ x: t, label: 'trigger' }, { x: t + OUTAGE, label: 'the outage ended here →', anchor: 'end', dy: 12 }]
    if (!running) setRunning(true)
  }
  const reset = () => { ref.current = fresh(); setFrame(f => f + 1) }
  const switchMode = (id) => { setMode(id); reset() }

  const { sim, history, downUntil, marks } = ref.current
  const down = sim.t < downUntil
  const offered = avg(history, 'offered')
  const queue = history.length ? history[history.length - 1].queue : 0
  const latencyMs = Math.min(9999, (queue / BASE.capacity) * 1000)
  const timeouts = avg(history, 'timeouts')
  const retries = avg(history, 'retries')
  const goodput = avg(history, 'goodput')
  const values = {
    load:     { heat: Math.min(1, Math.max(0, (offered / BASE.capacity - 0.6) / 1.2)), text: `${Math.round((offered / BASE.capacity) * 100)}%` },
    latency:  { heat: Math.min(1, latencyMs / 1000), text: latencyMs >= 1000 ? `${(latencyMs / 1000).toFixed(1)}s` : `${Math.round(latencyMs)}ms` },
    timeouts: { heat: Math.min(1, timeouts / 100), text: `${Math.round(timeouts)}/s` },
    retries:  { heat: Math.min(1, retries / 100), text: `${Math.round(retries)}/s` },
  }
  const x0 = history.length ? history[0].t : 0
  const endedAt = marks[1]?.x
  const stuck = endedAt != null && sim.t > endedAt + 100 && goodput < 20

  return (
    <div className="viz-card">
      <p className="viz-title">↳ metastable loop</p>

      <div className="grid gap-4 md:grid-cols-2 mb-5 items-center">
        <div className="viz-panel"><Loop values={values} /></div>
        <div className="viz-panel">
          {history.length < 2
            ? <div className="h-44 flex items-center justify-center"><p className="font-mono text-xs viz-muted">press start, then pull the trigger</p></div>
            : <LineChart
                data={history}
                xDomain={[x0, x0 + WINDOW]}
                series={[{ key: 'goodput', className: 'sim-chart-line-alt' }, { key: 'offered', className: 'sim-chart-line-muted' }]}
                hlines={[{ y: BASE.capacity, label: 'capacity' }]}
                vmarks={marks}
                yMax={400}
                width={400}
                height={240}
                label="req/s, last 60s · dashed: goodput, thin: offered"
              />}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {MODES.map(m => (
          <button key={m.id} className={mode === m.id ? 'btn-sim-accent' : 'btn-sim'} onClick={() => switchMode(m.id)}>{m.label}</button>
        ))}
      </div>
      <p className="font-mono text-[11px] viz-dim mb-4">
        {down
          ? 'trigger active: the server is down.'
          : stuck
            ? 'the trigger is gone. the server is healthy. goodput is still zero: every attempt waits behind abandoned work, times out, and retries.'
            : `demand 100 req/s, capacity ${BASE.capacity} req/s, timeout 1s, up to ${BASE.maxAttempts} attempts.`}
      </p>

      <div className="flex flex-wrap gap-2">
        <button className={running ? 'btn-sim-danger' : 'btn-sim-success'} onClick={() => setRunning(r => !r)}>
          {running ? '⏸ pause' : '▶ start'}
        </button>
        <button className="btn-sim-danger" onClick={trigger} disabled={down}>trigger: 10s outage</button>
        <button className="btn-sim ml-auto" onClick={reset}>reset</button>
      </div>
    </div>
  )
}
