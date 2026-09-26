import { mulberry32 } from './rng'

/**
 * The shared retry model behind the storm simulator, the metastable loop and
 * the before/after dashboard. It is a model, not a benchmark: every number is
 * illustrative, and the shape is the point.
 *
 * Time moves in 100ms ticks.
 *
 * Clients: user requests arrive open-loop (users keep clicking whether the
 * server is healthy or not). A request's first attempt goes out at once. A
 * failed request joins its client's retry queue, and the client flushes that
 * queue when its backoff timer fires. This is the shape of an SDK that retries
 * behind one shared connection: one timer per client, not per request. It is
 * also what lets a single failure instant synchronize a whole fleet.
 *
 * Server: serves `capacity` req/s from a FIFO queue. It cannot see that a
 * client has already timed out, so without shedding it still spends capacity
 * on those abandoned attempts. With shedding it rejects fast when the queue is
 * deeper than it can serve inside the timeout, and it skips work whose caller
 * is already gone.
 *
 * Budget: a fleet-wide version of gRPC retry throttling. Every failed attempt
 * costs one token, every success earns back TOKEN_RATIO, and a retry is only
 * allowed while the bucket is more than half full.
 */

export const TICK_MS = 100
export const TIMEOUT_TICKS = 10          // 1s client timeout
const QUEUE_CAP = 2500                   // listen backlog + app queue, before packets drop
const MAX_TOKENS = 50
const TOKEN_RATIO = 0.1
const BACKOFF_BASE = 2                   // 200ms
const BACKOFF_CAP = 80                   // 8s

export const POLICIES = [
  { id: 'none',   label: 'no retries' },
  { id: 'fixed',  label: 'fixed 1s' },
  { id: 'exp',    label: 'exponential' },
  { id: 'jitter', label: 'exponential + jitter' },
]

function delayTicks(policy, streak, rand) {
  if (policy === 'fixed') return 10
  const exp = Math.min(BACKOFF_CAP, BACKOFF_BASE * 2 ** (streak - 1))
  if (policy === 'exp') return exp
  return 1 + Math.floor(rand() * exp) // full jitter
}

export function createSim({ clients = 200, seed = 7 } = {}) {
  return {
    t: 0,
    rand: mulberry32(seed),
    clients,
    nextTry:  new Int32Array(clients).fill(-1),
    streak:   new Int16Array(clients),
    inflight: new Int16Array(clients),
    lastFail: new Int32Array(clients).fill(-99),
    lastOk:   new Int32Array(clients).fill(-99),
    pending:  Array.from({ length: clients }, () => []),
    queue: [],
    qHead: 0,
    outstanding: [],
    tokens: MAX_TOKENS,
    carry: 0,
  }
}

/**
 * Advance one tick. `p` = { rate, capacity, policy, maxAttempts, budget, shed, down }.
 * Returns per-second rates for this tick, plus the queue depth.
 */
export function step(s, p) {
  const { rand } = s
  const t = s.t
  const m = { sent: 0, retries: 0, ok: 0, wasted: 0, rejected: 0, failed: 0, timeouts: 0 }
  const capPerTick = p.capacity * TICK_MS / 1000
  const liveLimit = Math.floor(capPerTick * TIMEOUT_TICKS)

  const fail = (job) => {
    const c = job.client
    if (p.budget) s.tokens = Math.max(0, s.tokens - 1)
    const allowed = p.policy !== 'none'
      && job.attempts < p.maxAttempts
      && (!p.budget || s.tokens > MAX_TOKENS / 2)
    if (!allowed) {
      m.failed++
      s.lastFail[c] = t
      return
    }
    s.pending[c].push(job)
    if (s.nextTry[c] < 0) {
      s.streak[c]++
      s.nextTry[c] = t + delayTicks(p.policy, s.streak[c], rand)
    }
  }

  const send = (job) => {
    job.attempts++
    m.sent++
    if (job.attempts > 1) m.retries++
    if (p.down) { fail(job); return }                      // connection refused: fails at once
    const depth = s.queue.length - s.qHead
    if (p.shed && depth >= liveLimit) { m.rejected++; fail(job); return } // fast 503
    const a = { job, sentAt: t, served: false, dead: false }
    s.inflight[job.client]++
    s.outstanding.push(a)
    if (depth < QUEUE_CAP) s.queue.push(a)                 // else: dropped, the client just waits
  }

  // 1. new user requests, spread over clients
  const pArrive = (p.rate * TICK_MS / 1000) / s.clients
  for (let c = 0; c < s.clients; c++) {
    if (rand() < pArrive) send({ client: c, attempts: 0 })
  }

  // 2. clients whose backoff timer fires flush their retry queue together
  for (let c = 0; c < s.clients; c++) {
    if (s.nextTry[c] !== t) continue
    s.nextTry[c] = -1
    const jobs = s.pending[c]
    s.pending[c] = []
    for (const job of jobs) send(job)
  }

  // 3. server works through the queue
  if (p.down) {
    s.queue = []; s.qHead = 0; s.carry = 0                 // the process died and took its queue
  } else {
    let work = capPerTick + s.carry
    while (work >= 1 && s.qHead < s.queue.length) {
      const a = s.queue[s.qHead++]
      if (a.dead) {
        if (p.shed) continue                               // deadline already passed: skip for free
        work--; m.wasted++
        continue
      }
      work--
      a.served = true
      s.inflight[a.job.client]--
      m.ok++
      s.lastOk[a.job.client] = t
      s.streak[a.job.client] = 0
      if (p.budget) s.tokens = Math.min(MAX_TOKENS, s.tokens + TOKEN_RATIO)
    }
    s.carry = Math.min(work, 1)
    if (s.qHead > 4096) { s.queue = s.queue.slice(s.qHead); s.qHead = 0 }
  }

  // 4. client-side timeouts
  const still = []
  for (const a of s.outstanding) {
    if (a.served) continue
    if (t - a.sentAt >= TIMEOUT_TICKS) {
      a.dead = true
      m.timeouts++
      s.inflight[a.job.client]--
      fail(a.job)
    } else still.push(a)
  }
  s.outstanding = still

  s.t = t + 1
  const k = 1000 / TICK_MS
  return {
    t,
    offered: m.sent * k,
    retries: m.retries * k,
    goodput: m.ok * k,
    wasted:  m.wasted * k,
    rejected: m.rejected * k,
    failed:  m.failed * k,
    timeouts: m.timeouts * k,
    queue:   s.queue.length - s.qHead,
  }
}

/** Per-client state for drawing dots: 0 idle, 1 in flight, 2 waiting to retry, 3 gave up, 4 just succeeded. */
export function clientState(s, c) {
  if (s.t - s.lastFail[c] <= 5) return 3
  if (s.pending[c].length) return 2
  if (s.inflight[c] > 0) return 1
  if (s.t - s.lastOk[c] <= 2) return 4
  return 0
}

/** Run a whole incident offline: `outage` ticks of downtime starting at `at`. */
export function runIncident({ ticks, at, outage, seed = 7, clients = 200, ...p }) {
  const s = createSim({ clients, seed })
  const out = []
  for (let i = 0; i < ticks; i++) out.push(step(s, { ...p, down: i >= at && i < at + outage }))
  return out
}
