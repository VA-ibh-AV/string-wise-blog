import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

/**
 * Section 3 — the same send/receive pair, run on an unbuffered channel and a
 * buffered one side by side. Unbuffered is a rendezvous: whichever side shows
 * up first blocks until the other arrives, and the value never touches
 * memory that isn't one of the two goroutines' own stacks. Buffered is a
 * copy into hchan.buf: the sender only blocks once the buffer is full.
 */

const CAP = 3

export default function HandoffVsBuffered() {
  const [seq, setSeq]           = useState(1)
  const [uSender, setUSender]   = useState(null)   // { v } waiting to hand off
  const [uReceiver, setUReceiver] = useState(false) // a receiver is waiting
  const [uDone, setUDone]       = useState(0)
  const [bBuf, setBBuf]         = useState([])
  const [bBlocked, setBBlocked] = useState(false)
  const reduce = useReducedMotion()

  const send = () => {
    const v = seq
    setSeq(s => s + 1)

    // Unbuffered side.
    if (uReceiver) {
      setUReceiver(false)
      setUDone(n => n + 1)
    } else {
      setUSender({ v })
    }

    // Buffered side.
    if (bBuf.length < CAP) {
      setBBuf(b => [...b, v])
    } else {
      setBBlocked(true)
    }
  }

  const receive = () => {
    // Unbuffered side.
    if (uSender) {
      setUSender(null)
      setUDone(n => n + 1)
    } else {
      setUReceiver(true)
    }

    // Buffered side.
    setBBuf(b => {
      if (b.length === 0) return b
      const [, ...rest] = b
      return rest
    })
    setBBlocked(false)
  }

  const reset = () => {
    setSeq(1); setUSender(null); setUReceiver(false); setUDone(0)
    setBBuf([]); setBBlocked(false)
  }

  return (
    <div className="viz-card">
      <p className="viz-title">↳ rendezvous vs. copy-into-buffer — same send, both channels</p>

      <div className="grid grid-cols-2 gap-4 mb-5">
        <div className="viz-panel">
          <p className="font-mono text-[10px] viz-dim mb-3 uppercase tracking-widest">unbuffered — make(chan T)</p>
          <div className="flex items-center justify-center h-20">
            <AnimatePresence mode="wait">
              {uSender && (
                <motion.div key={`s-${uSender.v}`} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduce ? undefined : { opacity: 0 }} className="viz-chip-dashed w-full h-14 font-mono text-[11px] animate-pulse">
                  sender blocked, holding v{uSender.v} — parked on sendq
                </motion.div>
              )}
              {!uSender && uReceiver && (
                <motion.div initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduce ? undefined : { opacity: 0 }} className="viz-chip-dashed w-full h-14 font-mono text-[11px] animate-pulse">
                  receiver blocked, nobody sending — parked on recvq
                </motion.div>
              )}
              {!uSender && !uReceiver && (
                <motion.div initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduce ? undefined : { opacity: 0 }} className="font-mono text-[11px] viz-dim">
                  idle — no goroutine waiting
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <p className="font-mono text-[10px] viz-dim">handoffs completed: <strong className="viz-strong">{uDone}</strong></p>
        </div>

        <div className="viz-panel">
          <p className="font-mono text-[10px] viz-dim mb-3 uppercase tracking-widest">buffered — make(chan T, {CAP})</p>
          <div className="flex gap-2 justify-center h-14 items-center mb-3">
            {Array.from({ length: CAP }, (_, i) => (
              <div key={i} className={`w-14 h-11 flex items-center justify-center font-mono text-xs ${bBuf[i] !== undefined ? 'viz-chip-ok' : 'viz-chip-dashed'}`}>
                {bBuf[i] !== undefined ? `v${bBuf[i]}` : ''}
              </div>
            ))}
          </div>
          <p className="font-mono text-[11px] text-center mb-1" style={{ color: bBlocked ? '#ef6b73' : 'var(--ink-dim)' }}>
            {bBlocked ? `buffer full (${CAP}/${CAP}) — sender blocks too now` : `${bBuf.length}/${CAP} occupied — sender doesn't need a receiver present`}
          </p>
        </div>
      </div>

      <p className="font-mono text-[10px] viz-dim mb-5">
        Send and receive drive both channels at once. Watch how far they diverge before the buffered one fills — at capacity {CAP}, a buffered channel starts blocking exactly like the unbuffered one always does.
      </p>

      <div className="flex flex-wrap gap-2">
        <button className="btn-sim-accent" onClick={send}>ch &lt;- v{seq}</button>
        <button className="btn-sim-success" onClick={receive}>&lt;-ch</button>
        <button className="btn-sim ml-auto" onClick={reset}>reset</button>
      </div>
    </div>
  )
}
