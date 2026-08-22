import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

/**
 * Section 6 — the Linux network stack, one layer at a time.
 *
 * The same sk_buff walks down on send and up on receive. Nothing copies it
 * between layers: each hop pushes or pulls the data pointer and writes its own
 * header into the headroom, which is the whole reason the struct exists.
 *
 * The NAPI toggle is the other point worth seeing. One hardware interrupt per
 * packet is fine at 10k packets/sec and catastrophic at 1M; NAPI takes the first
 * interrupt, masks the rest, and polls the ring in batches.
 */

const SEND = [
  { fn: 'write() / send()',    layer: 'application',    file: 'userspace',
    does: 'hands a byte range to the kernel. Returns as soon as the bytes are copied into the socket buffer — not when they are delivered, and not when they are ACKed.' },
  { fn: 'tcp_sendmsg()',       layer: 'socket / TCP',   file: 'net/ipv4/tcp.c',
    does: 'copies user bytes into sk_buffs, coalescing into MSS-sized segments. Blocks here when the send buffer is full (SO_SNDBUF / tcp_wmem) — this is where a slow peer becomes your latency.' },
  { fn: 'tcp_transmit_skb()',  layer: 'TCP',            file: 'net/ipv4/tcp_output.c',
    does: 'builds the TCP header in the skb headroom: seq, ack_seq, flags, window, checksum. Consults snd_cwnd and snd_wnd before anything leaves.' },
  { fn: 'ip_queue_xmit()',     layer: 'IP',             file: 'net/ipv4/ip_output.c',
    does: 'prepends the IP header and does the route lookup — source address, TTL, next hop.' },
  { fn: 'dev_queue_xmit()',    layer: 'qdisc',          file: 'net/core/dev.c',
    does: 'enqueues on the device queueing discipline (fq_codel by default). Bufferbloat lives here, not in TCP.' },
  { fn: 'ndo_start_xmit()',    layer: 'driver',         file: 'NIC driver',
    does: 'writes a DMA descriptor into the TX ring and kicks the doorbell register. The sk_buff is freed on TX completion.' },
  { fn: 'wire',                layer: 'wire',           file: '—',
    does: 'the bytes are gone. Everything TCP does from here is inference from what comes back.' },
]

const RECV = [
  { fn: 'wire',                    layer: 'wire',        file: '—',
    does: 'a frame lands in the NIC RX ring by DMA. The kernel does not know yet.' },
  { fn: 'hard IRQ → napi_schedule()', layer: 'driver',   file: 'NIC driver',
    does: 'the NIC raises an interrupt. The handler does almost nothing: it masks further interrupts and schedules NAPI polling in softirq context.' },
  { fn: 'napi_poll() → napi_gro_receive()', layer: 'NAPI', file: 'net/core/dev.c',
    does: 'polls the ring for up to netdev_budget packets, merging adjacent segments with GRO so the stack above walks one large skb instead of forty small ones.' },
  { fn: 'netif_receive_skb()',     layer: 'core',        file: 'net/core/dev.c',
    does: 'hands the sk_buff to the protocol handler registered for its ethertype.' },
  { fn: 'ip_rcv()',                layer: 'IP',          file: 'net/ipv4/ip_input.c',
    does: 'validates the IP header and checksum, then pulls the data pointer past it.' },
  { fn: 'tcp_v4_rcv()',            layer: 'TCP',         file: 'net/ipv4/tcp_ipv4.c',
    does: 'demultiplexes on the 4-tuple — src ip, src port, dst ip, dst port — to find the struct sock. A miss here is what sends an RST.' },
  { fn: 'tcp_rcv_established()',   layer: 'TCP',         file: 'net/ipv4/tcp_input.c',
    does: 'the fast path for an established socket: advance rcv_nxt, recompute the window, park anything out of order in tcp_ofo_queue, and schedule an ACK.' },
  { fn: 'sk_receive_queue',        layer: 'socket',      file: 'struct sock',
    does: 'the skb waits here. It has already been acknowledged to the peer — the sender considers it delivered even if your application never calls read().' },
  { fn: 'read() / recv()',         layer: 'application', file: 'userspace',
    does: 'copies out to your buffer and frees the sk_buff, which finally reopens the receive window.' },
]

/** eBPF attachment points, keyed by the step index they fire on. */
const HOOKS = {
  send: {
    1: 'kprobe:tcp_sendmsg',
    2: 'tracepoint:tcp:tcp_retransmit_skb  (on the retransmit path through here)',
  },
  recv: {
    5: 'tracepoint:tcp:tcp_receive_reset  ·  kprobe:tcp_set_state',
    6: 'kprobe:tcp_rcv_established',
  },
}

const TICK_MS = 900

