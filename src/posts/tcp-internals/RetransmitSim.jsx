import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

/**
 * Section 2 — sequence numbers, cumulative ACKs, RTO and fast retransmit.
 *
 * A real event-driven simulation rather than a scripted animation: segments and
 * ACKs are objects with a virtual departure time, the receiver keeps rcv_nxt and
 * an out-of-order queue, and the sender runs RFC 6298 RTO estimation (SRTT,
 * RTTVAR, ×2 backoff) plus Karn's algorithm and 3-dup-ACK fast retransmit.
 *
 * The lesson the two "drop" buttons exist to teach: dropping a segment costs you
 * a recovery round; dropping an ACK usually costs you nothing at all, because
 * the next cumulative ACK covers everything the lost one would have.
 *
 * The whole simulation lives in a ref and is mirrored into state once per tick,
 * so the render never reads a half-updated model and the interval never needs
 * re-registering.
 */

const MSS       = 1460
const N_SEG     = 10
const ISN       = 1000
const ONE_WAY   = 40      // virtual ms, so RTT ≈ 80ms on an idle path
const WINDOW    = 4       // segments the sender keeps in flight
const RTO_MIN   = 200     // Linux TCP_RTO_MIN
const TICK_MS   = 40      // real ms between ticks
const VT_STEP   = 6       // virtual ms advanced per tick

const seqOf = i => ISN + i * MSS

function initialSim() {
  return {
    now:      0,
    sndUna:   0,          // index of the oldest unacknowledged segment
    sndNxt:   0,          // index of the next segment to send
    rcvNxt:   0,          // receiver's next expected segment index
    ofo:      new Set(),  // out-of-order segments the receiver is holding
    inFlight: [],         // { id, kind, seg, ack, sentAt, arriveAt, doomed, retx }
    dupAcks:  0,
    srtt:     null,
    rttvar:   null,
    rto:      1000,       // RFC 6298 initial RTO before the first sample
    rtoDeadline: null,
    retxCount: 0,
    sent:     [],         // per-segment: 'unsent' | 'inflight' | 'acked'
    everRetx: new Set(),  // segments that have been retransmitted (Karn's algorithm)
    log:      [],
    nextId:   1,
    dropSeg:  false,
    dropAck:  false,
    finished: false,
  }
}

