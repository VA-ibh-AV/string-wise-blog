import { lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import PostHeader from '../../components/PostHeader'
import CodeBlock from '../../components/CodeBlock'

const FDChurnSim          = lazy(() => import('./FDChurnSim'))
const ScrapeIntervalSim   = lazy(() => import('./ScrapeIntervalSim'))
const EncodingCompare     = lazy(() => import('./EncodingCompare'))
const GCTraceSim          = lazy(() => import('./GCTraceSim'))
const HeapRSSSim          = lazy(() => import('./HeapRSSSim'))
const GoroutineConcurrency = lazy(() => import('./GoroutineConcurrency'))
const SummaryDashboard    = lazy(() => import('./SummaryDashboard'))

function VisualizerFallback() {
  return <div className="viz-card viz-loading" aria-label="Loading interactive visualizer">loading interactive visualizer…</div>
}

export default function MonitoringAgentInternals() {
  return (
    <article className="article-shell prose prose-neutral mx-auto">
      <PostHeader
        title="The anatomy of a lightweight monitoring agent's performance"
        date="2026-09-05"
        tags={['performance', 'go', 'observability', 'internals']}
        readingTime="24 min"
      />

      <section>
        <h2>The thing that watches everything else was showing up on its own dashboard</h2>
        <p>
          A lightweight agent runs on every host in the fleet. Its whole job is to be invisible — scrape a few metrics, ship them
          somewhere, use as little CPU and memory as the host it's watching can spare. Someone notices the agent's own steady-state
          CPU baseline is higher than it should be. Not a spike. Not a leak with a clean upward slope you can point at. Just a
          floor that sits a few points higher than the same agent on a similar fleet a year ago.
        </p>
        <p>
          First hypothesis: something got slower in the last release — a new metric, a heavier query, a serialization change nobody
          benchmarked. Tempting, because it's a single thing to find and revert. It's also wrong. Profiling the hot path shows
          nothing dramatic — no function eating 40% of samples, no obvious regression. The CPU is going somewhere, just not
          anywhere a flame graph makes look interesting.
        </p>
        <p>
          The diagnostic path that actually worked didn't start with a profiler. It started with <code>/proc</code> — descriptor
          counts, syscall rates, the kernel's own view of what the process is doing per second. Each answer opened a question one
          layer further down: descriptor counts led to syscall rates, syscall rates led to what those syscalls were parsing, parsing
          led to allocation rate, allocation rate led to GC frequency, GC frequency led to what the memory graphs actually meant, and
          memory graphs led to how many goroutines were alive at any given moment. Seven costs. None of them individually explained
          the gap. Together, they were the whole gap.
        </p>
        <p>
          This is the same habit of going one layer deeper that showed up tracing bytes through the kernel in{' '}
          <Link to="/tcp-internals">TCP from the inside</Link> — except this time the "wire" is <code>/proc</code>, and the
          thing you're debugging is your own observability tooling.
        </p>
      </section>

      <section>
        <h2>Part 1: file descriptor churn — the graph that lies by omission</h2>
        <p>
          A scraper reads a handful of files every tick: <code>/proc/stat</code> for global CPU, <code>/proc/[pid]/stat</code> for
          per-process numbers, <code>/proc/net/dev</code> for interface counters, maybe a couple of log files it tails. The naive
          version opens each file, reads it, closes it — every single tick. The efficient version opens once and reuses the
          descriptor. Both look identical on an FD-count graph, because in neither case does the descriptor count actually grow.
        </p>
        <p>
          The cost isn't a rising number anywhere obvious. It's the syscall rate. Every <code>open()</code> and every{' '}
          <code>close()</code> is a context switch into the kernel — cheap in isolation, expensive at scrape-interval frequency
          across an entire fleet. <code>lsof -p PID</code> and <code>ls -la /proc/[pid]/fd | wc -l</code> both report a perfectly
          steady descriptor count. Neither tool sees the churn.
        </p>
        <CodeBlock lang="bash" code={`# descriptor count alone won't show churn — it looks the same either way
ls -la /proc/$PID/fd | wc -l

# this is the tool that actually reveals it
strace -c -p $PID
# % time     seconds  usecs/call     calls    syscall
# ------ ----------- ----------- --------- ----------------
#  41.2%    0.008812           4      2160  open
#  33.7%    0.007211           3      2160  close
#  19.8%    0.004230           2      2160  read
#   5.3%    0.001134           1       180  epoll_wait`} />
        <p>
          Play with the visualizer below. Watch the FD-count graph stay perfectly flat for both <strong>pooled</strong> and{' '}
          <strong>churn</strong> — then look at the syscalls-this-tick number. That's the whole point: FD count alone can't
          distinguish churn from a healthy steady state. Only the syscall rate can. And a genuine <strong>leak</strong> looks
          different from both — the descriptor count itself climbs, because nothing ever calls <code>close()</code> at all.
        </p>
        <Suspense fallback={<VisualizerFallback />}><FDChurnSim /></Suspense>
        <p>
          The fix was the boring one: hold descriptors open across ticks, reuse connections instead of dialing fresh ones, and
          reserve <code>strace -c</code> for confirming it actually worked — the syscall counts dropped by roughly the ratio of
          scrape interval to file count, exactly as the math predicted.
        </p>
      </section>

      <section>
        <h2>Part 2: /proc scraping overhead — freshness has a CPU price</h2>
        <p>
          Even with descriptors pooled, every scrape still does small reads and string parsing — <code>/proc/stat</code>'s
          space-separated CPU jiffies, <code>/proc/net/dev</code>'s fixed-width columns, a handful of files per tick, multiplied
          by however many hosts run the agent. None of it is expensive once. All of it is expensive at a one-second interval,
          all day, on every host.
        </p>
        <p>
          The tradeoff is explicit: a shorter interval means fresher data and more syscalls per second; a longer interval means
          less CPU and staler data by up to half the interval, on average. There usually isn't one right answer for the whole
          agent — a metric feeding an alert that pages someone needs to be fresh; a static host label read once and cached needs
          to be read once, ever, not every tick.
        </p>
        <p>
          Move the slider below. The curve is a plain 1/interval relationship, but it's worth seeing where it flattens: below
          roughly 300ms the syscall floor alone becomes a measurable CPU cost, and above a few seconds the freshness loss starts
          to matter more than the CPU it's saving.
        </p>
        <Suspense fallback={<VisualizerFallback />}><ScrapeIntervalSim /></Suspense>
        <p>
          The practical mitigations, in order of how much they helped: batch reads that share a tick into one pass instead of
          one syscall round-trip per metric, cache anything that changes slower than the interval (hostname, kernel version,
          mount points), and give each metric its own interval instead of one global tick for everything.
        </p>
      </section>

      <section>
        <h2>Part 3: serialization — where JSON actually costs you</h2>
        <p>
          The agent ships metrics somewhere, and the wire format was JSON — readable, ubiquitous, easy to <code>curl | jq</code>{' '}
          when something looks wrong. None of that is free. JSON encoding in most languages goes through reflection to walk struct
          fields, allocates strings for every key and every escaped character, and re-parses numbers as text on the way back in.
          A "small payload" stops being small once you multiply its encode/decode cost by scrape frequency times fleet size.
        </p>
        <p>
          MessagePack is the same conceptual model — maps, arrays, integers, strings — with no text parsing and no escaping.
          Same data, binary wire format, smaller and cheaper to produce. There are three separate wins here, worth measuring
          separately rather than as one blended number: CPU time to encode/decode, bytes on the wire, and — the one that matters
          most for Part 4 — how many intermediate allocations each encoding produces.
        </p>
        <CodeBlock lang="go" code={`func BenchmarkEncodeJSON(b *testing.B) {
    m := sampleMetric()
    for i := 0; i < b.N; i++ {
        _, _ = json.Marshal(m)
    }
}

func BenchmarkEncodeMsgPack(b *testing.B) {
    m := sampleMetric()
    for i := 0; i < b.N; i++ {
        _, _ = msgpack.Marshal(m)
    }
}

// go test -bench=Encode -benchmem
// BenchmarkEncodeJSON-8      421339      2840 ns/op     512 B/op      9 allocs/op
// BenchmarkEncodeMsgPack-8  2938451       410 ns/op      64 B/op      1 allocs/op`} />
        <p>
          Toggle between a flat payload and a nested one below — the gap widens as the struct grows, because reflection cost and
          allocation count both scale with field count while the binary encoder's cost scales with byte count.
        </p>
        <Suspense fallback={<VisualizerFallback />}><EncodingCompare /></Suspense>
        <p>
          The honest tradeoff: MessagePack payloads aren't human-readable, so debugging drops to a decoder tool instead of{' '}
          <code>curl | jq</code>, and schema evolution needs more care since there's no field name embedded in the wire format
          to fall back on if a decoder gets out of sync with an encoder. Worth it for a payload sent thousands of times a second
          across a fleet; probably not worth it for a config file a human edits by hand.
        </p>
      </section>

      <section>
        <h2>Part 4: GC pressure — the agent measures its own noise</h2>
        <p>
          GC pauses matter more for an agent than for a typical request/response service, for an uncomfortable reason: the agent
          is often the thing measuring the very latency and CPU numbers its own pauses pollute. A GC pause that stalls the
          scraper for a few hundred microseconds shows up as a gap or a spike in exactly the data meant to catch gaps and spikes
          elsewhere.
        </p>
        <p>
          The misconception worth killing early: heap <em>size</em> is not what drives GC frequency. Allocation <em>rate</em> is.
          Go's default GC target (<code>GOGC=100</code>) triggers a collection when the live heap has doubled since the last one —
          a process with a small, completely stable live heap can still GC constantly if it allocates and discards garbage fast
          enough to keep hitting that doubling point.
        </p>
        <CodeBlock lang="bash" code={`GODEBUG=gctrace=1 ./agent
# gc 142 @6.011s 2%: 0.019+1.8+0.006 ms clock, 0.15+0.41/1.6/3.2+0.048 ms cpu,
#     24->26->13 MB, 26 MB goal, 8 P
#
# gc 142            — the 142nd GC cycle since start
# @6.011s           — 6 seconds since process start
# 2%                — cumulative % of CPU time spent in GC so far
# 0.019+1.8+0.006 ms — stop-the-world sweep termination + concurrent mark + STW mark termination
# 24->26->13 MB      — heap size before GC -> at GC finish -> live set after GC
# 26 MB goal          — the doubling target that triggered this cycle
# 8 P                 — GOMAXPROCS`} />
        <p>
          <code>runtime.ReadMemStats</code> gives the same story in code — <code>NumGC</code>, <code>PauseTotalNs</code>,{' '}
          <code>Mallocs</code>/<code>Frees</code> — and a <code>pprof</code> heap profile separates two different questions that
          are easy to conflate: <code>alloc_objects</code> (how many things are being allocated — usually the GC-frequency
          question) versus <code>alloc_space</code> (how many bytes — usually the "why did RSS jump" question).
        </p>
        <p>
          Toggle between the before and after allocation rates from Part 3 below — same base live heap in both cases, only the
          allocation rate changes, and GC frequency moves with it.
        </p>
        <Suspense fallback={<VisualizerFallback />}><GCTraceSim /></Suspense>
        <p>
          This is the payoff that ties Part 3 to Part 4: switching from JSON to MessagePack wasn't just a CPU and payload-size
          win. It cut the allocation rate, and cutting the allocation rate cut GC frequency directly. One fix, three metrics
          moved together.
        </p>
      </section>

      <section>
        <h2>Part 5: memory and heap behavior — sawtooth vs staircase</h2>
        <p>
          Two numbers that look like they should agree often don't: <code>VmRSS</code> from <code>/proc/[pid]/status</code>, and
          the heap-in-use number <code>pprof</code> reports. RSS can sit well above what <code>pprof</code> says is live, and
          that's not automatically a bug — Go's runtime doesn't return freed pages to the OS immediately, so RSS tends to track
          the historical peak rather than the current heap.
        </p>
        <p>
          The pattern that matters is the shape, not the gap. A heap that oscillates between the same floor and ceiling every GC
          cycle — a sawtooth — means the live set isn't growing; RSS holding flat slightly above the ceiling is exactly what's
          expected. A heap whose post-GC floor itself keeps rising every cycle — a staircase — means something is retaining
          references the live set doesn't need: an unbounded cache, a slice that only ever appends, goroutines that never exit
          and never release what they're holding.
        </p>
        <Suspense fallback={<VisualizerFallback />}><HeapRSSSim /></Suspense>
        <p>
          The single best tool for turning "the staircase is real" into "here's what's causing it" is a <code>pprof</code> heap
          diff between two points in time:
        </p>
        <CodeBlock lang="bash" code={`curl -s localhost:6060/debug/pprof/heap > heap.0.pprof
sleep 300
curl -s localhost:6060/debug/pprof/heap > heap.1.pprof

go tool pprof -top -base heap.0.pprof heap.1.pprof
# Shows only what grew between the two snapshots — not the whole heap,
# just the delta. This is almost always faster than reading the whole
# profile and guessing.`} />
      </section>

      <section>
        <h2>Part 6: goroutines vs buffers — concurrency design, not a speed fix</h2>
        <p>
          Goroutine count is a leading indicator worth watching on its own: unbounded growth — one goroutine per connection, one
          per file watched, one per incoming request with no cap — shows up as scheduler overhead and memory growth well before
          it shows up as a crash. <code>runtime.NumGoroutine()</code> tracked over time catches this long before an OOM does.
        </p>
        <p>
          A buffered channel is backpressure, not a speed fix. An oversized buffer doesn't solve a slow-consumer problem — it
          hides it, turning a throughput mismatch into silent memory growth instead of a visible signal. Three designs, same
          load:
        </p>
        <ul>
          <li><strong>Unbounded buffer</strong> — memory grows silently, nothing fails until it's too late to fail gracefully.</li>
          <li><strong>Bounded buffer with an explicit drop or block policy</strong> — backpressure becomes visible: a full queue,
            a dropped-item counter, something you can alert on.</li>
          <li><strong>Worker pool</strong> — concurrency itself is bounded; excess work queues (bounded) or blocks, but the
            goroutine count has a ceiling regardless of load.</li>
        </ul>
        <CodeBlock lang="go" code={`// unbounded: one goroutine per connection, no ceiling
for conn := range incoming {
    go handle(conn) // under sustained overload this count never stops climbing
}

// worker pool: concurrency capped, backpressure explicit
jobs := make(chan Conn, queueCap) // bounded — a full channel is a decision point, not silent growth
for i := 0; i < poolSize; i++ {
    go func() {
        for conn := range jobs {
            handle(conn)
        }
    }()
}
for conn := range incoming {
    select {
    case jobs <- conn:
    default:
        droppedCounter.Inc() // explicit, visible, alertable — not a memory leak in disguise
    }
}`} />
        <p>
          Play with the incoming-load slider below and switch designs. <code>pprof</code>'s goroutine profile shows{' '}
          <em>where</em> goroutines are stuck — blocked on a channel send, a mutex, or I/O — and{' '}
          <code>GODEBUG=schedtrace=1000</code> gives scheduler-level visibility (runnable goroutines per P, how often the
          scheduler is stealing work) when the goroutine count alone doesn't explain the CPU cost.
        </p>
        <Suspense fallback={<VisualizerFallback />}><GoroutineConcurrency /></Suspense>
      </section>

      <section>
        <h2>Part 7: putting it together</h2>
        <p>
          None of these six costs was individually dramatic. FD churn cost a few thousand extra syscalls a second. The scrape
          interval cost a fraction of a percent of CPU. JSON cost some allocations. Those allocations cost some extra GC cycles.
          The GC cycles and an unbounded worker design cost some extra memory. Stacked on every host in the fleet, all day,
          that's the floor that came back down.
        </p>
        <Suspense fallback={<VisualizerFallback />}><SummaryDashboard /></Suspense>
        <p>
          What stayed in place afterward, specifically so this doesn't quietly reappear: <code>strace -c</code> in the release
          checklist for anything touching the scrape loop, an alert on allocation rate (not just heap size) so a regression in
          Part 3 gets caught before it becomes a Part 4 problem, and a goroutine-count alert with a threshold set to the worker
          pool's ceiling — any sustained excess past that number means the bounded design stopped being bounded somewhere.
        </p>
        <p>
          The agent went back to being invisible. That was always the actual spec.
        </p>
        <hr />
        <p>
          Related: one layer further down the stack, <Link to="/tcp-internals">TCP from the inside</Link> walks the same kind of
          investigation through <code>sk_buff</code>s and the kernel's send/receive path — different failure domain, same habit
          of going one layer deeper each time the first answer doesn't fully explain the symptom. Also:{' '}
          <Link to="/kafka-internals">Kafka beyond the basics</Link> and{' '}
          <Link to="/postgres-internals">PostgreSQL storage internals</Link> for what the systems the agent is watching are
          doing on their own side of the wire.
        </p>
      </section>
    </article>
  )
}
