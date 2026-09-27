import { mulberry32 } from '../../lib/rng'

/**
 * Section 3: 50 clients all fail at t=0 against a server that can accept
 * CAP_PER_BUCKET calls per 100ms bucket. Calls past that in the same bucket
 * are rejected at once. Every client retries until it succeeds, using one of
 * the four strategies from the AWS Architecture Blog's backoff analysis.
 */

export const CLIENTS = 50
export const BUCKET_MS = 100
export const CAP_PER_BUCKET = 5
export const BASE_MS = 100
export const CAP_MS = 2000

export const STRATEGIES = [
  { id: 'none',  label: 'no jitter',    formula: 'sleep = min(cap, base * 2^attempt)' },
  { id: 'full',  label: 'full',         formula: 'sleep = random(0, min(cap, base * 2^attempt))' },
  { id: 'equal', label: 'equal',        formula: 'temp = min(cap, base * 2^attempt); sleep = temp/2 + random(0, temp/2)' },
  { id: 'decor', label: 'decorrelated', formula: 'sleep = min(cap, random(base, prev_sleep * 3))' },
]

function sleepMs(strategy, attempt, prev, rand) {
  const exp = Math.min(CAP_MS, BASE_MS * 2 ** attempt)
  switch (strategy) {
    case 'none':  return exp
    case 'full':  return rand() * exp
    case 'equal': return exp / 2 + rand() * (exp / 2)
    case 'decor': return Math.min(CAP_MS, BASE_MS + rand() * (prev * 3 - BASE_MS))
  }
}

/** Returns { rows: [[{t, ok}]], buckets: number[], calls, peak, doneAt }. `peak` counts retries only. */
export function simulateJitter(strategy, seed = 3) {
  const rand = mulberry32(seed)
  const next = new Array(CLIENTS).fill(0)
  const attempt = new Array(CLIENTS).fill(0)
  const prev = new Array(CLIENTS).fill(BASE_MS)
  const done = new Array(CLIENTS).fill(false)
  const rows = Array.from({ length: CLIENTS }, () => [])
  const used = new Map() // bucket -> accepted count
  const arrivals = new Map() // bucket -> arrivals
  const retryArrivals = new Map() // bucket -> arrivals that are retries (the t=0 failure itself excluded)
  let calls = 0, doneAt = 0, left = CLIENTS

  while (left > 0) {
    let c = -1
    for (let i = 0; i < CLIENTS; i++) if (!done[i] && (c < 0 || next[i] < next[c])) c = i
    const t = next[c]
    const b = Math.floor(t / BUCKET_MS)
    calls++
    arrivals.set(b, (arrivals.get(b) || 0) + 1)
    if (attempt[c] > 0) retryArrivals.set(b, (retryArrivals.get(b) || 0) + 1)
    const ok = (used.get(b) || 0) < CAP_PER_BUCKET
    rows[c].push({ t, ok })
    if (ok) {
      used.set(b, (used.get(b) || 0) + 1)
      done[c] = true
      left--
      doneAt = Math.max(doneAt, t)
    } else {
      const s = sleepMs(strategy, attempt[c], prev[c], rand)
      attempt[c]++
      prev[c] = s
      next[c] = t + s
    }
  }

  const n = Math.floor(doneAt / BUCKET_MS) + 1
  const buckets = Array.from({ length: n }, (_, i) => arrivals.get(i) || 0)
  return { rows, buckets, calls, peak: Math.max(0, ...retryArrivals.values()), doneAt }
}
