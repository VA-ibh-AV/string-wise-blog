/**
 * Section 5: steady-state model of one busy path, a fleet of client nodes
 * talking to one backend node through NAT / kube-proxy conntrack. Limits are
 * illustrative Linux defaults or plausible sizes, not measurements:
 *
 *   client ports   ip_local_port_range 32768–60999 = 28,232 ports per client
 *                  node per destination; a closed socket holds its port for
 *                  60s of TIME_WAIT. CLIENT_NODES nodes share the load.
 *   conntrack      nf_conntrack_max = CT_MAX entries; an entry lingers for
 *                  up to 120s (the SYN_SENT and TIME_WAIT timeouts).
 *   SYN queue      half-open handshakes the listener can hold
 *   accept queue   somaxconn = 4096; drains only as fast as the app accepts
 *                  and finishes TLS handshakes (ACCEPT_RATE conns/s of CPU)
 *   app CPU        TLS handshakes + request work
 *
 * Every dropped SYN comes back: the kernel retransmits it (tcp_syn_retries),
 * so drops add load. That feedback is solved with damped fixed-point passes.
 */

export const CLIENT_NODES = 4
export const PORTS = 28232
export const TIME_WAIT_S = 60
export const CT_MAX = 262144
export const CT_TIMEOUT_S = 120
export const SYN_RATE = 6000     // SYN/s before the SYN queue (tcp_max_syn_backlog) saturates
export const ACCEPT_RATE = 800   // new TLS connections/s the app can accept and handshake
export const REQ_RATE = 12000    // requests/s the app can serve on warm connections
export const REQS_PER_CONN = 50  // with keep-alive, one connection carries ~50 requests
const PKTS_PER_CONN = 10         // SYN, SYN-ACK, ACK, TLS flights, FIN/ACK pairs
const PKTS_PER_REQ = 2
const NIC_PPS = 120000

const over = use => (use > 1 ? 1 - 1 / use : 0) // fraction dropped once a stage is past 100%

export function packetPath(reqRate, keepAlive) {
  const conns0 = keepAlive ? reqRate / REQS_PER_CONN : reqRate
  let d = 0 // chance a SYN is dropped somewhere on the path
  let r
  for (let pass = 0; pass < 40; pass++) {
    // client side: each new socket parks its local port in TIME_WAIT for 60s
    const perNode = conns0 / CLIENT_NODES
    const portsUse = (perNode * TIME_WAIT_S) / PORTS
    const portFail = over(portsUse)                                  // EADDRNOTAVAIL
    // SYNs on the wire: a dropped SYN is retransmitted, up to tcp_syn_retries = 6 times
    const fresh = conns0 * (1 - portFail)
    let tries = 0
    for (let k = 0; k <= 6; k++) tries += d ** k
    const sent = fresh * tries
    const retrans = sent - fresh
    // conntrack: every SYN gets an entry, even one the listener later drops
    const ctUse = (sent * CT_TIMEOUT_S) / CT_MAX
    const ctDrop = over(ctUse)
    const past = sent * (1 - ctDrop)
    const synUse = past / SYN_RATE
    const acceptUse = past / ACCEPT_RATE
    // a full accept queue makes the kernel drop the SYN: ListenOverflows + ListenDrops
    const listenDrop = Math.max(over(acceptUse), over(synUse))
    const accepted = past * (1 - listenDrop)
    const tlsShare = Math.min(1, accepted / ACCEPT_RATE)
    const reqs = keepAlive ? Math.min(REQ_RATE, reqRate * (1 - portFail) * (1 - ctDrop) * (1 - listenDrop)) : accepted
    const cpu = Math.min(1, tlsShare * 0.85 + (reqs / REQ_RATE) * 0.15)
    const nic = (sent * PKTS_PER_CONN + reqRate * PKTS_PER_REQ) / NIC_PPS
    const ctDrops = sent * ctDrop
    const listenDrops = past * listenDrop
    const dNew = sent > 0 ? (ctDrops + listenDrops) / sent : 0
    d = 0.5 * d + 0.5 * dNew // damped, so the feedback settles instead of oscillating
    r = {
      conns: conns0,
      retrans,
      goodput: reqs,
      stages: [
        { id: 'client', name: 'client ports', sub: `${Math.round(Math.min(portsUse, 1) * PORTS).toLocaleString()} / ${PORTS.toLocaleString()} per node`, use: portsUse, drop: portFail * conns0, counter: 'cannot assign requested address' },
        { id: 'nic',    name: 'NIC',          sub: `${Math.round(nic * NIC_PPS / 1000)}k pps`, use: nic, drop: 0 },
        { id: 'ct',     name: 'conntrack',    sub: `${Math.round(Math.min(ctUse, 1) * CT_MAX / 1000)}k / ${CT_MAX / 1024}k entries`, use: ctUse, drop: ctDrops, counter: 'conntrack: table full' },
        { id: 'syn',    name: 'SYN queue',    sub: `${Math.round(past).toLocaleString()} SYN/s`, use: Math.max(synUse, acceptUse > 1 ? 0.9 : 0), drop: 0, counter: 'TcpExtListenDrops' },
        { id: 'accept', name: 'accept queue', sub: `${Math.round(accepted).toLocaleString()} accepted/s`, use: acceptUse, drop: listenDrops, counter: 'TcpExtListenOverflows' },
        { id: 'app',    name: 'app CPU',      sub: `${Math.round(tlsShare * 85)}% on TLS handshakes`, use: cpu, drop: 0 },
      ],
    }
  }
  return r
}