export default function KernelPath() {
  const [dir, setDir]         = useState('send')
  const [step, setStep]       = useState(0)
  const [running, setRunning] = useState(false)
  const [napi, setNapi]       = useState(true)
  const [burst, setBurst]     = useState({ packets: 0, irqs: 0 })
  const reduce = useReducedMotion()

  const path  = dir === 'send' ? SEND : RECV
  const total = path.length - 1
  const cur   = path[step]
  const hook  = HOOKS[dir][step]

  const latest = useRef({})
  latest.current = { step, total }

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => {
      if (latest.current.step >= latest.current.total) { setRunning(false); return }
      setStep(n => n + 1)
    }, TICK_MS)
    return () => clearInterval(t)
  }, [running])

  const flip = next => { setDir(next); setStep(0); setRunning(false) }

  // 64 packets arriving back to back: one interrupt each, or one interrupt and
  // then a polled batch. This is the entire argument for NAPI.
  const receiveBurst = () => {
    const packets = 64
    setBurst({ packets, irqs: napi ? Math.ceil(packets / 64) : packets })
  }

  return (
    <div className="viz-card">
      <p className="viz-title">↳ one sk_buff, seven layers</p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button className={dir === 'send' ? 'btn-sim-accent' : 'btn-sim'} onClick={() => flip('send')}>
          send path — write() to wire
        </button>
        <button className={dir === 'recv' ? 'btn-sim-accent' : 'btn-sim'} onClick={() => flip('recv')}>
          receive path — wire to read()
        </button>
      </div>

      <div className="viz-panel mb-4">
        {path.map((s, i) => {
          const active = i === step
          const passed = i < step
          return (
            <div
              key={s.fn}
              className="relative flex items-center gap-3 rounded-lg border px-3 py-2 mb-1.5 transition-all duration-200"
              style={{
                borderColor: active ? 'var(--accent)' : 'var(--border-soft)',
                background: active
                  ? 'color-mix(in srgb, var(--accent) 10%, var(--surface-solid))'
                  : 'var(--surface-solid)',
                opacity: passed ? 0.65 : 1,
              }}
            >
              <span className="font-mono text-[9px] viz-muted w-[74px] shrink-0 text-right">{s.layer}</span>
              <span
                className="font-mono text-[11px] shrink-0"
                style={{ color: active ? 'var(--accent-strong)' : 'var(--ink-dim)', minWidth: 210 }}
              >
                {s.fn}
              </span>
              <span className="font-mono text-[9px] viz-muted hidden sm:inline">{s.file}</span>

              {active && (
                <motion.span
                  layoutId={reduce ? undefined : 'skb'}
                  className="ml-auto font-mono text-[9px] px-2 py-1 rounded-md border shrink-0"
                  style={{
                    borderColor: 'var(--accent)',
                    background: 'color-mix(in srgb, var(--accent) 18%, var(--surface-solid))',
                    color: 'var(--accent-strong)',
                  }}
                  transition={{ duration: reduce ? 0 : 0.35, ease: 'easeInOut' }}
                >
                  sk_buff
                </motion.span>
              )}
            </div>
          )
        })}
      </div>

      <div className="viz-panel mb-4" style={{ minHeight: 74 }}>
        <p className="font-mono text-[10px] viz-muted mb-1">
          {dir === 'send' ? 'send' : 'receive'} step {step + 1} / {path.length} · <strong style={{ color: 'var(--accent)' }}>{cur.fn}</strong>
        </p>
        <p className="font-mono text-[11px] viz-dim" style={{ margin: 0 }}>{cur.does}</p>
        {hook && (
          <p className="font-mono text-[10px] mt-2" style={{ margin: '8px 0 0', color: 'var(--green)' }}>
            eBPF hook available here → <code>{hook}</code>
          </p>
        )}
      </div>

      <div className="viz-panel mb-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="font-mono text-[10px] viz-muted mr-1">interrupt handling</span>
          <button className={napi ? 'btn-sim-accent' : 'btn-sim'} onClick={() => { setNapi(true); setBurst({ packets: 0, irqs: 0 }) }}>
            NAPI polling
          </button>
          <button className={!napi ? 'btn-sim-danger' : 'btn-sim'} onClick={() => { setNapi(false); setBurst({ packets: 0, irqs: 0 }) }}>
            one IRQ per packet
          </button>
          <button className="btn-sim ml-auto" onClick={receiveBurst}>receive 64 packets</button>
        </div>

        <div className="grid gap-1 mb-3" style={{ gridTemplateColumns: 'repeat(16, minmax(0, 1fr))' }}>
          {Array.from({ length: 64 }, (_, i) => (
            <div
              key={i}
              className={`viz-cell ${i < burst.packets ? 'viz-cell-active' : 'viz-cell-idle'}`}
              style={{ height: 10 }}
              title={`packet ${i + 1}`}
            />
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="stat-card">
            <div className={`stat-value text-lg ${burst.irqs > 8 ? 'text-rose-600' : ''}`}>{burst.irqs}</div>
            <div className="stat-label">hardware interrupts</div>
          </div>
          <div className="stat-card">
            <div className="stat-value text-lg">{burst.packets}</div>
            <div className="stat-label">packets delivered</div>
          </div>
        </div>

        <p className="font-mono text-[10px] viz-muted mt-3">
          {napi
            ? 'NAPI: the first packet raises an interrupt, the driver masks the rest and the softirq polls the ring for up to netdev_budget (default 300) packets. Interrupt cost is amortised over the batch.'
            : 'Interrupt per packet: every arrival takes a context switch. At line rate on 10GbE this is a livelock — the CPU spends all of its time entering and leaving the interrupt handler and never runs your application.'}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button className="btn-sim-accent" onClick={() => setStep(n => Math.min(n + 1, total))} disabled={step >= total}>
          next layer
        </button>
        <button className={running ? 'btn-sim-danger' : 'btn-sim'} onClick={() => setRunning(r => !r)} disabled={step >= total}>
          {running ? 'pause' : 'play'}
        </button>
        <button className="btn-sim ml-auto" onClick={() => { setStep(0); setRunning(false) }}>reset</button>
      </div>
    </div>
  )
}
