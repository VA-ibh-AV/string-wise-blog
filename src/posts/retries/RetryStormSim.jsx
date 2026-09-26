import { useEffect, useRef, useState } from 'react'
import { createSim, step, clientState, POLICIES, TICK_MS } from './model'
import { LineChart, C } from './charts'

/**
 * Section 2: the retry storm. Runs the shared model in model.js live, one
 * tick per 100ms of wall time. Each client sends 0.5 user req/s, so 200
 * clients is 100 req/s of real demand against a server with some headroom.
 *
 * "Kill server for 5s" takes the server down: attempts fail at once with
 * connection refused, and every client's backoff timer starts at the same
 * instant. That shared instant is what fixed-delay retries preserve and
 * jitter destroys.
 */

const WINDOW = 300          // 30s of history on the chart
const PER_CLIENT_RATE = 0.5 // req/s
const OUTAGE_TICKS = 50
const STATE_COLOR = [C.idle, C.accent, C.warn, C.bad, C.ok]

const fresh = (clients) => ({ sim: createSim({ clients, seed: 11 }), history: [], downUntil: -1, marks: [] })

function avg(rows, key, n = 10) {
  const w = rows.slice(-n)
  return w.length ? w.reduce((a, r) => a + r[key], 0) / w.length : 0
}

