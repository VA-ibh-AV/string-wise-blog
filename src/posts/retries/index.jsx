import { lazy, Suspense, useState } from 'react'
import { Link } from 'react-router-dom'
import PostHeader from '../../components/PostHeader'
import CodeBlock from '../../components/CodeBlock'
import { Sparkline, C } from './charts'

const RetryStormSim        = lazy(() => import('./RetryStormSim'))
const JitterPlayground     = lazy(() => import('./JitterPlayground'))
const AmplificationTree    = lazy(() => import('./AmplificationTree'))
const PacketPathSim        = lazy(() => import('./PacketPathSim'))
const TimeoutBudgetBar     = lazy(() => import('./TimeoutBudgetBar'))
const MetastableLoop       = lazy(() => import('./MetastableLoop'))
const BeforeAfterDashboard = lazy(() => import('./BeforeAfterDashboard'))

function VisualizerFallback() {
  return <div className="viz-card viz-loading" aria-label="Loading interactive visualizer">loading interactive visualizer…</div>
}

function Viz({ children }) {
  return <Suspense fallback={<VisualizerFallback />}>{children}</Suspense>
}

const TIMELINE = [
  { t: '02:12', text: 'The database starts a 40-second failover. This is normal. We planned for it.' },
  { t: '02:13', text: 'Failover is done. The database is healthy. CPU is at 20%.' },
  { t: '02:14', text: 'The API error rate is higher than it was during the failover.' },
  { t: '02:20', text: 'The network team reports packet drops on the load balancer, and "nf_conntrack: table full" on the nodes.' },
  { t: '02:45', text: 'Database CPU is pinned at 100%. Queries for real users are close to zero.' },
  { t: '03:30', text: 'The only fix that works: block all traffic at the edge, then let it back in 10% at a time.', bad: true },
]

/** The opening page, as a pager would show it. */
function Timeline() {
  return (
    <div className="viz-card not-prose">
      <p className="viz-title">↳ the page</p>
      <ol className="space-y-3">
        {TIMELINE.map(e => (
          <li key={e.t} className="grid grid-cols-[52px_1fr] gap-3 items-baseline">
            <span className="font-mono text-xs font-semibold" style={{ color: e.bad ? C.bad : 'var(--accent)' }}>{e.t}</span>
            <span className="text-sm viz-strong">{e.text}</span>
          </li>
        ))}
      </ol>
      <p className="font-mono text-[11px] viz-dim mt-5">The database recovered in 40 seconds. Our clients kept it down for more than an hour.</p>
    </div>
  )
}

const TAXONOMY = [
  {
    verdict: 'retry', chip: 'viz-chip-ok',
    items: ['connection refused (nothing was sent)', '503 with Retry-After', '429 Too Many Requests', 'gRPC UNAVAILABLE'],
    why: 'The server did not do the work. Trying again is safe.',
  },
  {
    verdict: 'retry only if idempotent', chip: 'viz-chip-warn',
    items: ['timeout after the request was sent', 'connection reset mid-response', '502 / 504 from a proxy', 'gRPC DEADLINE_EXCEEDED'],
    why: 'The server may have done the work. You do not know.',
  },
  {
    verdict: 'never retry', chip: 'viz-chip-bad',
    items: ['400 validation error', '401 / 403', '404', '409 conflict, 422'],
    why: 'A bad request retried is a slower bad request.',
  },
]

