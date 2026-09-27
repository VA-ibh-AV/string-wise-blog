/**
 * mulberry32: a tiny seeded PRNG. Every simulator in this post draws from one
 * of these, so a given seed replays the exact same run, on every reader's
 * machine and in the prerendered markup.
 */
export function mulberry32(seed) {
  let a = seed >>> 0
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
