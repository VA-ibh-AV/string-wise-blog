import { useRef, useState } from 'react'

/**
 * Section 1 — hchan's ring buffer, field by field.
 *
 * buf is a fixed-size ring. sendx is where the next send writes, recvx is
 * where the next receive reads. qcount is how many slots are occupied right
 * now — the only field that tells a size-check apart from a cursor position.
 * dataqsiz never changes after make(); it's the capacity, not the count.
 */

const CAPACITIES = [2, 4, 8]

export default function HchanRingBuffer() {
  const [dataqsiz, setDataqsiz] = useState(4)
  const [buf, setBuf]           = useState(() => Array(4).fill(null))
  const [sendx, setSendx]       = useState(0)
  const [recvx, setRecvx]       = useState(0)
  const [qcount, setQcount]     = useState(0)
  const [closed, setClosed]     = useState(false)
  const [parked, setParked]     = useState({ send: 0, recv: 0 })
  const [log, setLog]           = useState([])
  const seq = useRef(1)

  const pushLog = line => setLog(prev => [...prev.slice(-5), line])

  const resize = n => {
    setDataqsiz(n)
    setBuf(Array(n).fill(null))
    setSendx(0); setRecvx(0); setQcount(0)
    setClosed(false)
    setParked({ send: 0, recv: 0 })
    setLog([`make(chan T, ${n}) — dataqsiz=${n}, qcount=0, sendx=0, recvx=0`])
  }

  const send = () => {
    if (closed) {
      pushLog('panic: send on closed channel — chansend() checks c.closed before touching buf')
      return
    }
    if (qcount === dataqsiz) {
      setParked(p => ({ ...p, send: p.send + 1 }))
      pushLog(`chansend(): qcount==dataqsiz (${dataqsiz}) — no room, goroutine parks on sendq`)
      return
    }
    const v = seq.current++
    setBuf(prev => { const n = [...prev]; n[sendx] = v; return n })
    pushLog(`chansend(): buf[${sendx}]=v${v}, sendx→${(sendx + 1) % dataqsiz}, qcount→${qcount + 1}`)
    setSendx((sendx + 1) % dataqsiz)
    setQcount(qcount + 1)
  }

  const receive = () => {
    if (qcount === 0) {
      if (closed) {
        pushLog('chanrecv(): qcount==0 and closed — returns zero value immediately, ok=false')
        return
      }
      setParked(p => ({ ...p, recv: p.recv + 1 }))
      pushLog('chanrecv(): qcount==0 — nothing to read, goroutine parks on recvq')
      return
    }
    const v = buf[recvx]
    setBuf(prev => { const n = [...prev]; n[recvx] = null; return n })
    pushLog(`chanrecv(): v${v}=buf[${recvx}], recvx→${(recvx + 1) % dataqsiz}, qcount→${qcount - 1}`)
    setRecvx((recvx + 1) % dataqsiz)
    setQcount(qcount - 1)
  }

  const close_ = () => {
    if (closed) {
      pushLog('panic: close of closed channel')
      return
    }
    setClosed(true)
    pushLog('closechan(): closed=1, wakes every parked sudog on sendq and recvq')
  }

  return (
    <div className="viz-card">
      <p className="viz-title">↳ hchan.buf as a live ring buffer</p>

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <span className="font-mono text-[10px] viz-dim mr-1">make(chan T, N):</span>
        {CAPACITIES.map(n => (
          <button key={n} className={dataqsiz === n ? 'btn-sim-accent' : 'btn-sim'} onClick={() => resize(n)}>
            {n}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-5 gap-2 mb-5">
        <div className="stat-card"><div className="stat-value text-lg">{qcount}</div><div className="stat-label">qcount</div></div>
        <div className="stat-card"><div className="stat-value text-lg">{dataqsiz}</div><div className="stat-label">dataqsiz</div></div>
        <div className="stat-card"><div className="stat-value text-lg">{sendx}</div><div className="stat-label">sendx</div></div>
        <div className="stat-card"><div className="stat-value text-lg">{recvx}</div><div className="stat-label">recvx</div></div>
        <div className="stat-card">
          <div className={`stat-value text-lg ${closed ? 'text-rose-600' : ''}`}>{closed ? 'true' : 'false'}</div>
          <div className="stat-label">closed</div>
        </div>
      </div>

      <div className="viz-panel mb-5">
        <div className="flex justify-center gap-3 mb-1">
          {buf.map((_, i) => (
            <div key={`c-${i}`} className="w-16 text-center font-mono text-[9px]" style={{ visibility: i === sendx ? 'visible' : 'hidden', color: 'var(--accent)' }}>
              ▼ sendx
            </div>
          ))}
        </div>
        <div className="flex justify-center gap-3">
          {buf.map((v, i) => (
            <div key={i} className={`w-16 h-14 flex items-center justify-center font-mono text-xs ${v !== null ? 'viz-chip-ok' : 'viz-chip-dashed'}`}>
              {v !== null ? `v${v}` : 'empty'}
            </div>
          ))}
        </div>
        <div className="flex justify-center gap-3 mt-1">
          {buf.map((_, i) => (
            <div key={`f-${i}`} className="w-16 text-center font-mono text-[9px]" style={{ visibility: i === recvx ? 'visible' : 'hidden', color: 'var(--green)' }}>
              ▲ recvx
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-4 mb-5">
        <span className="font-mono text-[10px] viz-dim">sendq parked: <strong className={parked.send ? 'text-rose-600' : ''}>{parked.send}</strong></span>
        <span className="font-mono text-[10px] viz-dim">recvq parked: <strong className={parked.recv ? 'text-rose-600' : ''}>{parked.recv}</strong></span>
      </div>

      <div className="sim-log mb-5">
        {log.length === 0
          ? <p className="viz-dim">press send / receive to watch qcount, sendx and recvx move</p>
          : log.map((l, i) => <div key={i}>{l}</div>)}
      </div>

      <div className="flex flex-wrap gap-2">
        <button className="btn-sim-accent" onClick={send}>ch &lt;- v</button>
        <button className="btn-sim-success" onClick={receive}>&lt;-ch</button>
        <button className="btn-sim-danger" onClick={close_}>close(ch)</button>
        <button className="btn-sim ml-auto" onClick={() => resize(dataqsiz)}>reset</button>
      </div>
    </div>
  )
}