function ErrorTaxonomy() {
  return (
    <div className="viz-card not-prose">
      <p className="viz-title">↳ a failed call → what to do</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {TAXONOMY.map(col => (
          <div key={col.verdict} className="viz-panel">
            <div className={`viz-chip ${col.chip} px-3 py-2 mb-3`}><span className="font-mono text-[11px] font-semibold">{col.verdict}</span></div>
            <ul className="space-y-1.5 mb-3">
              {col.items.map(i => <li key={i} className="font-mono text-[11px] viz-strong">· {i}</li>)}
            </ul>
            <p className="text-xs viz-dim">{col.why}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// shapes for the incident cards: 60 points, trigger at index 20
const shape = f => Array.from({ length: 60 }, (_, i) => f(i))
const wobble = i => Math.sin(i * 1.7) * 3 + Math.sin(i * 0.9) * 2
const INCIDENTS = [
  {
    page: '"Packet drops on the LB right after the DB recovered."',
    metric: 'conntrack entries',
    values: shape(i => (i < 20 ? 30 + wobble(i) : Math.min(100, 30 + (i - 20) * 9))),
    max: 110,
    cause: 'The retry wave opened thousands of short connections. Each one took a conntrack entry that lingers after close. The table filled, and the node dropped packets for every service on it, not only the noisy one.',
    fix: 'Reuse connections. Raise nf_conntrack_max as a stopgap. Put a retry budget on the client pool.',
  },
  {
    page: '"Clients time out, but server CPU is 30%."',
    metric: 'TcpExtListenOverflows / s',
    values: shape(i => (i < 20 ? 0 : 60 + wobble(i) * 4)),
    max: 100,
    cause: 'The accept queue was full. The kernel dropped SYNs before the app ever saw them. The server looks idle because the requests never reached it.',
    fix: 'Check ss -lnt: Recv-Q at or above Send-Q means a full queue. Accept faster, raise somaxconn and the listen backlog, and shed load earlier.',
  },
  {
    page: '"cannot assign requested address" in the API logs.',
    metric: 'sockets in TIME_WAIT',
    values: shape(i => (i < 20 ? 15 + wobble(i) : Math.min(100, 15 + (i - 20) * 6))),
    max: 110,
    cause: 'Every retry opened a new connection to the same destination and closed it. Each closed socket held its local port for 60s. About 28k ports ran out.',
    fix: 'Keep connections alive. Set MaxIdleConnsPerHost to your real concurrency. Drain and close response bodies so connections return to the pool.',
  },
  {
    page: '"Network egress up 5×, user traffic flat."',
    metric: 'egress bytes / s',
    values: shape(i => (i < 20 ? 20 + wobble(i) : 95 + wobble(i))),
    max: 110,
    cause: 'Three layers each retried three times, and every retry sent the full request body again. The users sent the same number of requests as before.',
    fix: 'Retry at one layer. Fail fast everywhere below it. Graph retry rate as its own metric.',
  },
]

function IncidentCards() {
  return (
    <div className="viz-card not-prose">
      <p className="viz-title">↳ four pages you might get during a storm</p>
      <div className="grid gap-4 md:grid-cols-2">
        {INCIDENTS.map(inc => (
          <div key={inc.page} className="viz-panel">
            <p className="text-sm font-semibold viz-strong mb-2">{inc.page}</p>
            <p className="font-mono text-[10px] viz-muted mb-1">{inc.metric}</p>
            <Sparkline values={inc.values} max={inc.max} mark={20} className="sim-chart-line" />
            <p className="text-xs viz-dim mt-3"><span className="font-mono viz-strong">cause · </span>{inc.cause}</p>
            <p className="text-xs viz-dim mt-2"><span className="font-mono" style={{ color: C.ok }}>fix · </span>{inc.fix}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

const CHECKLIST = [
  'Retry at one layer only.',
  'Retry only errors that are safe to retry.',
  'Use exponential backoff with jitter, and cap it.',
  'Use at most 3 attempts, and make them fit inside the timeout budget.',
  'Give every outbound call a timeout, and propagate deadlines.',
  'Put a retry budget on each client: at most 10–20% of traffic.',
  'Honor Retry-After and 429.',
  'Send an idempotency key with every write that is not idempotent.',
  'Reuse connections: keep-alive, and a sane MaxIdleConnsPerHost.',
  'Graph retry rate as its own metric, not hidden inside request rate.',
]

function Checklist() {
  const [done, setDone] = useState(() => CHECKLIST.map(() => false))
  const n = done.filter(Boolean).length
  return (
    <div className="viz-card not-prose">
      <p className="viz-title">↳ retry checklist — {n}/{CHECKLIST.length}</p>
      <ul className="space-y-2">
        {CHECKLIST.map((item, i) => (
          <li key={item}>
            <label className="flex items-start gap-3 cursor-pointer text-sm viz-strong">
              <input type="checkbox" className="mt-1" style={{ accentColor: 'var(--accent)' }} checked={done[i]}
                onChange={() => setDone(d => d.map((v, j) => (j === i ? !v : v)))} />
              <span className={done[i] ? 'viz-muted line-through' : ''}>{item}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function Retries() {
  return (
    <article className="article-shell prose prose-neutral mx-auto">
      <PostHeader
        title="Your retries took down prod. Not the outage."
        date="2026-09-26"
        tags={['distributed-systems', 'reliability', 'networking', 'go']}
        readingTime="26 min"
      />

      <section>
        <h2>The outage was over. The retries weren't.</h2>
        <p>
          Here is a page that many on-call engineers have had in some form. The names are removed. The shape is the
          important part.
        </p>
        <Timeline />
        <p>
          The database was down for 40 seconds. Nothing was wrong with it after that. What kept the system down was the
          response to the failure: thousands of well-meaning retry loops, stacked across layers, all hitting the database at
          the moment it tried to stand back up.
        </p>
        <p>
          Every one of those loops was reasonable when someone wrote it. <code>for i := 0; i &lt; 3; i++</code> looks harmless
          in a code review. This post is about what that loop does when ten thousand copies of it run at once. It covers why
          clients synchronize, how retries multiply across layers, what the network does before your app even sees the
          traffic, and why a system can stay down after the thing that broke it is fixed. The last section is the list of
          fixes that actually work.
        </p>
      </section>

      <section>
        <h2>1. Why we retry at all</h2>
        <p>
          Most failures in a distributed system are <strong>transient</strong>. A packet is dropped. A garbage collector
          pauses for 200ms. A pod is rescheduled. A leader election takes a second. If you try again a moment later, the
          call succeeds. Retrying these is correct, and a client that never retries turns every blip into a user-visible
          error.
        </p>
        <p>
          Some failures are <strong>persistent</strong> or <strong>overload-driven</strong>. The dependency is saturated. It
          is not failing at random; it is failing because it has more work than it can do. Retrying these adds work to the
          thing that is already drowning.
        </p>
        <p>
          The core problem is that from the client's side, both kinds look the same. A timeout is a timeout. A 503 is a
          503. The client cannot tell "blip" from "overloaded", so a naive retry loop treats them the same way. Everything
          else in this post follows from that.
        </p>
        <p>
          You can at least sort failures by what they tell you about the server's state:
        </p>
        <ErrorTaxonomy />
        <p>
          The middle column is the hard one. A timeout means you stopped waiting. It does not mean the server stopped
          working. If the request was <code>POST /payments</code>, the server may have charged the card and then been slow
          to answer. Section 8 comes back to this with idempotency keys.
        </p>
      </section>

      <section>
        <h2>2. The retry storm</h2>
        <p>
          Take N clients. The dependency blips, so they all fail at the same moment. They all wait the same fixed delay and
          retry. So they all arrive at the same moment again. The recovering service gets a wall of traffic once per
          interval.
        </p>
        <p>
          Fixed-delay retries <strong>synchronize</strong> clients. The failure itself was the synchronizing event: it
          started every client's timer at the same instant. After that, a fixed delay keeps them in lockstep.
        </p>
        <p>
          The load during recovery is not normal traffic. It is normal traffic <em>plus every pending retry</em>. A service
          with headroom for 1.2× its normal load can see 3–4× as it comes back. Then it gets worse. The service starts to
          answer, but slowly, because it has a queue. Slow answers cause client timeouts. Timeouts cause more retries. The
          recovery attempt itself creates the next wave.
        </p>
        <p>
          Try it below. Press start, let it settle, then kill the server for five seconds. Watch the offered load after the
          server comes back.
        </p>
        <Viz><RetryStormSim /></Viz>
        <p>
          With <strong>fixed 1s</strong>, the load chart shows tall spikes one second apart after the server returns. Each
          spike is deeper than the server can drain inside the 1s client timeout, so most of it times out, and the clients
          that timed out together retry together. Goodput stays near zero while the server works at full capacity.
        </p>
        <p>
          Switch to <strong>exponential + jitter</strong> and repeat. The spikes smear into a hump, the queue drains, and
          goodput comes back within seconds. Nothing about the server changed. Only the clients' timing changed.
        </p>
        <p>
          Two details in the simulator matter. First, the server cannot tell that a client has given up, so it still spends
          capacity on requests nobody will read. Second, the users keep clicking. Demand does not pause during an outage.
          Those two facts are what turn a spike into a storm.
        </p>
      </section>

      <section>
        <h2>3. Backoff and jitter</h2>
        <p>
          <strong>Exponential backoff</strong> waits longer after each failure: <code>sleep = base * 2^attempt</code>, up to
          a cap. That reduces the total load, which is good. But if every client failed at the same instant, they all
          double in lockstep. The waves get further apart. They are still waves.
        </p>
        <p>
          <strong>Jitter</strong> breaks the lockstep by adding randomness to the wait. The AWS Architecture Blog's analysis
          of backoff compares three common strategies:
        </p>
        <ul>
          <li><strong>Full jitter:</strong> <code>sleep = random(0, min(cap, base * 2^attempt))</code></li>
          <li><strong>Equal jitter:</strong> <code>temp = min(cap, base * 2^attempt); sleep = temp/2 + random(0, temp/2)</code></li>
          <li><strong>Decorrelated jitter:</strong> <code>sleep = min(cap, random(base, prev_sleep * 3))</code></li>
        </ul>
        <p>
          The playground below has 50 clients that all fail at t=0 against a server that accepts 5 calls per 100ms. Each
          client retries until it gets in.
        </p>
        <Viz><JitterPlayground /></Viz>
        <p>
          With no jitter, the histogram is a row of tall spikes. Each wave lets 5 clients in and bounces the other 45, and
          the waves double their spacing until the cap. The last client gets in after about 11 seconds. With any jitter
          strategy, the same 50 clients are done in under 3 seconds, with fewer calls.
        </p>
        <p>
          The strategies trade off differently. Full jitter spreads load the most once the window is wide, but the first
          retry window is only 100ms wide, so its early retries still bunch up. Equal jitter guarantees a minimum wait,
          which is useful when you know the dependency needs at least some time to recover. Decorrelated jitter grows its
          window from the previous sleep and tends to make the fewest calls. Re-roll the seed a few times: the finishing order moves around from run to run.
          Pick one that has jitter. Which one matters much less than whether you have one.
        </p>
        <p>Two rules apply to all of them:</p>
        <ul>
          <li>
            <strong>Always cap the sleep and the attempt count.</strong> Uncapped exponential backoff at attempt 20 with a
            1s base is "retry in 12 days".
          </li>
          <li>
            <strong>Honor <code>Retry-After</code></strong> when the server sends it. The server knows its own state better
            than your formula does.
          </li>
        </ul>
        <CodeBlock lang="go" code={`func backoff(attempt int, base, cap time.Duration) time.Duration {
    exp := base << attempt           // base * 2^attempt
    if exp <= 0 || exp > cap {       // overflow guard + cap
        exp = cap
    }
    return time.Duration(rand.Int63n(int64(exp))) // full jitter
}`} />
        <p>
          The <code>exp &lt;= 0</code> check matters. A left shift of a <code>time.Duration</code> overflows into negative
          values after enough attempts, and <code>rand.Int63n</code> panics on a non-positive argument. A complete retry
          loop with a timeout budget, <code>Retry-After</code>, and a classifier looks like this:
        </p>
        <CodeBlock lang="go" code={`func retryable(resp *http.Response, err error) bool {
    if err != nil {
        // the caller's own deadline or cancel is final
        return !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded)
    }
    switch resp.StatusCode {
    case http.StatusTooManyRequests, http.StatusBadGateway,
        http.StatusServiceUnavailable, http.StatusGatewayTimeout:
        return true
    }
    return false
}

// doIdempotent retries a request that is safe to repeat. A request with a
// body also needs req.GetBody set so the body can be sent again.
func doIdempotent(ctx context.Context, c *http.Client, req *http.Request) (*http.Response, error) {
    const maxAttempts = 3
    for attempt := 0; ; attempt++ {
        resp, err := c.Do(req.Clone(ctx))
        if attempt == maxAttempts-1 || !retryable(resp, err) {
            return resp, err
        }
        wait := backoff(attempt, 100*time.Millisecond, 2*time.Second)
        if resp != nil {
            if s, perr := strconv.Atoi(resp.Header.Get("Retry-After")); perr == nil && s > 0 {
                wait = time.Duration(s) * time.Second
            }
        }
        // no point sleeping past the caller's deadline
        if d, ok := ctx.Deadline(); ok && time.Until(d) < wait {
            return resp, err
        }
        if resp != nil {
            io.Copy(io.Discard, resp.Body) // drain so the connection goes back to the pool
            resp.Body.Close()
        }
        select {
        case <-time.After(wait):
        case <-ctx.Done():
            return nil, ctx.Err()
        }
    }
}`} />
      </section>

      <section>
        <h2>4. Retry amplification across layers</h2>
        <p>
          This is the part most retry advice skips. A single user click passes through several layers: a browser or mobile
          SDK, an API gateway, service A, service B, and finally a database.
        </p>
        <p>
          Suppose every layer retries 3 times on failure, and the database is down. The SDK makes 3 attempts. Each one
          reaches the gateway, which makes 3 attempts to service A. Each of those makes 3 attempts to service B, and each
          of those makes 3 attempts to the database. That is <code>3 × 3 × 3 × 3 = 81</code> database calls for one click.
        </p>
        <p>
          Nobody wrote "81 retries". Each team wrote a reasonable "3 retries" in isolation, and each one was right about its
          own layer.
        </p>
        <Viz><AmplificationTree /></Viz>
        <p>
          Set every layer to 5 retries and one click becomes 1,296 database calls. Then turn on "retry only at the edge".
          The tree collapses to a straight line, and the database sees as many calls as the edge makes attempts.
        </p>
        <p>Retry layers also hide in places you did not write:</p>
        <ul>
          <li>Client SDKs and mobile apps that retry automatically.</li>
          <li>
            Load balancers and ingress: nginx's <code>proxy_next_upstream</code> tries the next upstream on{' '}
            <code>error</code> and <code>timeout</code> by default, and Envoy's route retry policy retries whatever{' '}
            <code>retry_on</code> lists.
          </li>
          <li>Service mesh sidecars, which are Envoy with a retry policy you may not have read.</li>
          <li>Your own retry loop.</li>
          <li>Database drivers and ORMs that reconnect and replay.</li>
          <li>
            Go's <code>http.Transport</code>. When a request on a reused keep-alive connection fails because the server had
            already closed it, the transport retries the request once on a new connection, if the request is idempotent.
            You never see it.
          </li>
          <li><strong>TCP itself</strong>, which the next section covers.</li>
        </ul>
        <p>
          <strong>The rule:</strong> retry at <em>one</em> layer. Usually that is the layer closest to the user-facing
          decision, or the one with the most context about whether a retry makes sense. Every layer below it should fail
          fast and pass the error up.
        </p>
      </section>

      <section>
        <h2>5. The network pays first</h2>
        <p>
          Before a retry storm melts your application, it melts the path to it. An application-level retry on a new
          connection is not one packet. It is a TCP handshake, maybe a TLS handshake, the request, and the state the kernel
          keeps after the connection closes. A retry is a SYN, a TLS handshake, a conntrack entry, and a TIME_WAIT socket.
          Multiply by 10,000 clients. <Link to="/tcp-internals">TCP from the inside</Link> covers the mechanics below in
          more depth.
        </p>

        <h3>5.1 Retries under your retries: TCP's own retransmits</h3>
        <p>
          The kernel retries on its own. A SYN that gets no answer is retransmitted with exponential backoff,{' '}
          <code>net.ipv4.tcp_syn_retries</code> times (default 6, about 127 seconds of trying). Data on an established
          connection is retransmitted up to <code>net.ipv4.tcp_retries2</code> times (default 15, roughly 15 minutes).
        </p>
        <p>
          So while your app thinks "attempt 1 is still in flight", the kernel is already sending attempt 1's packets again.
          Your app-level retries stack <strong>on top of</strong> kernel retransmits. To see them:
        </p>
        <CodeBlock lang="bash" code={`# retransmits, system-wide
nstat -az | grep -i -E 'TcpRetransSegs|TcpExtTCPSynRetrans'

# retransmit counters per socket
ss -ti`} />

        <h3>5.2 Listen backlog overflow: the server drops SYNs silently</h3>
        <p>
          When the server cannot <code>accept()</code> connections as fast as they complete their handshake, the accept
          queue fills. After that, the kernel drops new SYNs and completed handshakes. There is no RST and no error, only
          silence.
        </p>
        <p>
          The client sees a timeout and retries. That sends more SYNs, which are also dropped. It is a feedback loop, and
          the server's CPU graph can look calm the whole time because the requests never reach the process.
        </p>
        <CodeBlock lang="bash" code={`nstat -az TcpExtListenOverflows TcpExtListenDrops

# on a listening socket: Recv-Q = connections waiting to be accepted,
# Send-Q = the backlog limit. Recv-Q at or above Send-Q means the queue is full.
ss -lnt`} />
        <p>
          The limits are <code>net.core.somaxconn</code>, <code>net.ipv4.tcp_max_syn_backlog</code>, and the{' '}
          <code>backlog</code> argument to <code>listen()</code>. Go's <code>net</code> package passes the value of{' '}
          <code>somaxconn</code> as the backlog.
        </p>

        <h3>5.3 conntrack table full: the node drops everything</h3>
        <p>
          Every new connection through a NAT or through kube-proxy in iptables mode takes a conntrack entry, and that entry
          outlives the connection. A retry storm of short-lived connections fills <code>nf_conntrack_max</code>. The kernel
          logs <code>nf_conntrack: table full, dropping packet</code> and then drops new connections for <strong>all</strong>{' '}
          traffic on that node, not only the storm.
        </p>
        <p>
          This is how one misbehaving client pool takes out unrelated services that share its nodes.
        </p>
        <CodeBlock lang="bash" code={`conntrack -S                                   # look at drop= and insert_failed=
cat /proc/sys/net/netfilter/nf_conntrack_count
cat /proc/sys/net/netfilter/nf_conntrack_max
dmesg | grep conntrack`} />

        <h3>5.4 Ephemeral port exhaustion and TIME_WAIT pileup</h3>
        <p>
          Each new outbound connection to the same <code>dst_ip:dst_port</code> needs its own local port from{' '}
          <code>net.ipv4.ip_local_port_range</code> (default 32768–60999, about 28,000 ports). The side that closes first
          keeps its socket in TIME_WAIT for 60 seconds. So sustained churn above roughly 470 new connections per second to
          one destination runs out of ports, and <code>connect()</code> fails with{' '}
          <code>cannot assign requested address</code>.
        </p>
        <p>
          <strong>The Go trap:</strong> <code>http.DefaultTransport</code> keeps at most 2 idle connections per host
          (<code>DefaultMaxIdleConnsPerHost = 2</code>). Under a burst, it opens more connections than that. As each
          request finishes, it keeps 2 idle connections and closes the rest. During a retry storm, that means a new connection per
          retry and a TIME_WAIT socket after each one, at exactly the worst time.
        </p>
        <CodeBlock lang="go" code={`var client = &http.Client{
    Timeout: 2 * time.Second,
    Transport: &http.Transport{
        MaxIdleConns:        200,
        MaxIdleConnsPerHost: 100, // near your real per-host concurrency, not 2
        IdleConnTimeout:     90 * time.Second,
    },
}`} />
        <CodeBlock lang="bash" code={`ss -s                                   # summary, including timewait
ss -tan state time-wait | wc -l`} />

        <h3>5.5 TLS handshakes are CPU</h3>
        <p>
          A retry on a fresh connection is a full TLS handshake, and the server pays for the asymmetric crypto. During a
          storm, server CPU goes to handshakes, not requests. Goodput collapses while the CPU graph says "busy". Nothing in
          the request metrics explains it, because the handshakes happen before any request exists.
        </p>

        <h3>5.6 Watching it happen</h3>
        <p>
          The model below is one busy path: a few client nodes, a conntrack table, and one backend that can finish about 800
          new TLS handshakes a second. Push the request rate up with one connection per request, and watch the stages fill.
          Then turn on connection reuse.
        </p>
        <Viz><PacketPathSim /></Viz>
        <p>
          Two things are worth noticing. First, the NIC is almost never the problem. The state tables fill long before the
          wire does. Second, the first overflow makes the next one worse: every dropped SYN is retransmitted by the kernel,
          so a full accept queue multiplies the SYNs that reach conntrack. Keep-alive changes the story because 50 requests
          share one handshake, one conntrack entry, and one TIME_WAIT socket.
        </p>
        <IncidentCards />
      </section>

      <section>
        <h2>6. Timeouts and deadlines</h2>
        <p>
          <strong>A retry without a timeout is a hang. A timeout without a budget is a guess.</strong>
        </p>
        <p>
          <strong>Go trap #1:</strong> the zero value of <code>http.Client</code> has <strong>no timeout</strong>.{' '}
          <code>http.Get</code> uses <code>http.DefaultClient</code>, which is that zero value. A dependency that accepts the
          connection and never answers will hold that goroutine forever.
        </p>
        <p>
          <strong>Timeout budgets.</strong> If the user-facing limit is 2s, the gateway gets 1.8s, service A gets 1.5s, and
          service B gets 1s. Each hop leaves room for the hop above it to handle the error. If an inner timeout is longer than
          an outer one, the inner work keeps running after its caller has given up. That work is pure waste, and it is
          exactly the work that hammers the dependency during an incident.
        </p>
        <Viz><TimeoutBudgetBar /></Viz>
        <p>
          <strong>Deadline propagation.</strong> Pass the remaining budget downstream instead of starting a fresh timeout at
          every hop. In Go, that is <code>context.WithTimeout</code> on the incoming context. gRPC carries the deadline across
          the wire for you, as long as you pass the incoming context to the outgoing call. Each hop should check{' '}
          <code>ctx.Err()</code> before it starts expensive work. Do not start work whose caller is already gone.
        </p>
        <CodeBlock lang="go" code={`ctx, cancel := context.WithTimeout(parentCtx, 800*time.Millisecond)
defer cancel()
req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
resp, err := client.Do(req) // respects the caller's remaining budget`} />
        <p>
          <code>context.WithTimeout</code> never extends a deadline. If the parent has 300ms left, the child gets 300ms, not
          800ms. That is the behavior you want.
        </p>
        <p>
          <strong>Retries must fit inside the budget.</strong> Three attempts with a 1s timeout each, inside a 2s budget, is
          a lie. The third attempt can never finish. Either shorten the per-attempt timeout, or make fewer attempts.
        </p>
        <p>
          Set timeouts from <strong>observed latency</strong>, for example the p99.9 plus a margin, not from round numbers. A
          timeout far above real latency does nothing. A timeout below the p99 turns normal slow requests into retries.
        </p>
      </section>

      <section>
        <h2>7. Metastable failure: why it stays down</h2>
        <p>
          The opening incident has a name. The paper "Metastable Failures in Distributed Systems" (Bronson et al., HotOS 2021)
          describes a system that can be in a stable good state or a stable bad state. A trigger pushes it from good to bad.
          After that, the trigger can go away and the system stays bad, because a <strong>sustaining feedback loop</strong>{' '}
          keeps it overloaded.
        </p>
        <p>For retries, the loop is:</p>
        <p className="text-center font-mono text-sm">overload → slow responses → client timeouts → retries → more load → overload</p>
        <p>
          This is why it is so frightening in production. The root cause, a 40-second database failover, is long gone.
          Restarting the services does not help, because the retries live in the <em>clients</em>. Adding capacity is slow,
          and the new capacity is swamped as it arrives. It is also why the fix in the opening incident was to drop traffic
          at the edge and let it back in slowly, and not anything done to the database.
        </p>
        <Viz><MetastableLoop /></Viz>
        <p>
          The server here has 30% headroom: 100 req/s of demand against 130 req/s of capacity. That is healthy. With naive
          exponential backoff and 3 attempts, a 10-second outage leaves it at zero goodput for as long as you care to watch.
          Every attempt waits behind abandoned work, times out after 1s, and comes back as a retry. Three attempts per
          request is 300 req/s of offered load against 130 of capacity.
        </p>
        <p>
          Now try <strong>jitter only</strong>. It does not help here. Jitter fixes <em>synchronization</em>. It does nothing
          about <em>amplification</em>: if every attempt times out, three attempts is still three times the load, spread
          evenly or not. <strong>Load shedding</strong> gets the server out, because it stops wasting capacity on requests
          whose callers are gone. A <strong>retry budget</strong> gets out fastest, because it removes the multiplier at its
          source.
        </p>
        <p>Retries are not the only loop with this shape:</p>
        <ul>
          <li><strong>Cache stampede:</strong> a cache flush sends every read to the database, the database slows, the cache refills slowly, and reads keep missing.</li>
          <li><strong>GC death spiral:</strong> a growing queue raises heap use, more GC slows processing, and the queue grows faster.</li>
          <li><strong>Connection-pool churn:</strong> timeouts close pooled connections, new ones need handshakes, handshakes add latency, and more requests time out.</li>
        </ul>
      </section>

      <section>
        <h2>8. Doing it right</h2>

        <h3>8.1 Retry budgets</h3>
        <p>
          This is the most important fix in the post. Limit retries as a <strong>ratio of normal traffic</strong>, not per
          request. For example: "retries may be at most 10–20% of requests over the last N seconds."
        </p>
        <p>
          The effect is automatic. During a blip, only a few requests fail, so there is budget and retries work. During a
          real outage, many requests fail, the budget runs out, and retries stop. The multiplier from sections 4 and 7
          cannot form.
        </p>
        <p>Production systems already ship this:</p>
        <ul>
          <li>
            <strong>Envoy</strong> retry budgets: <code>budget_percent</code> limits active retries to a percentage of active
            requests (default 20%), with <code>min_retry_concurrency</code> (default 3) so low-traffic clusters can still
            retry.
          </li>
          <li>
            <strong>gRPC retry throttling</strong>: a token bucket per channel. Every failed RPC costs one token, every
            success adds back <code>tokenRatio</code>, and retries stop while the bucket is at or below half of{' '}
            <code>maxTokens</code>.
          </li>
          <li>
            <strong>AWS SDKs</strong>: the standard retry mode has a client-side retry quota. Retries spend from it,
            successes refill it, and when it is empty the SDK stops retrying.
          </li>
        </ul>
        <p>The gRPC approach is small enough to write yourself:</p>
        <CodeBlock lang="go" code={`// RetryBudget follows gRPC retry throttling: failures cost a token,
// successes earn back a fraction of one, and retries are allowed only
// while the bucket is more than half full.
type RetryBudget struct {
    mu     sync.Mutex
    tokens float64
    max    float64 // e.g. 10
    ratio  float64 // e.g. 0.1: ten successes pay for one failure
}

func NewRetryBudget(max, ratio float64) *RetryBudget {
    return &RetryBudget{tokens: max, max: max, ratio: ratio}
}

func (b *RetryBudget) OnSuccess() {
    b.mu.Lock()
    b.tokens = min(b.max, b.tokens+b.ratio)
    b.mu.Unlock()
}

func (b *RetryBudget) OnFailure() {
    b.mu.Lock()
    b.tokens = max(0, b.tokens-1)
    b.mu.Unlock()
}

func (b *RetryBudget) CanRetry() bool {
    b.mu.Lock()
    defer b.mu.Unlock()
    return b.tokens > b.max/2
}`} />
        <p>
          Share one budget per destination across the whole process, not one per request. A per-request budget is just a
          max-attempts setting.
        </p>

        <h3>8.2 Circuit breakers</h3>
        <p>
          A circuit breaker has three states. <strong>Closed</strong>: calls go through, and failures are counted.{' '}
          <strong>Open</strong>: after too many failures, calls fail at once without touching the dependency.{' '}
          <strong>Half-open</strong>: after a cool-down, a few probe calls go through. If they succeed, the breaker closes.
          If not, it opens again.
        </p>
        <p>
          A breaker stops one client from hammering a dependency it already knows is down. It works well alongside a retry
          budget: the budget limits retries, and the breaker limits first attempts too. Breakers have their own tuning
          problems, which deserve their own post.
        </p>

        <h3>8.3 Server-side load shedding</h3>
        <p>
          Clients are only half the answer, because you do not control all your clients. A server should protect itself.
          When the queue depth or the number of in-flight requests passes a limit, reject new work early with a 503 or 429
          and a <code>Retry-After</code> header.
        </p>
        <p>
          Rejecting fast is much cheaper than timing out slowly. A rejection costs microseconds and tells the client exactly
          what happened. A timeout costs a full request's worth of work that nobody reads. Also drop queued work whose
          deadline has already passed; the simulator's shedding mode does both. For a limit that adjusts itself, look at
          adaptive concurrency with AIMD, which{' '}
          <Link to="/go-vs-vector-pipeline">the Go vs. Vector pipeline post</Link> walks through.
        </p>

        <h3>8.4 Idempotency keys</h3>
        <p>
          Retries are only safe if repeating the operation is safe. <code>GET</code> is. <code>POST /payments</code>{' '}
          retried after a timeout may charge the card twice, because the first attempt may have succeeded.
        </p>
        <p>
          The fix is an idempotency key. The client generates a UUID once per logical operation and sends it on every
          attempt, as <code>Idempotency-Key: &lt;uuid&gt;</code>. The server stores the key with the result. If the same key
          arrives again, the server returns the stored result instead of doing the work again.
        </p>
        <CodeBlock lang="go" code={`func (s *Server) CreatePayment(w http.ResponseWriter, r *http.Request) {
    key := r.Header.Get("Idempotency-Key")
    if key == "" {
        http.Error(w, "Idempotency-Key required", http.StatusBadRequest)
        return
    }
    // Reserve atomically. A second attempt with the same key gets the
    // stored result, or 409 while the first attempt is still running.
    res, fresh, err := s.store.Reserve(r.Context(), key)
    if err != nil {
        http.Error(w, "try again", http.StatusServiceUnavailable)
        return
    }
    if !fresh {
        if res.Pending {
            http.Error(w, "in progress", http.StatusConflict)
            return
        }
        writeResult(w, res)
        return
    }
    res = s.charge(r)            // the side effect happens once per key
    s.store.Complete(key, res)   // keep it for longer than any client retries
    writeResult(w, res)
}`} />
        <p>
          One more Go detail: <code>http.Transport</code> treats a request that carries an <code>Idempotency-Key</code> or{' '}
          <code>X-Idempotency-Key</code> header as idempotent, even a <code>POST</code>, so it may retry it on the
          reused-connection error from section 4. With a key and a server that honors it, that retry is harmless.
        </p>

        <h3>8.5 The checklist</h3>
        <Checklist />

        <h3>8.6 The same incident, twice</h3>
        <p>
          Here is the opening incident replayed through the same model: 100 req/s of demand, 130 req/s of capacity, a
          40-second failover. The left run uses exponential backoff with no jitter and no budget. The right run uses jitter,
          a retry budget, and load shedding. Same seed, same traffic.
        </p>
        <Viz><BeforeAfterDashboard /></Viz>
        <p>
          On the right, goodput is back a few seconds after the failover ends. On the left, the failover ends and
          nothing changes. The graph never recovers on its own. In real life, someone ends up blocking traffic at the edge
          at 03:30.
        </p>
      </section>

      <section>
        <h2>The takeaway</h2>
        <p>
          A retry is a bet that the failure was a blip. That bet is usually right, which is why retries are everywhere. But
          every retry loop is also a load multiplier that turns on during failures, which is exactly when the system has the
          least room for extra load.
        </p>
        <p>
          So retry at one layer. Add jitter. Fit your attempts inside a deadline. And put a budget on the whole thing, so
          that when the bet is wrong, your clients stop making it.
        </p>
        <hr />
        <p>
          Related: <Link to="/tcp-internals">TCP from the inside</Link> covers retransmission, the handshake, and TIME_WAIT,
          which section 5 relies on. <Link to="/go-vs-vector-pipeline">We diffed our pipeline against Vector's source</Link>{' '}
          covers adaptive concurrency, the server-side cousin of a retry budget.{' '}
          <Link to="/go-channels-internals">Go channels: what's actually inside hchan</Link> covers the semaphores that
          usually cap concurrency inside a Go service.
        </p>
      </section>
    </article>
  )
}