export default function RetransmitSim() {
  const [running, setRunning] = useState(false)
  const [view, setView] = useState(() => snapshot(initialSim()))
  const sim = useRef(null)
  const reduce = useReducedMotion()
  if (sim.current === null) sim.current = initialSim()

  const push = (s, msg) => { s.log = [...s.log, `${String(s.now).padStart(4, ' ')}ms  ${msg}`].slice(-9) }

  /** One virtual-time step of the whole model. Mutates `s` in place. */
  const advance = s => {
    s.now += VT_STEP

    // 1. deliver anything that has arrived
    const arrived = s.inFlight.filter(p => p.arriveAt <= s.now)
    if (arrived.length) s.inFlight = s.inFlight.filter(p => p.arriveAt > s.now)

    for (const p of arrived) {
      if (p.doomed) {
        push(s, p.kind === 'data' ? `✗ segment ${p.seg} lost in transit` : `✗ ACK ${ISN + p.ack * MSS} lost in transit`)
        continue
      }

      if (p.kind === 'data') {
        if (p.seg === s.rcvNxt) {
          s.rcvNxt++
          while (s.ofo.has(s.rcvNxt)) { s.ofo.delete(s.rcvNxt); s.rcvNxt++ }
          push(s, `receiver: in order, rcv_nxt → ${seqOf(s.rcvNxt)}`)
        } else if (p.seg > s.rcvNxt) {
          s.ofo.add(p.seg)
          push(s, `receiver: out of order, queued seg ${p.seg}, still expecting ${seqOf(s.rcvNxt)}`)
        }
        // Every arrival triggers an ACK, and it always carries rcv_nxt —
        // cumulative, so it re-acknowledges everything below it too.
        send(s, { kind: 'ack', ack: s.rcvNxt, sample: p.sample })
      } else {
        onAck(s, p)
      }
    }

    // 2. RTO expiry
    if (s.rtoDeadline !== null && s.now >= s.rtoDeadline && s.sndUna < N_SEG) {
      const seg = s.sndUna
      push(s, `RTO fired after ${Math.round(s.rto)}ms — retransmit seg ${seg}, back off to ${Math.round(s.rto * 2)}ms`)
      s.rto = Math.min(s.rto * 2, 120000)
      s.everRetx.add(seg)
      s.retxCount++
      s.dupAcks = 0
      // A timeout means congestion control collapses too — see the next section.
      transmit(s, seg)
      s.rtoDeadline = s.now + s.rto
    }

    // 3. fill the window
    while (s.sndNxt < N_SEG && s.sndNxt - s.sndUna < WINDOW) {
      transmit(s, s.sndNxt)
      s.sndNxt++
    }

    if (s.sndUna >= N_SEG && s.inFlight.length === 0 && !s.finished) {
      s.finished = true
      push(s, `all ${N_SEG} segments acknowledged · ${s.retxCount} retransmission${s.retxCount === 1 ? '' : 's'}`)
    }
  }

  const send = (s, pkt) => {
    const doomed = pkt.kind === 'ack' && s.dropAck
    if (doomed) s.dropAck = false
    s.inFlight.push({
      id: s.nextId++, kind: pkt.kind, ack: pkt.ack, seg: pkt.seg,
      sentAt: s.now, arriveAt: s.now + ONE_WAY, doomed, sample: pkt.sample,
    })
  }

  const transmit = (s, seg) => {
    const doomed = s.dropSeg
    if (doomed) { s.dropSeg = false; push(s, `network will drop seg ${seg}`) }
    s.sent[seg] = 'inflight'
    s.inFlight.push({
      id: s.nextId++, kind: 'data', seg,
      sentAt: s.now, arriveAt: s.now + ONE_WAY, doomed,
      // Karn's algorithm: a retransmitted segment yields no RTT sample, because
      // you cannot tell which copy the ACK belongs to.
      sample: s.everRetx.has(seg) ? null : s.now,
    })
    if (s.rtoDeadline === null) s.rtoDeadline = s.now + s.rto
  }

  const onAck = (s, p) => {
    if (p.ack > s.sndUna) {
      for (let i = s.sndUna; i < p.ack; i++) s.sent[i] = 'acked'
      const advanced = p.ack - s.sndUna
      s.sndUna = p.ack
      s.dupAcks = 0

      if (p.sample != null) {
        const r = s.now - p.sample
        if (s.srtt === null) { s.srtt = r; s.rttvar = r / 2 }
        else {
          s.rttvar = 0.75 * s.rttvar + 0.25 * Math.abs(s.srtt - r)
          s.srtt   = 0.875 * s.srtt + 0.125 * r
        }
        s.rto = Math.max(RTO_MIN, s.srtt + 4 * s.rttvar)
      }

      push(s, `ACK ${seqOf(p.ack)} — covers ${advanced} segment${advanced === 1 ? '' : 's'}${p.sample == null ? ' (no RTT sample: Karn)' : ''}`)
      s.rtoDeadline = s.sndUna < N_SEG ? s.now + s.rto : null
    } else {
      s.dupAcks++
      push(s, `duplicate ACK ${seqOf(p.ack)} (#${s.dupAcks})`)
      if (s.dupAcks === 3 && s.sndUna < N_SEG) {
        push(s, `3 dup ACKs → fast retransmit seg ${s.sndUna}, no RTO wait`)
        s.everRetx.add(s.sndUna)
        s.retxCount++
        transmit(s, s.sndUna)
        s.rtoDeadline = s.now + s.rto
      }
    }
  }

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => {
      const s = sim.current
      advance(s)
      setView(snapshot(s))
      if (s.finished) setRunning(false)
    }, TICK_MS)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running])

  const arm = which => {
    const s = sim.current
    if (which === 'seg') s.dropSeg = true
    else s.dropAck = true
    setView(snapshot(s))
    setRunning(true)
  }

  const reset = () => { setRunning(false); sim.current = initialSim(); setView(snapshot(sim.current)) }

  const rtoLeft = view.rtoDeadline === null ? null : Math.max(0, view.rtoDeadline - view.now)
  const rtoPct  = rtoLeft === null ? 0 : 100 - Math.min(100, (rtoLeft / view.rto) * 100)

  return (
    <div className="viz-card">
      <p className="viz-title">↳ loss, cumulative ACKs and the retransmit timer</p>

      <div className="grid grid-cols-4 gap-3 mb-5">
        <div className="stat-card">
          <div className="stat-value text-accent-600 text-lg">{view.srtt === null ? '—' : `${Math.round(view.srtt)}ms`}</div>
          <div className="stat-label">SRTT</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-lg">{view.rttvar === null ? '—' : `${Math.round(view.rttvar)}ms`}</div>
          <div className="stat-label">RTTVAR</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-lg">{Math.round(view.rto)}ms</div>
          <div className="stat-label">RTO</div>
        </div>
        <div className="stat-card">
          <div className={`stat-value text-lg ${view.dupAcks >= 3 ? 'text-rose-600' : ''}`}>{view.dupAcks}</div>
          <div className="stat-label">duplicate ACKs</div>
        </div>
      </div>

      <p className="font-mono text-[10px] viz-muted mb-4">
        RTO = SRTT + 4·RTTVAR, floored at {RTO_MIN}ms (Linux <code>TCP_RTO_MIN</code>) and doubled on every timeout.
      </p>

      <div className="viz-panel mb-4">
        <p className="font-mono text-[10px] viz-muted mb-2">sender — send buffer, snd_una = {seqOf(view.sndUna)}</p>
        <div className="flex gap-1 flex-wrap mb-4">
          {Array.from({ length: N_SEG }, (_, i) => {
            const st = view.sent[i]
            const cls = st === 'acked' ? 'viz-chip-ok' : st === 'inflight' ? 'viz-chip-hl' : ''
            return (
              <div key={i} className={`w-[62px] h-9 viz-chip ${cls}`} title={`bytes ${seqOf(i)}–${seqOf(i) + MSS - 1}`}>
                <span className="font-mono text-[8px] opacity-70">seq {seqOf(i)}</span>
                <span className="font-mono text-[9px]">{st === 'acked' ? 'acked' : st === 'inflight' ? 'in flight' : 'queued'}</span>
              </div>
            )
          })}
        </div>

        <div className="relative h-[86px] rounded-lg" style={{ background: 'var(--surface-solid)', border: '1px solid var(--border-soft)' }}>
          <span className="absolute left-2 top-1 font-mono text-[9px] viz-muted">data →</span>
          <span className="absolute left-2 bottom-1 font-mono text-[9px] viz-muted">← ACKs</span>
          <AnimatePresence>
            {view.inFlight.map(p => {
              const pct = Math.max(0, Math.min(1, (view.now - p.sentAt) / ONE_WAY))
              const left = p.kind === 'data' ? pct : 1 - pct
              const tone = p.doomed && pct > 0.45 ? 'viz-chip-bad' : p.kind === 'data' ? 'viz-chip-hl' : 'viz-chip-ok'
              return (
                <motion.div
                  key={p.id}
                  initial={reduce ? false : { opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={reduce ? undefined : { opacity: 0, scale: 0.6 }}
                  transition={{ duration: 0.15 }}
                  className={`absolute h-7 px-2 rounded-md border font-mono text-[9px] flex items-center ${tone}`}
                  style={{
                    left: `calc(${left * 100}% - ${left * 92}px + 46px)`,
                    top: p.kind === 'data' ? 16 : 48,
                    marginLeft: -46,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {p.kind === 'data' ? `seg ${p.seg}` : `ack ${seqOf(p.ack)}`}
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>

        <p className="font-mono text-[10px] viz-muted mt-3 mb-2">
          receiver — rcv_nxt = {seqOf(view.rcvNxt)}
          {view.ofo.length > 0 && <span style={{ color: '#d08700' }}> · holding {view.ofo.length} out-of-order segment{view.ofo.length === 1 ? '' : 's'} in tcp_ofo_queue</span>}
        </p>
        <div className="flex gap-1 flex-wrap">
          {Array.from({ length: N_SEG }, (_, i) => {
            const delivered = i < view.rcvNxt
            const held = view.ofo.includes(i)
            return (
              <div
                key={i}
                className={`w-[62px] h-7 viz-chip ${delivered ? 'viz-chip-ok' : held ? 'viz-chip-warn' : ''}`}
                title={delivered ? 'delivered to the application' : held ? 'received, but cannot be delivered — there is a gap below it' : 'not received'}
              >
                <span className="font-mono text-[9px]">{delivered ? `seg ${i}` : held ? `held ${i}` : '—'}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="viz-panel mb-4">
        <div className="flex items-center justify-between mb-1">
          <span className="font-mono text-[10px] viz-muted">retransmit timer on seg {view.sndUna}</span>
          <span className="font-mono text-[10px] viz-dim">{rtoLeft === null ? 'idle' : `${Math.round(rtoLeft)}ms left`}</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-muted)' }}>
          <div
            className="h-full transition-all duration-100"
            style={{ width: `${rtoPct}%`, background: rtoPct > 80 ? '#ef6b73' : 'var(--accent)' }}
          />
        </div>
      </div>

      <div className="sim-log mb-4">
        {view.log.length === 0
          ? <div className="viz-muted">press play — the sender opens a 4-segment window and walks it</div>
          : view.log.map((line, i) => <div key={i}>{line}</div>)}
      </div>

      <div className="flex flex-wrap gap-2">
        <button className={running ? 'btn-sim-danger' : 'btn-sim-accent'} onClick={() => setRunning(r => !r)} disabled={view.finished}>
          {running ? 'pause' : view.now === 0 ? 'start transfer' : 'resume'}
        </button>
        <button className="btn-sim" onClick={() => arm('seg')} disabled={view.finished}>drop next segment</button>
        <button className="btn-sim" onClick={() => arm('ack')} disabled={view.finished}>drop next ACK</button>
        <button className="btn-sim ml-auto" onClick={reset}>reset</button>
      </div>
    </div>
  )
}

/** Plain-data copy of the model for rendering — Sets become arrays. */
function snapshot(s) {
  return {
    now: s.now, sndUna: s.sndUna, rcvNxt: s.rcvNxt,
    ofo: [...s.ofo], inFlight: s.inFlight.map(p => ({ ...p })),
    dupAcks: s.dupAcks, srtt: s.srtt, rttvar: s.rttvar, rto: s.rto,
    rtoDeadline: s.rtoDeadline, sent: [...s.sent], log: s.log,
    finished: s.finished, retxCount: s.retxCount,
  }
}
