import { lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import PostHeader from '../../components/PostHeader'
import CodeBlock from '../../components/CodeBlock'

const HandshakeLadder  = lazy(() => import('./HandshakeLadder'))
const RetransmitSim    = lazy(() => import('./RetransmitSim'))
const ReceiveWindow    = lazy(() => import('./ReceiveWindow'))
const CongestionWindow = lazy(() => import('./CongestionWindow'))
const TCPStateMachine  = lazy(() => import('./TCPStateMachine'))
const KernelPath       = lazy(() => import('./KernelPath'))
const NagleStall       = lazy(() => import('./NagleStall'))

function VisualizerFallback() {
  return <div className="viz-card viz-loading" aria-label="Loading interactive visualizer">loading interactive visualizer…</div>
}

export default function TcpInternals() {
  return (
    <article className="article-shell prose prose-neutral mx-auto">
      <PostHeader
        title="TCP from the inside"
        date="2026-08-22"
        tags={['tcp', 'networking', 'linux', 'internals']}
        readingTime="30 min"
      />

      <section>
        <h2>Everyone has debugged a TCP problem. Almost nobody can explain one.</h2>

        <p>
          The page fires at 2 a.m. p99 latency has gone from 4 ms to 4 seconds. CPU is flat, the database is bored, the application logs say nothing at all. You SSH in, run <code>ss -s</code>, and find forty-seven thousand sockets sitting in <code>TIME_WAIT</code>.
        </p>

        <p>
          Most engineers restart the service at this point, watch the graph recover, and file it under mysteries. It works, because a restart wipes the socket table. It also guarantees you will be back here in a week, because nothing you did addressed why forty-seven thousand connections were being created and destroyed in the first place.
        </p>

        <p>
          TCP is the most read-about and least understood protocol in production systems. Everyone can draw SYN, SYN-ACK, ACK on a whiteboard. Far fewer can say what number is in the ACK field and why it is that number, what happens to the connection when a single segment is dropped, or which of the two windows — the one the receiver advertises or the one the sender invented — is actually limiting their throughput right now.
        </p>

        <p>
          This post is the layer underneath. Seven things that determine how TCP behaves in production: the handshake, reliable delivery, flow control, congestion control, the state machine, what the Linux kernel actually runs, and the gotchas that page you. Each one comes with a visualizer you can break on purpose.
        </p>

        <p>
          Start with the three packets everyone thinks they know.
        </p>

        <Suspense fallback={<VisualizerFallback />}><HandshakeLadder /></Suspense>
      </section>

      <section>
        <h2>Part 1: The handshake is a state exchange, not a greeting</h2>

        <p>
          The three-way handshake is usually taught as a politeness ritual — hello, hello back, thanks. That framing hides the actual work. The handshake exists to do one thing: <strong>make both ends agree on where each direction&rsquo;s byte stream starts.</strong> A TCP connection is two independent streams, one in each direction, and each one needs its own starting sequence number.
        </p>

        <p>
          So the client picks an Initial Sequence Number and puts it in the SYN. The server picks <em>its own, entirely unrelated</em> ISN and puts that in the SYN-ACK — while separately acknowledging the client&rsquo;s. The third packet closes the loop. Three packets, because there are two ISNs to communicate and each one needs acknowledging, and one of the four logical messages can be piggybacked.
        </p>

        <h3>Why the ISN is random</h3>

        <p>
          It would be much simpler to start every connection at zero. It would also be a security hole and a correctness bug at the same time.
        </p>

        <p>
          The correctness half: IP networks reorder and delay. A segment from a previous connection on the same four-tuple can turn up minutes later. If sequence numbers always started at zero, that straggler would look like perfectly valid data for the <em>current</em> connection, and TCP would deliver it to your application. Random ISNs make the odds of an old segment falling inside the current window vanishingly small.
        </p>

        <p>
          The security half: if the ISN is predictable, an off-path attacker who can guess it can inject data into your connection, or forge an RST and kill it, without ever seeing a packet. Linux generates ISNs from a keyed hash over the four-tuple plus a clock, per RFC 6528, so they are unpredictable to anyone who does not already know the tuple.
        </p>

        <h3>Why three packets and not two</h3>

        <p>
          The classic answer is &ldquo;to prevent half-open connections,&rdquo; which is correct and unilluminating. The concrete failure looks like this. A client sends a SYN. The network stalls it. The client times out and retries on a new connection, gets served, and goes away. Twenty seconds later the original SYN finally arrives at the server.
        </p>

        <p>
          With a two-way handshake, the server would allocate a connection, reply, and consider the connection open. There is no third message, so there is no opportunity for the client to say &ldquo;I never asked for this.&rdquo; The server sits there with a live socket, a receive buffer, and possibly a worker thread, serving nobody. With three, the client receives a SYN-ACK for a connection it does not have, replies with an RST, and the server tears the whole thing down.
        </p>

        <h3>The teardown needs four, for the opposite reason</h3>

        <p>
          Opening is symmetric — neither side can send until both are ready. Closing is not. <strong>A TCP connection is two simplex streams, and they are shut down independently.</strong> When your side calls <code>close()</code>, you are saying &ldquo;I will send no more bytes.&rdquo; You are not saying anything about the peer, and it may have plenty left to send.
        </p>

        <p>
          So each direction gets its own FIN and its own ACK: four segments. The state between them — one side closed, the other still sending — is called a half-close, and it is a real, legitimate, useful state. It is what <code>shutdown(fd, SHUT_WR)</code> gives you deliberately.
        </p>

        <p>
          Both SYN and FIN consume a sequence number even though neither carries payload. That is why every ACK in the visualizer above comes back as <code>ISN+1</code>, and why the final ACK of the teardown is <code>ISN+2</code>. It is also what makes them reliable: because they occupy sequence space, a lost FIN gets retransmitted like any other unacknowledged data.
        </p>

        <CodeBlock lang="text" code={`$ tcpdump -n -i any 'tcp port 443' -c 6

IP 10.0.1.7.54312 > 10.0.4.9.443: Flags [S],  seq 1320745829,                  win 64240, options [mss 1460,sackOK,TS,nop,wscale 7]
IP 10.0.4.9.443 > 10.0.1.7.54312: Flags [S.], seq 3811002447, ack 1320745830,  win 65160, options [mss 1460,sackOK,TS,nop,wscale 7]
IP 10.0.1.7.54312 > 10.0.4.9.443: Flags [.],               ack 3811002448,     win 502
IP 10.0.1.7.54312 > 10.0.4.9.443: Flags [P.], seq 1:518,   ack 1,              win 502, length 517
IP 10.0.4.9.443 > 10.0.1.7.54312: Flags [.],               ack 518,            win 509
IP 10.0.4.9.443 > 10.0.1.7.54312: Flags [P.], seq 1:2921,  ack 518,            win 509, length 2920`} />

        <p>
          Two things in that capture are worth naming. The options in the SYN — <code>mss</code>, <code>sackOK</code>, <code>wscale 7</code> — are negotiated <strong>once, in the handshake, and never again</strong>. Window scaling in particular is all-or-nothing for the life of the connection, which is why an old middlebox that strips the option can cap a modern connection at 64 KB in flight forever. And notice that <code>tcpdump</code> switches to relative sequence numbers after the handshake: <code>seq 1:518</code> means bytes 1 through 517 of this direction&rsquo;s stream. That relabelling is a display convenience, and it is also the correct mental model.
        </p>
      </section>

      <section>
        <h2>Part 2: Reliable delivery is a numbering scheme and a timer</h2>

        <p>
          TCP runs on top of IP, which offers no guarantees whatsoever. Packets may be dropped, duplicated, reordered, or corrupted. Every reliability property you get from TCP is built out of exactly two mechanisms: <strong>numbering every byte, and retransmitting anything not acknowledged in time.</strong> That is the whole thing.
        </p>

        <h3>Sequence numbers count bytes, not packets</h3>

        <p>
          This is the most common misreading, and it changes how everything else works. A sequence number is a byte offset into that direction&rsquo;s stream. If you send a 1460-byte segment starting at sequence 5000, the next segment starts at 6460. Nothing counts packets anywhere in the protocol.
        </p>

        <p>
          That is why TCP is a <em>stream</em> and not a message protocol. Your three 100-byte <code>write()</code> calls may arrive as one 300-byte <code>read()</code>, or as a 250-byte read followed by a 50-byte read, and both are correct behaviour. Every framing bug in every hand-rolled protocol comes from expecting otherwise.
        </p>

        <h3>An ACK is cumulative, and that makes lost ACKs cheap</h3>

        <p>
          <code>ack=7000</code> does not mean &ldquo;I got the segment starting at 7000.&rdquo; It means <strong>&ldquo;I have every byte below 7000, and 7000 is what I want next.&rdquo;</strong> It is a high-water mark, not a receipt.
        </p>

        <p>
          The consequence is that losing an ACK usually costs nothing at all. If the ACK for byte 7000 is dropped but the ACK for byte 10000 arrives, the second one already tells the sender everything the first one would have. Only the last ACK of a burst is genuinely load-bearing, and if that one is lost the RTO cleans it up.
        </p>

        <p>
          Losing a <em>segment</em> is a different matter, and the visualizer below lets you do both so you can watch the asymmetry. Drop a segment and everything behind it stacks up in the receiver&rsquo;s out-of-order queue while it repeats the same ACK number. Drop an ACK and, almost always, nothing happens.
        </p>

        <Suspense fallback={<VisualizerFallback />}><RetransmitSim /></Suspense>

        <h3>The retransmission timeout adapts, because the network moves</h3>

        <p>
          How long should a sender wait before deciding a segment is lost? Too short and you flood a healthy network with duplicates. Too long and every loss costs you seconds. And the right answer on a 0.3 ms path inside a rack is four orders of magnitude away from the right answer on a satellite link.
        </p>

        <p>
          So TCP measures. Every unambiguous ACK produces an RTT sample, and Jacobson&rsquo;s algorithm — now RFC 6298 — folds it into a smoothed average and a variance estimate:
        </p>

        <CodeBlock lang="text" code={`RTTVAR = (1 - 1/4) · RTTVAR + 1/4 · | SRTT - R |
SRTT   = (1 - 1/8) · SRTT   + 1/8 · R

RTO    = SRTT + max(G, 4 · RTTVAR)      clamped to [200ms, 120s] on Linux`} />

        <p>
          The variance term is the part people skip, and it is the part that matters. A path with a rock-steady 50 ms RTT and a path that jitters between 10 ms and 90 ms have the same mean. The first deserves an RTO just above 50 ms; the second would retransmit constantly at that value. Multiplying the deviation by four buys headroom proportional to how unpredictable the path actually is.
        </p>

        <p>
          There is a subtlety in taking those samples. If a segment was retransmitted, and an ACK for it arrives, you cannot tell whether it is acknowledging the original or the copy — and the two interpretations give wildly different RTTs. <strong>Karn&rsquo;s algorithm</strong> resolves it by refusing to take an RTT sample from any retransmitted segment at all. The simulator above marks those ACKs, so you can watch SRTT freeze during a recovery.
        </p>

        <h3>Three duplicate ACKs mean loss, and waiting for the RTO is a waste</h3>

        <p>
          When a segment goes missing, everything after it still arrives. The receiver cannot advance <code>rcv_nxt</code> past the hole, so each arrival produces another ACK carrying the same number. Those duplicate ACKs are information: they prove packets are still flowing, which means the path is alive and one specific segment is missing.
        </p>

        <p>
          Waiting a full RTO to act on that is pure latency. <strong>Fast retransmit</strong> takes three duplicate ACKs as sufficient proof and resends immediately. Why three and not one? Because reordering also produces duplicate ACKs, and a network that delivers packets slightly out of order is normal. Three is the empirical threshold where reordering becomes unlikely enough to act on.
        </p>

        <p>
          Modern Linux does better still. With SACK enabled — and it is, on everything — the receiver reports exactly which ranges it holds, instead of just repeating a high-water mark. The sender then retransmits precisely the missing ranges rather than guessing. RACK-TLP, the default loss detection since 4.18, goes further and uses time rather than dup-ACK counts, which recovers correctly even when reordering is heavy.
        </p>
      </section>

      <section>
        <h2>Part 3: Flow control — the receiver sets the pace</h2>

        <p>
          Reliability tells you what happens when a byte is lost. It says nothing about how fast to send in the first place. There are two separate answers to that question, they come from two different places, and confusing them is the single most common source of wrong TCP intuition.
        </p>

        <p>
          The first is <strong>flow control</strong>, and it protects the receiver. When bytes arrive, the kernel puts them in that socket&rsquo;s receive buffer, where they sit until the application calls <code>read()</code>. If the sender is faster than the application, the buffer fills. There is nowhere else for the data to go, so TCP has to be able to say &ldquo;stop.&rdquo;
        </p>

        <p>
          The mechanism is one field in the header. Every ACK carries a <strong>receive window</strong> — <code>rwnd</code> — which is the free space left in that buffer. The rule for the sender is absolute: <em>never have more unacknowledged bytes in flight than the last advertised rwnd.</em>
        </p>

        <Suspense fallback={<VisualizerFallback />}><ReceiveWindow /></Suspense>

        <h3>Zero window, and the timer that stops it deadlocking</h3>

        <p>
          Starve the application in that widget and the tank fills, <code>rwnd</code> reaches zero, and the sender stops dead. This is not an error condition — it is flow control working exactly as designed, and it is also why a slow consumer shows up as a stalled producer several services away.
        </p>

        <p>
          But it sets up a deadlock. The sender is waiting for a window update. The window update is an ACK. ACKs are only sent in response to data. The sender cannot send data. If the one window-update ACK that would have restarted things is dropped, both ends wait forever.
        </p>

        <p>
          TCP breaks it with the <strong>persist timer</strong>. While the window is zero, the sender periodically transmits a one-byte probe purely to force the receiver to answer with a fresh ACK, and therefore a fresh window. It is a small, deliberate protocol violation that turns a permanent deadlock into a bounded delay.
        </p>

        <h3>Sixteen bits was not enough</h3>

        <p>
          The window field in the TCP header is 16 bits: 65535 bytes, maximum. That was generous in 1981 and is now a serious limit, because throughput on a lossless path is bounded by window over round-trip time:
        </p>

        <CodeBlock lang="text" code={`throughput ≤ window / RTT

    64 KB / 1 ms    =   524 Mbit/s     same rack, fine
    64 KB / 40 ms   =    13 Mbit/s     London to Frankfurt
    64 KB / 150 ms  =   3.5 Mbit/s     London to Sydney

  1 MB  / 150 ms  =    56 Mbit/s     the same link, wscale 4`} />

        <p>
          That third line is why a cross-continent transfer on a 10 Gbit link can crawl at 3.5 Mbit/s with nothing wrong anywhere. The pipe is not full; the window is too small to fill it. This quantity — bandwidth × delay — is the <strong>bandwidth-delay product</strong>, and it is the amount of data that has to be in flight to keep a path busy.
        </p>

        <p>
          RFC 1323 fixed it with the window scale option: a shift count, negotiated once in the SYN, applied to every window field afterwards. <code>wscale 7</code> multiplies by 128, taking the ceiling to 8 MB. It has to be in the SYN because both sides must agree before any window is ever interpreted — there is no way to renegotiate later, and a middlebox that strips the option silently pins you to 64 KB for the life of the connection.
        </p>
      </section>

      <section>
        <h2>Part 4: Congestion control — the sender guesses the network&rsquo;s limit</h2>

        <p>
          Flow control stops you from overwhelming the receiver. Nothing so far stops you from overwhelming <em>the path</em>. The receiver may have a gigabyte of buffer and still be behind a switch whose queue is a few hundred packets deep.
        </p>

        <p>
          This is the harder problem, because there is no field for it. No router tells you its queue depth. <strong>The sender has to infer the network&rsquo;s capacity from the only signal it gets: whether packets arrive.</strong> The variable it maintains for that guess is the congestion window, <code>cwnd</code>, and it is entirely local — it appears in no header anywhere.
        </p>

        <p>
          So a sender is bounded by both windows at once:
        </p>

        <CodeBlock lang="text" code={`bytes in flight  ≤  min( cwnd, rwnd )
                      ↑     ↑
                      │     └── the receiver's buffer, in every ACK header
                      └──────── the sender's private estimate of the network`} />

        <p>
          When throughput is disappointing, the first useful question is which of those two is binding. They have completely different fixes: <code>rwnd</code>-limited means tune buffers, <code>cwnd</code>-limited means you are losing packets somewhere.
        </p>

        <Suspense fallback={<VisualizerFallback />}><CongestionWindow /></Suspense>

        <h3>Slow start is not slow</h3>

        <p>
          A new connection knows nothing about the path, so it starts small and probes upward — but it probes <em>exponentially</em>. Every ACK increases <code>cwnd</code> by one MSS, which means it doubles every round trip. Linux starts at 10 segments (RFC 6928), so a connection reaches roughly 640 segments in flight in six round trips.
        </p>

        <p>
          The name is historical. It is called slow start because it starts slow, not because it is slow — it is the most aggressive growth phase TCP has, and for short-lived connections it is the <em>only</em> phase that ever runs. A 40 KB HTTP response finishes inside slow start and never touches congestion avoidance at all. This is exactly why connection reuse matters so much for web latency: a warm connection has a large <code>cwnd</code> already, a cold one has ten segments.
        </p>

        <h3>AIMD: the shape of the sawtooth</h3>

        <p>
          Doubling forever obviously ends badly, so <code>ssthresh</code> marks where TCP switches from probing to creeping. Above it, growth becomes <strong>additive increase</strong>: one MSS per round trip, not per ACK. On loss it does <strong>multiplicative decrease</strong>: halve.
        </p>

        <p>
          Additive-increase / multiplicative-decrease is not arbitrary. It is the rule that makes independent senders converge on a fair share of a shared link without talking to each other. Cautious on the way up, decisive on the way down. That is the sawtooth in the chart, and it is TCP&rsquo;s entire theory of fairness.
        </p>

        <h3>Not all losses are equal</h3>

        <p>
          Press both loss buttons in the visualizer and watch the difference, because it is the difference between a hiccup and an outage.
        </p>

        <ul>
          <li>
            <strong>Three duplicate ACKs</strong> — packets are still arriving, so the path is alive and the ACK clock is intact. Reno halves <code>cwnd</code>, sets <code>ssthresh</code> to match, and continues in congestion avoidance. This is <em>fast recovery</em>, and it costs you half your throughput for a few round trips.
          </li>
          <li>
            <strong>An RTO</strong> — nothing came back at all. TCP has lost its ACK clock entirely and no longer has any evidence about the path. <code>cwnd</code> collapses to one segment and slow start restarts from scratch. On a 100 ms path that is most of a second before you are back to where you were.
          </li>
        </ul>

        <p>
          That gap is why fast retransmit exists, why SACK matters, and why a tail-loss event — losing the last packets of a response, where there is no subsequent data to generate duplicate ACKs — used to be so brutally expensive. Tail Loss Probe, now standard, exists specifically to convert those RTOs into fast retransmits.
        </p>

        <h3>Why Linux does not ship Reno</h3>

        <p>
          Reno&rsquo;s +1 MSS per RTT is far too timid on a fat, long path. To fill a 10 Gbit link at 100 ms RTT you need about 85,000 segments in flight; recovering from one halving at one segment per RTT takes roughly 42,000 round trips, which is over an hour. In that time you will certainly lose another packet, and the window will never get near the ceiling.
        </p>

        <p>
          <strong>CUBIC</strong>, the Linux default since 2.6.19, replaces the linear ramp with a cubic function of the time since the last congestion event:
        </p>

        <CodeBlock lang="text" code={`W(t) = C · (t − K)³ + W_max        C = 0.4,  K = ∛( W_max · β / C ),  β = 0.3`} />

        <p>
          The curve is steep immediately after the drop, flattens as it approaches <code>W_max</code> — the window that caused the loss, and therefore the best available estimate of the path&rsquo;s capacity — and then steepens again to probe past it. Turn on the CUBIC series in the chart and trigger a loss: it spends its time near the ceiling rather than crawling toward it.
        </p>

        <p>
          Two more worth knowing by name. <strong>BBR</strong> abandons loss as a congestion signal entirely and models the path&rsquo;s bottleneck bandwidth and minimum RTT directly, which makes it much better on lossy paths and much better at avoiding bufferbloat — at the cost of being aggressive toward CUBIC flows sharing a link. <strong>ECN</strong> lets routers mark packets instead of dropping them, so congestion can be signalled without losing anything. Switching is one sysctl:
        </p>

        <CodeBlock lang="bash" code={`# what is available, and what is in use
sysctl net.ipv4.tcp_available_congestion_control
sysctl net.ipv4.tcp_congestion_control

# switch the default (BBR needs the fq or fq_codel qdisc to pace correctly)
sysctl -w net.core.default_qdisc=fq
sysctl -w net.ipv4.tcp_congestion_control=bbr`} />
      </section>

      <section>
        <h2>Part 5: The state machine, and what TIME_WAIT costs</h2>

        <p>
          Everything so far is what TCP does with bytes. Underneath it, every connection is a finite state machine, and most of the operational surprises are transitions people have never looked at.
        </p>

        <Suspense fallback={<VisualizerFallback />}><TCPStateMachine /></Suspense>

        <h3>The two closes are not symmetric</h3>

        <p>
          Step through the active and passive scenarios back to back. The side that calls <code>close()</code> first ends up in <code>TIME_WAIT</code> and holds its four-tuple for a full minute after the connection is functionally over. The side that receives the FIN passes through <code>CLOSE_WAIT</code> and <code>LAST_ACK</code> and is completely finished first, holding nothing.
        </p>

        <p>
          <strong>Whoever closes first pays.</strong> That one fact explains a whole category of production behaviour: why your load balancer accumulates <code>TIME_WAIT</code> and your backends do not, why moving the close to the other end of a connection changes which box runs out of ports.
        </p>

        <h3>CLOSE_WAIT is always your bug</h3>

        <p>
          A socket in <code>CLOSE_WAIT</code> means the peer sent a FIN, the kernel acknowledged it, and it is now waiting for <em>your application</em> to call <code>close()</code>. The kernel cannot do it for you — you might still have data to send. There is no timeout on this state.
        </p>

        <p>
          So sockets stuck in <code>CLOSE_WAIT</code> are never a network problem and never the peer&rsquo;s fault. They are a leaked file descriptor: an error path that returns without closing, a connection pool that drops a connection without releasing it, a <code>defer</code> that was never written. If <code>ss -tan state close-wait</code> keeps climbing, go look at your error handling, not your network.
        </p>

        <h3>Why TIME_WAIT exists, and why you should not disable it</h3>

        <p>
          <code>TIME_WAIT</code> looks like pure waste — the connection is over, why hold the tuple? It does two jobs.
        </p>

        <p>
          First, it absorbs stragglers. A delayed duplicate from the old connection can still be wandering the network. If the same four-tuple were immediately reused, that segment could be accepted as valid data on the <em>new</em> connection. Holding the tuple for twice the maximum segment lifetime guarantees anything still in flight has expired.
        </p>

        <p>
          Second, it protects the teardown itself. The final ACK might be lost. If it is, the peer retransmits its FIN — and someone has to be there to answer. A socket that vanished immediately would reply with an RST, and the peer would report a connection error on a connection that closed perfectly.
        </p>

        <p>
          The arithmetic is what hurts. Linux uses a fixed <code>TCP_TIMEWAIT_LEN</code> of 60 seconds, and the default ephemeral range gives you 28,232 ports per destination pair. At 500 connections per second to one upstream, you hold 30,000 tuples — and <code>connect()</code> starts failing with <code>EADDRNOTAVAIL</code>. Drag the slider in the widget to find your own cliff.
        </p>

        <p>
          The fix is almost never a sysctl. It is to stop creating a connection per request:
        </p>

        <CodeBlock lang="go" code={`// The default http.Client keeps 2 idle connections per host. Under any real
// concurrency that means most requests dial, use, and close — and every one of
// those closes parks a tuple in TIME_WAIT for 60 seconds.
transport := &http.Transport{
    MaxIdleConns:        512,
    MaxIdleConnsPerHost: 128,  // the one that actually matters
    IdleConnTimeout:     90 * time.Second,
}
client := &http.Client{Transport: transport, Timeout: 5 * time.Second}

// And read every response body to completion, or the connection is never
// returned to the pool and the tuning above buys you nothing.
resp, err := client.Get(url)
if err != nil {
    return err
}
defer resp.Body.Close()
io.Copy(io.Discard, resp.Body)`} />

        <h3>SO_REUSEADDR and SO_REUSEPORT do different things</h3>

        <p>
          These get cargo-culted together and they are unrelated.
        </p>

        <ul>
          <li>
            <strong><code>SO_REUSEADDR</code></strong> lets <code>bind()</code> succeed on a local address that still has connections in <code>TIME_WAIT</code>. It is what stops &ldquo;address already in use&rdquo; when you restart a server. It does not let two live listeners share a port, and it does not reduce the number of sockets in <code>TIME_WAIT</code> by one.
          </li>
          <li>
            <strong><code>SO_REUSEPORT</code></strong> (Linux 3.9+) lets multiple sockets bind the <em>same</em> address and port simultaneously, with the kernel hashing each incoming connection to one of them. It is how you run N worker processes each with their own listening socket and no accept-queue contention.
          </li>
        </ul>

        <p>
          And a warning on the sysctls people reach for: <code>net.ipv4.tcp_tw_recycle</code> was <strong>removed in Linux 4.12</strong>. It broke connections from clients behind NAT badly and silently. <code>tcp_tw_reuse</code> still exists and is safe for outbound connections, because it only reuses a <code>TIME_WAIT</code> tuple when timestamps prove the old incarnation is gone. Neither is a substitute for connection pooling.
        </p>
      </section>

      <section>
        <h2>Part 6: What the Linux kernel actually runs</h2>

        <p>
          Everything up to here is the protocol. This is the implementation — the code your <code>write()</code> lands in, the struct your connection lives in, and the hooks you can attach to when you need to see it. Most engineers have never looked at this layer, and it is where every question about TCP performance is eventually answered.
        </p>

        <Suspense fallback={<VisualizerFallback />}><KernelPath /></Suspense>

        <h3>The sk_buff: one struct, every layer</h3>

        <p>
          Every packet in the Linux network stack is an <code>sk_buff</code>. The same allocation travels from the NIC driver to the socket and back, and the reason it is designed the way it is comes down to one requirement: <strong>no layer may copy the payload.</strong>
        </p>

        <p>
          It holds a pointer to a data area plus separate pointers to where the transport, network and MAC headers live inside it. Adding a header on the way out is <code>skb_push()</code> — move the data pointer backwards into pre-allocated headroom and write there. Stripping one on the way in is <code>skb_pull()</code> — move the pointer forwards. Seven layers of encapsulation, zero memcpy of payload.
        </p>

        <p>
          That design is also what makes <code>sendfile()</code> and <code>splice()</code> possible. If the payload never needs touching by the CPU, it never needs to enter userspace at all: the pages go straight from page cache to <code>sk_buff</code> to NIC by DMA.
        </p>

        <h3>Where your connection lives: struct tcp_sock</h3>

        <p>
          Every TCP connection is a <code>struct tcp_sock</code>, which embeds <code>struct inet_connection_sock</code>, which embeds <code>struct sock</code>. Strip away the several hundred fields and what is left is every variable from the previous five sections:
        </p>

        <CodeBlock lang="c" code={`/* include/linux/tcp.h — the fields this post has been describing */
struct tcp_sock {
    u32  snd_una;      /* oldest unacknowledged byte                    */
    u32  snd_nxt;      /* next sequence number to send                  */
    u32  rcv_nxt;      /* next byte expected from the peer              */

    u32  snd_wnd;      /* the window the peer advertised to us (rwnd)   */
    u32  rcv_wnd;      /* the window we are advertising to the peer     */

    u32  snd_cwnd;     /* congestion window, in MSS units               */
    u32  snd_ssthresh; /* slow start threshold                          */

    u32  srtt_us;      /* smoothed RTT, in microseconds << 3            */
    u32  mdev_us;      /* medium deviation                              */
    u32  rttvar_us;    /* smoothed mdev — the RTO variance term         */

    struct sk_buff_head out_of_order_queue;  /* segments past a gap     */
    ...
};`} />

        <p>
          Two details worth carrying. <code>srtt_us</code> is stored left-shifted by three, so a raw read has to be divided by eight to be microseconds — the shift is how the fixed-point smoothing avoids floating point in the kernel. And since 5.19, <code>snd_cwnd</code> is accessed through the <code>tcp_snd_cwnd()</code> accessor rather than directly, so out-of-tree code and old blog posts that touch the field will not compile against a current tree.
        </p>

        <p>
          You do not need a debugger to read any of this. <code>ss -ti</code> dumps it per socket:
        </p>

        <CodeBlock lang="text" code={`$ ss -ti state established '( dport = :443 )'

Recv-Q Send-Q  Local Address:Port    Peer Address:Port
     0  14600  10.0.1.7:54312        10.0.4.9:443
     cubic wscale:7,7 rto:212 rtt:11.4/2.75 mss:1448 pmtu:1500 rcvmss:1448
     cwnd:24 ssthresh:18 bytes_sent:184320 bytes_acked:169720 bytes_received:8214
     segs_out:132 segs_in:96 data_segs_out:126 send 24.4Mbps lastsnd:4 lastrcv:12
     pacing_rate 29.3Mbps delivery_rate 21.1Mbps busy:284ms retrans:0/3 rcv_space:14480`} />

        <p>
          Read that line by line and the whole post is in it. <code>rto:212</code> and <code>rtt:11.4/2.75</code> are SRTT and RTTVAR feeding the formula from Part 2 — 11.4 + 4×2.75 ≈ 22 ms, floored to the 200 ms minimum and rounded. <code>cwnd:24</code> against <code>ssthresh:18</code> says this connection is in congestion avoidance, past a loss. <code>retrans:0/3</code> says three retransmissions have happened over its life and none are outstanding now. <code>Send-Q 14600</code> is bytes sitting in the send buffer that the kernel has not managed to push out.
        </p>

        <h3>NAPI: why your NIC does not interrupt per packet</h3>

        <p>
          The obvious receive design is one hardware interrupt per arriving frame. At 10,000 packets per second that is fine. At 10 Gbit line rate with small packets — 14.8 million packets per second — it is a livelock: the CPU spends 100% of its time entering and leaving the interrupt handler and never returns to userspace at all.
        </p>

        <p>
          <strong>NAPI</strong> inverts it. The first packet raises an interrupt; the handler immediately masks further interrupts from that queue and schedules a softirq. That softirq then <em>polls</em> the RX ring, draining up to a budget of packets in one pass, and only re-enables interrupts when the ring runs dry. Load goes up, interrupt rate goes down, and the cost per packet falls.
        </p>

        <p>
          On the way through, <code>napi_gro_receive()</code> does Generic Receive Offload: adjacent segments of the same flow are merged into one large <code>sk_buff</code> before the stack above sees them, so <code>tcp_rcv_established()</code> is called once for 40 KB instead of thirty times for 1448 bytes. Toggle NAPI off in the widget and watch the interrupt count against a 64-packet burst.
        </p>

        <h3>Socket buffers autotune, and you should let them</h3>

        <p>
          Buffer sizing is where most TCP tuning advice goes wrong. The kernel already does it:
        </p>

        <CodeBlock lang="bash" code={`$ sysctl net.ipv4.tcp_rmem net.ipv4.tcp_wmem
net.ipv4.tcp_rmem = 4096   131072  6291456    # min  default  max
net.ipv4.tcp_wmem = 4096   16384   4194304

$ sysctl net.ipv4.tcp_moderate_rcvbuf
net.ipv4.tcp_moderate_rcvbuf = 1                # receive autotuning: on`} />

        <p>
          With autotuning on, the kernel grows the receive buffer as it measures the connection&rsquo;s bandwidth-delay product and shrinks it under memory pressure. A high-BDP connection gets megabytes; an idle one gets kilobytes.
        </p>

        <p>
          The trap: <strong>setting <code>SO_RCVBUF</code> explicitly turns autotuning off for that socket.</strong> You are no longer overriding the default — you are overriding the algorithm, permanently, with a constant you guessed once. Raise <code>tcp_rmem</code>&rsquo;s maximum instead and let the kernel use the headroom when a connection can actually justify it.
        </p>

        <h3>eBPF: watching all of it without touching a packet</h3>

        <p>
          The kernel exposes stable tracepoints at every interesting TCP event, which means you can observe connection behaviour in production without <code>tcpdump</code>, without a capture file, and without copying payload anywhere.
        </p>

        <CodeBlock lang="bash" code={`# every retransmit, live, with the process responsible
bpftrace -e 'tracepoint:tcp:tcp_retransmit_skb {
    printf("%-16s retransmit %s:%d -> %s:%d\\n",
           comm, ntop(args->saddr), args->sport, ntop(args->daddr), args->dport);
}'

# who is sending RSTs, and who is receiving them
bpftrace -e 'tracepoint:tcp:tcp_send_reset    { @sent[comm] = count(); }
             tracepoint:tcp:tcp_receive_reset { @recv[comm] = count(); }'

# a histogram of how long connections actually live
bpftrace -e 'kprobe:tcp_set_state { @[arg1] = count(); }'`} />

        <p>
          This is the layer real observability tooling is built on. <code>tcpretrans</code>, <code>tcplife</code> and <code>tcpconnlat</code> from BCC are each a few dozen lines around exactly these hooks, and every eBPF-based agent that reports per-connection latency is doing the same thing: attaching to <code>tcp_set_state</code> and <code>tcp_rcv_established</code>, keeping a map keyed by socket pointer, and emitting on teardown.
        </p>

        <p>
          The reason it is worth knowing is cost. A packet capture at 10 Gbit is not something you run on a production box during an incident. A tracepoint that increments a counter in a BPF map is nanoseconds, always on, and gives you the one number you wanted — which sockets are retransmitting, right now, and whose code opened them.
        </p>
      </section>

      <section>
        <h2>Part 7: The parts that page you</h2>

        <p>
          Six sections of theory. This is the on-call version.
        </p>

        <h3>Nagle plus delayed ACK: the 40 ms stall</h3>

        <p>
          Two reasonable optimisations that combine into a pathology. <strong>Nagle&rsquo;s algorithm</strong> refuses to send a second small segment while an earlier one is unacknowledged, to avoid filling the network with 41-byte packets carrying one byte of telnet. <strong>Delayed ACK</strong> holds an acknowledgement for up to 40 ms hoping to piggyback it on a reply, to avoid sending bare ACKs.
        </p>

        <p>
          Put them on opposite ends of a request/response connection and they deadlock against each other on every single request.
        </p>

        <Suspense fallback={<VisualizerFallback />}><NagleStall /></Suspense>

        <p>
          The signature is unmistakable once you have seen it: a latency histogram with a hard spike at 40 ms that no amount of profiling accounts for, because no code is running during it. The fix is <code>TCP_NODELAY</code>, and it belongs on essentially every request/response socket you own — RPC clients, HTTP clients, database drivers, Redis clients. Go sets it by default on <code>net.TCPConn</code>; most C and Python code does not.
        </p>

        <h3>Half-open connections and keepalive</h3>

        <p>
          If the peer&rsquo;s machine loses power, no FIN and no RST is ever sent. Your socket stays <code>ESTABLISHED</code> forever, because an idle TCP connection sends nothing and therefore learns nothing. You find out when you next write and the retransmits eventually time out — minutes later.
        </p>

        <p>
          TCP keepalive exists for this, and its defaults are useless:
        </p>

        <CodeBlock lang="bash" code={`$ sysctl net.ipv4.tcp_keepalive_time net.ipv4.tcp_keepalive_intvl net.ipv4.tcp_keepalive_probes
net.ipv4.tcp_keepalive_time   = 7200    # 2 hours of idle before the first probe
net.ipv4.tcp_keepalive_intvl  = 75      # then a probe every 75s
net.ipv4.tcp_keepalive_probes = 9       # 9 failures before giving up

# 7200 + 9×75 = 2 hours 11 minutes to notice a dead peer`} />

        <p>
          Two hours is not a health check. Either set the per-socket options — <code>TCP_KEEPIDLE</code>, <code>TCP_KEEPINTVL</code>, <code>TCP_KEEPCNT</code> — to something like 30/10/3, or run application-level heartbeats, which have the advantage of also proving the remote <em>process</em> is alive rather than just its kernel. gRPC and most modern RPC frameworks do the latter.
        </p>

        <h3>Retransmit backoff: why a dead peer takes 15 minutes</h3>

        <p>
          Every RTO doubles the next one. Starting at 200 ms: 0.2, 0.4, 0.8, 1.6 … and Linux gives up after <code>tcp_retries2</code> attempts, which defaults to 15 and works out to roughly 924 seconds — a little over 15 minutes — before <code>write()</code> finally returns <code>ETIMEDOUT</code>.
        </p>

        <p>
          Fifteen minutes is far longer than any request timeout you have. If your service is holding a connection to a host that has vanished, the kernel will not tell you for a quarter of an hour. Set <code>TCP_USER_TIMEOUT</code> on the socket — it caps how long unacknowledged data may remain outstanding before the connection is failed, in milliseconds, and it is the single most useful socket option almost nobody sets.
        </p>

        <h3>Reading the state of the machine</h3>

        <CodeBlock lang="bash" code={`# the summary — where are all the sockets?
ss -s

# the specific states that indicate specific bugs
ss -tan state time-wait  | wc -l      # closing too much: pool your connections
ss -tan state close-wait | wc -l      # leaking fds: your bug, in your error paths
ss -tan state syn-recv   | wc -l      # SYN queue filling: flood, or backlog too small

# per-socket internals: cwnd, rtt, retrans, pacing
ss -ti state established

# system-wide counters — retransmit rate is the number that matters
nstat -az | grep -E 'TcpRetransSegs|TcpOutSegs|TcpExtTCPLostRetransmit|ListenDrops'`} />

        <p>
          One derived number is worth more than the rest: <code>TcpRetransSegs / TcpOutSegs</code>. Below about 0.1% is a healthy network. Above 1% and your congestion window is spending its life halved, which shows up to everyone else as unexplained tail latency.
        </p>

        <h3>The bandwidth-delay product, one more time</h3>

        <p>
          The last thing to internalise is that a fast link and a fast transfer are different claims. Throughput is bounded by window over RTT, so a 10 Gbit path with 100 ms of latency needs 125 MB in flight to saturate. If your buffers cap the window at 4 MB, you get 320 Mbit/s — 3% of the link — with zero packet loss and nothing to see in any graph.
        </p>

        <p>
          Distance is not bandwidth. When a transfer between regions is slow, compute the BDP before you blame the network.
        </p>
      </section>

      <section>
        <h2>The production checklist</h2>

        <ol>
          <li><strong>Pool connections.</strong> Almost every <code>TIME_WAIT</code> problem is a connection-per-request problem wearing a disguise. Set <code>MaxIdleConnsPerHost</code>, or its equivalent, and drain response bodies.</li>
          <li><strong>Set <code>TCP_NODELAY</code></strong> on every request/response socket. If you see a 40 ms spike in a latency histogram, this is it.</li>
          <li><strong>Set <code>TCP_USER_TIMEOUT</code></strong> so a vanished peer fails in seconds rather than in <code>tcp_retries2</code>&rsquo;s fifteen minutes.</li>
          <li><strong>Do not set <code>SO_RCVBUF</code>.</strong> Raise <code>tcp_rmem</code>&rsquo;s ceiling and let autotuning use it.</li>
          <li><strong>Alarm on retransmit rate</strong>, not on interface counters. <code>TcpRetransSegs / TcpOutSegs</code> above 1% is a real signal.</li>
          <li><strong>Watch <code>CLOSE_WAIT</code>.</strong> It only ever grows because of a bug in your code.</li>
          <li><strong>Compute the BDP</strong> before concluding a long-distance link is slow.</li>
          <li><strong>Never enable <code>tcp_tw_recycle</code>.</strong> It is gone since 4.12; if you find it in a runbook, delete the line.</li>
        </ol>
      </section>

      <section>
        <h2>Summary: what people get wrong</h2>

        <ol>
          <li><strong>&ldquo;Sequence numbers count packets.&rdquo;</strong> They count bytes. That is why TCP is a stream and why your framing is your problem.</li>
          <li><strong>&ldquo;An ACK confirms one segment.&rdquo;</strong> It is cumulative — a high-water mark. Which is why losing an ACK is usually free and losing a segment is not.</li>
          <li><strong>&ldquo;The window controls the send rate.&rdquo;</strong> There are two windows. <code>rwnd</code> protects the receiver, <code>cwnd</code> protects the network, and you send <code>min()</code> of the two.</li>
          <li><strong>&ldquo;Slow start is slow.&rdquo;</strong> It doubles every RTT. It is the fastest growth TCP has, and for short connections it is the only phase that runs.</li>
          <li><strong>&ldquo;A retransmit is a retransmit.&rdquo;</strong> Fast retransmit halves the window. An RTO collapses it to one segment and restarts slow start. The two differ by orders of magnitude.</li>
          <li><strong>&ldquo;TIME_WAIT is a bug to be disabled.&rdquo;</strong> It is what stops a stale segment corrupting a new connection. Fix the connection churn instead.</li>
          <li><strong>&ldquo;CLOSE_WAIT means the peer misbehaved.&rdquo;</strong> It means your application has not called <code>close()</code>.</li>
          <li><strong>&ldquo;Bigger buffers are faster.&rdquo;</strong> Setting <code>SO_RCVBUF</code> disables autotuning and usually makes things worse.</li>
        </ol>

        <p>
          None of this is exotic. It is the behaviour of every HTTP request, every database query and every gRPC stream your service has ever made — which is exactly why the 2 a.m. version of you should not be meeting it for the first time.
        </p>

        <hr />

        <p>
          If reliable delivery at this layer was interesting, the same problem reappears one layer up with different trade-offs: <Link to="/kafka-internals">Kafka beyond the basics</Link> covers ISR, the high watermark and what <code>acks=all</code> actually buys you — durability built on top of the delivery guarantee described here. <Link to="/postgres-internals">PostgreSQL storage internals</Link> takes it to disk, where the WAL is doing for a database what sequence numbers and ACKs do for a byte stream. For distributed agreement on top of all of it, there are interactive visualizers for <a href="https://raft.string-wise.com" target="_blank" rel="noopener noreferrer">Raft consensus</a> and <a href="https://hash.string-wise.com" target="_blank" rel="noopener noreferrer">consistent hashing</a>.
        </p>
      </section>
    </article>
  )
}