export default function RetryStormSim() {
  const [clients, setClients]         = useState(200)
  const [capacity, setCapacity]       = useState(150)
  const [policy, setPolicy]           = useState('fixed')
  const [maxAttempts, setMaxAttempts] = useState(4)
  const [running, setRunning]         = useState(false)
  const [, setFrame]                  = useState(0)
  const ref = useRef(null)
  if (ref.current === null) ref.current = fresh(200)
  const params = useRef({})
  params.current = { capacity, policy, maxAttempts, rate: clients * PER_CLIENT_RATE }

  useEffect(() => {
    if (!running) return
    const iv = setInterval(() => {
      const r = ref.current
      const p = params.current
      const down = r.sim.t < r.downUntil
      const row = step(r.sim, { ...p, down })
      row.capacity = p.capacity
      r.history.push(row)
      if (r.history.length > WINDOW) r.history.shift()
      setFrame(f => f + 1)
    }, TICK_MS)
    return () => clearInterval(iv)
  }, [running])

  const reset = (n = clients) => {
    ref.current = fresh(n)
    setFrame(f => f + 1)
  }

  const kill = () => {
    const r = ref.current
    r.downUntil = r.sim.t + OUTAGE_TICKS
    r.marks.push({ x: r.sim.t, label: 'server dies' }, { x: r.sim.t + OUTAGE_TICKS, label: 'back up', dy: 12 })
    if (!running) setRunning(true)
  }

  const { sim, history, downUntil, marks } = ref.current
  const down = sim.t < downUntil
  const offered = avg(history, 'offered')
  const goodput = avg(history, 'goodput')
  const retries = avg(history, 'retries')
  const queue = history.length ? history[history.length - 1].queue : 0
  const load = offered / capacity
  const x0 = history.length ? history[0].t : 0

  const states = []
  for (let c = 0; c < sim.clients; c++) states.push(clientState(sim, c))
  const cols = Math.ceil(Math.sqrt(sim.clients * 2))

  return (
    <div className="viz-card">
      <p className="viz-title">↳ retry storm simulator</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <div className="stat-card">
          <div className="stat-value text-lg" style={{ color: load > 1 ? C.bad : undefined }}>{offered.toFixed(0)}</div>
          <div className="stat-label">offered req/s</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-lg" style={{ color: C.ok }}>{goodput.toFixed(0)}</div>
          <div className="stat-label">goodput req/s</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-lg" style={{ color: retries > 0 ? C.warn : undefined }}>{retries.toFixed(0)}</div>
          <div className="stat-label">of which retries</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-lg">{queue}</div>
          <div className="stat-label">server queue depth</div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_180px] mb-5">
        <div className="viz-panel">
          <svg viewBox={`0 0 ${cols * 10} ${Math.ceil(sim.clients / cols) * 10}`} className="block w-full" role="img" aria-label="client states">
            {states.map((st, i) => (
              <circle key={i} cx={(i % cols) * 10 + 5} cy={Math.floor(i / cols) * 10 + 5} r={3.4} fill={STATE_COLOR[st]} />
            ))}
          </svg>
          <div className="flex flex-wrap gap-3 mt-3 font-mono text-[10px] viz-muted">
            <span><span style={{ color: C.accent }}>●</span> in flight</span>
            <span><span style={{ color: C.warn }}>●</span> waiting to retry</span>
            <span><span style={{ color: C.bad }}>●</span> gave up</span>
            <span><span style={{ color: C.ok }}>●</span> succeeded</span>
          </div>
        </div>
        <div className={`viz-panel flex flex-col gap-3 ${down ? 'viz-panel-active' : ''}`}>
          <p className="font-mono text-[11px] viz-strong">{down ? 'server: DOWN' : 'server: up'}</p>
          <div>
            <p className="font-mono text-[10px] viz-muted mb-1">offered vs capacity</p>
            <div className="h-3 rounded-full overflow-hidden" style={{ background: 'var(--surface-solid)', border: '1px solid var(--border)' }}>
              <div className="h-full transition-all duration-200" style={{ width: `${Math.min(100, load * 100)}%`, background: load > 1 ? C.bad : load > 0.8 ? C.warn : C.ok }} />
            </div>
            <p className="font-mono text-[10px] viz-dim mt-1">{(load * 100).toFixed(0)}% of {capacity} req/s</p>
          </div>
          <div>
            <p className="font-mono text-[10px] viz-muted mb-1">queue (timeout = 1s)</p>
            <div className="h-3 rounded-full overflow-hidden" style={{ background: 'var(--surface-solid)', border: '1px solid var(--border)' }}>
              <div className="h-full transition-all duration-200" style={{ width: `${Math.min(100, (queue / (capacity * 2)) * 100)}%`, background: queue > capacity ? C.bad : C.accent }} />
            </div>
            <p className="font-mono text-[10px] viz-dim mt-1">{queue > capacity ? 'deeper than 1s of work: everything times out' : `${((queue / capacity) * 1000).toFixed(0)}ms of waiting`}</p>
          </div>
        </div>
      </div>

      <div className="viz-panel mb-5">
        {history.length < 2
          ? <div className="h-44 flex items-center justify-center"><p className="font-mono text-xs viz-muted">press start, then kill the server</p></div>
          : <LineChart
              data={history}
              xDomain={[x0, x0 + WINDOW]}
              series={[{ key: 'offered', className: 'sim-chart-line' }, { key: 'goodput', className: 'sim-chart-line-alt' }]}
              hlines={[{ y: capacity, label: 'capacity' }]}
              vmarks={marks}
              yMax={Math.max(capacity * 2, ...history.map(h => h.offered)) * 1.05}
              label="req/s, last 30s — solid: offered load, dashed: goodput"
            />}
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {POLICIES.map(p => (
          <button key={p.id} className={policy === p.id ? 'btn-sim-accent' : 'btn-sim'} onClick={() => setPolicy(p.id)}>{p.label}</button>
        ))}
      </div>
      <div className="slider-row">
        <label className="slider-label">clients</label>
        <input type="range" min="50" max="400" step="50" value={clients} onChange={e => { setClients(+e.target.value); reset(+e.target.value) }} className="flex-1" />
        <span className="slider-value">{clients}</span>
      </div>
      <div className="slider-row">
        <label className="slider-label">server capacity</label>
        <input type="range" min="80" max="300" step="10" value={capacity} onChange={e => setCapacity(+e.target.value)} className="flex-1" />
        <span className="slider-value">{capacity}/s</span>
      </div>
      <div className="slider-row">
        <label className="slider-label">max attempts</label>
        <input type="range" min="1" max="8" value={maxAttempts} onChange={e => setMaxAttempts(+e.target.value)} className="flex-1" />
        <span className="slider-value">{maxAttempts}</span>
      </div>
      <p className="font-mono text-[11px] viz-dim mb-4">
        demand: {clients} clients × {PER_CLIENT_RATE} req/s = {clients * PER_CLIENT_RATE} req/s against {capacity} req/s of capacity
        ({(capacity / (clients * PER_CLIENT_RATE)).toFixed(2)}× headroom). Client timeout 1s.
      </p>

      <div className="flex flex-wrap gap-2">
        <button className={running ? 'btn-sim-danger' : 'btn-sim-success'} onClick={() => setRunning(r => !r)}>
          {running ? '⏸ pause' : '▶ start'}
        </button>
        <button className="btn-sim-danger" onClick={kill} disabled={down}>kill server for 5s</button>
        <button className="btn-sim ml-auto" onClick={() => reset()}>reset</button>
      </div>
    </div>
  )
}
