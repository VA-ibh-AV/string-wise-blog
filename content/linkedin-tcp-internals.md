# LinkedIn drafts — TCP from the inside

Post URL: https://string-wise.com/tcp-internals
OG image: `public/og/tcp-internals.png` (regenerate with `scripts/og/README.md`)

Hashtags for all variants: `#tcp #linux #networking #ebpf #backend #sre`

---

## Variant A — story-led

> The alert fired at 2am. p99 latency was 4 seconds. CPU was flat. The database was bored.
>
> `ss -s` showed 47,000 sockets in TIME_WAIT.
>
> Most engineers restart the service here. It works — a restart wipes the socket table — and it guarantees you'll be back next week, because nothing you did addressed why 47,000 connections were being created and destroyed in the first place.
>
> The real fix was one line in an HTTP transport config. But you only get there if you know why the side that calls close() first is the side that pays.
>
> I wrote the TCP post I wanted at 2am that night. Seven interactive visualizers:
>
> → the handshake, with real sequence numbers on every packet
> → drop a segment vs drop an ACK, and watch why only one of them costs you
> → the receive buffer filling until rwnd hits zero and the sender stalls
> → cwnd climbing through slow start, halving on loss, Reno vs CUBIC side by side
> → the state machine, with a live TIME_WAIT countdown and the port-exhaustion maths
> → an sk_buff walking down through tcp_sendmsg → ip_queue_xmit → the NIC
> → Nagle and delayed ACK deadlocking into the classic 40ms stall
>
> https://string-wise.com/tcp-internals

---

## Variant B — punchy / direct

> You use TCP for every API call, every database query, every gRPC stream you have ever written.
>
> Most engineers can draw SYN, SYN-ACK, ACK — and could not tell you what number is in that ACK field or why.
>
> A few things in the post that surprise people:
>
> • Sequence numbers count bytes, not packets. That's why TCP is a stream and your framing is your problem.
> • There are two windows. rwnd protects the receiver, cwnd protects the network, and you send min() of the two. Most "slow network" tickets are the wrong one.
> • Slow start is the fastest growth phase TCP has. It doubles every RTT. The name is historical.
> • A fast retransmit halves your window. An RTO collapses it to one segment. Those differ by orders of magnitude.
> • Setting SO_RCVBUF doesn't override the default — it turns off the kernel's autotuning permanently.
>
> Seven interactive visualizers you can break on purpose.
>
> https://string-wise.com/tcp-internals

---

## Variant C — eBPF / kernel-led (the practitioner hook)

> Every TCP explainer stops at the protocol. Almost none of them show you the code that runs it.
>
> So the last third of this post is the Linux implementation:
>
> → the sk_buff, and why seven layers of encapsulation involve zero payload copies
> → the send path your write() actually takes: tcp_sendmsg → tcp_transmit_skb → ip_queue_xmit → dev_queue_xmit → the NIC ring
> → the receive path back up: napi_poll → netif_receive_skb → ip_rcv → tcp_v4_rcv → tcp_rcv_established → sk_receive_queue
> → struct tcp_sock, where snd_cwnd, snd_ssthresh, rcv_nxt and srtt_us all live — and how to read every one of them live with `ss -ti`
> → NAPI: why one interrupt per packet is a livelock at 10GbE, and what polling does instead
>
> And the part that makes it operational — the kernel gives you stable tracepoints on all of it:
>
> ```
> bpftrace -e 'tracepoint:tcp:tcp_retransmit_skb {
>     printf("%-16s retransmit\n", comm);
> }'
> ```
>
> That's a live per-process retransmit feed on a production box, at nanoseconds per event, with no packet capture. It's what tcpretrans, tcplife and every eBPF observability agent are built on.
>
> There's an interactive visualizer for the send/receive path — click a layer, watch the sk_buff move, toggle NAPI off and see the interrupt count for a 64-packet burst.
>
> https://string-wise.com/tcp-internals

---

## Hacker News (Show HN)

Title: `Show HN: TCP from the inside – seven interactive visualizers, including the kernel path`

Body:

> I kept finding TCP explainers that stop at the protocol and kernel docs that assume you already know it, so I wrote the thing in between.
>
> Seven interactive visualizers: the handshake with live sequence numbers, an event-driven retransmit simulator (RFC 6298 RTO estimation, Karn's algorithm, 3-dup-ACK fast retransmit — you can drop a segment or drop an ACK and watch the asymmetry), the receive buffer filling to a zero window, cwnd through slow start and AIMD with Reno vs CUBIC, the state machine with the TIME_WAIT port-exhaustion maths, an sk_buff walking the Linux send and receive paths with the real function names, and Nagle × delayed ACK producing the 40ms stall.
>
> The kernel section covers sk_buff zero-copy, struct tcp_sock mapped to the concepts above, `ss -ti` output read field by field, NAPI vs interrupt-per-packet, buffer autotuning, and the eBPF tracepoints you can attach to.
>
> No framework beyond React + SVG; everything is prerendered so it works without JS for the prose.
