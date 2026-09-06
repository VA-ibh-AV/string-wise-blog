import { useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

/**
 * Section 2 — the send/receive state machine: fast path vs. slow path.
 *
 * Fast path: the buffer has room (send) or data (receive) — no parking, no
 * scheduler involved. Slow path: wrap the calling goroutine's state in a
 * sudog, push it onto sendq or recvq, and call gopark(). A sudog is small —
 * the goroutine, the element being sent/received, and queue links — and it's
 * how a blocked goroutine gets found and woken by the *other* side later.
 *
 * Simplified vs. the real runtime: chansend checks recvq before the buffer,
 * and chanrecv checks the buffer before sendq, so a direct handoff always
 * wins over a buffer trip when one is possible. The corner case of a full
 * buffer with a sender already parked (receiver takes the buffered value and
 * rotates the parked sender's value in behind it) is real but a layer past
 * what this widget needs to show.
 */

const CAP = { unbuffered: 0, buffered: 2 }

export default function ParkWakeQueue() {
  const [mode, setMode]     = useState('unbuffered')
  const [qcount, setQcount] = useState(0)
  const [sendq, setSendq]   = useState([])
  const [recvq, setRecvq]   = useState([])
  const [log, setLog]       = useState([])
  const gid = useRef(1)
  const reduce = useReducedMotion()

  const dataqsiz = CAP[mode]
  const pushLog = line => setLog(prev => [...prev.slice(-5), line])

  const reset = m => {
    setMode(m); setQcount(0); setSendq([]); setRecvq([])
    setLog([`make(chan T${m === 'buffered' ? ', 2' : ''}) — ${m}`])
    gid.current = 1
  }

  const trySend = () => {
    const id = gid.current++
    if (recvq.length > 0) {
      const [waiter, ...rest] = recvq
      setRecvq(rest)
      pushLog(`G${id} chansend(): recvq non-empty — hands value straight to G${waiter.id}, wakes it (goready)`)
      return
    }
    if (qcount < dataqsiz) {
      setQcount(q => q + 1)
      pushLog(`G${id} chansend(): fast path — room in buffer (${qcount + 1}/${dataqsiz}), copies in, returns immediately`)
      return
    }
    setSendq(q => [...q, { id }])
    pushLog(`G${id} chansend(): no receiver waiting, no room — wraps in a sudog, parks on sendq, calls gopark()`)
  }

  const tryReceive = () => {
    const id = gid.current++
    if (qcount > 0) {
      setQcount(q => q - 1)
      pushLog(`G${id} chanrecv(): fast path — buffer has data (${qcount - 1} left), reads, returns immediately`)
      return
    }
    if (sendq.length > 0) {
      const [waiter, ...rest] = sendq
      setSendq(rest)
      pushLog(`G${id} chanrecv(): sendq non-empty — takes G${waiter.id}'s value directly off its stack, wakes it (goready)`)
      return
    }
    setRecvq(q => [...q, { id }])
    pushLog(`G${id} chanrecv(): nothing buffered, nobody sending — wraps in a sudog, parks on recvq, calls gopark()`)
  }

  return (
    <div className="viz-card">
      <p className="viz-title">↳ sudog: how a blocked goroutine waits and gets woken</p>

      <div className="flex flex-wrap gap-2 mb-5">
        <button className={mode === 'unbuffered' ? 'btn-sim-accent' : 'btn-sim'} onClick={() => reset('unbuffered')}>unbuffered — every send/receive is a rendezvous</button>
        <button className={mode === 'buffered' ? 'btn-sim-accent' : 'btn-sim'} onClick={() => reset('buffered')}>buffered, cap 2 — fast path until full</button>
      </div>

      {mode === 'buffered' && (
        <p className="font-mono text-[10px] viz-dim mb-4">buf: {qcount}/{dataqsiz} occupied</p>
      )}

      <div className="grid grid-cols-2 gap-4 mb-5">
        <div className="viz-panel">
          <p className="font-mono text-[10px] viz-dim mb-3 uppercase tracking-widest">sendq — parked senders</p>
          <div className="flex flex-wrap gap-2 min-h-[46px]">
            <AnimatePresence initial={false}>
              {sendq.map(g => (
                <motion.div
                  key={g.id}
                  initial={reduce ? false : { opacity: 0, y: -8, scale: 0.85 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduce ? undefined : { opacity: 0, scale: 0.6 }}
                  className="viz-chip w-16 h-9 font-mono text-[11px]"
                >
                  G{g.id}
                </motion.div>
              ))}
            </AnimatePresence>
            {sendq.length === 0 && <span className="font-mono text-[10px] viz-dim">empty</span>}
          </div>
        </div>
        <div className="viz-panel">
          <p className="font-mono text-[10px] viz-dim mb-3 uppercase tracking-widest">recvq — parked receivers</p>
          <div className="flex flex-wrap gap-2 min-h-[46px]">
            <AnimatePresence initial={false}>
              {recvq.map(g => (
                <motion.div
                  key={g.id}
                  initial={reduce ? false : { opacity: 0, y: 8, scale: 0.85 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduce ? undefined : { opacity: 0, scale: 0.6 }}
                  className="viz-chip w-16 h-9 font-mono text-[11px]"
                >
                  G{g.id}
                </motion.div>
              ))}
            </AnimatePresence>
            {recvq.length === 0 && <span className="font-mono text-[10px] viz-dim">empty</span>}
          </div>
        </div>
      </div>

      <div className="sim-log mb-5">
        {log.length === 0
          ? <p className="viz-dim">press send / receive and watch which path each goroutine takes</p>
          : log.map((l, i) => <div key={i}>{l}</div>)}
      </div>

      <div className="flex flex-wrap gap-2">
        <button className="btn-sim-accent" onClick={trySend}>spawn G, ch &lt;- v</button>
        <button className="btn-sim-success" onClick={tryReceive}>spawn G, &lt;-ch</button>
        <button className="btn-sim ml-auto" onClick={() => reset(mode)}>reset</button>
      </div>
    </div>
  )
}
