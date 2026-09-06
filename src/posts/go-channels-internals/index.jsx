import { lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import PostHeader from '../../components/PostHeader'
import CodeBlock from '../../components/CodeBlock'

const HchanRingBuffer          = lazy(() => import('./HchanRingBuffer'))
const ParkWakeQueue            = lazy(() => import('./ParkWakeQueue'))
const HandoffVsBuffered        = lazy(() => import('./HandoffVsBuffered'))
const SelectFiring             = lazy(() => import('./SelectFiring'))
const LatencyGoroutineSim      = lazy(() => import('./LatencyGoroutineSim'))
const HeapGoroutineCorrelation = lazy(() => import('./HeapGoroutineCorrelation'))
const CPUSpinSim               = lazy(() => import('./CPUSpinSim'))
const SemaphoreSizingSim       = lazy(() => import('./SemaphoreSizingSim'))
const EventQueueDropSim        = lazy(() => import('./EventQueueDropSim'))

function VisualizerFallback() {
  return <div className="viz-card viz-loading" aria-label="Loading interactive visualizer">loading interactive visualizer…</div>
}

export default function GoChannelsInternals() {
  return (
    <article className="article-shell prose prose-neutral mx-auto">
      <PostHeader
        title="Go channels: what's actually inside hchan"
        date="2026-09-13"
        tags={['go', 'concurrency', 'internals', 'production']}
        readingTime="28 min"
      />

      <section>
        <h2>Every Go developer has written <code>ch &lt;- v</code>. Almost none have seen what's on the other side of the arrow.</h2>
        <p>
          You write <code>ch &lt;- v</code> and somewhere, somehow, another goroutine wakes up and gets <code>v</code>. It feels
          like magic because the language hides the machinery on purpose — a channel is a value, not an object with visible
          internals, and <code>make(chan int)</code> gives you back nothing you can inspect. But there is a real struct behind
          every channel, and it's not exotic: a slice-shaped ring buffer, two wait queues, and a lock.
        </p>
        <p>
          This post opens that struct — <code>hchan</code>, from <code>runtime/chan.go</code> — field by field, then uses it to
          explain (and fix) bugs that have actually taken down production systems: leaked goroutines, deadlocked worker pools, a
          panic from a race to <code>close()</code>, a <code>select{'{'}default:{'}'}</code> loop quietly burning a full CPU
          core, and a couple of scars specific to pushing events through channels under load. Every bug here is one that pages
          someone at 3am, not one built to prove a concept.
        </p>
        <p>
          Start with the struct itself.
        </p>
      </section>

      <section>
        <h2>Part 1: the <code>hchan</code> struct, field by field</h2>
        <p>
          Simplified from <code>runtime/chan.go</code> — exact field order shifts slightly between Go versions, but these nine
          fields are the ones that have been stable for years and the ones every send, receive, and close touches:
        </p>
        <CodeBlock lang="go" code={`type hchan struct {
    qcount   uint           // current number of elements in buf
    dataqsiz uint           // size of the circular buffer (0 for unbuffered)
    buf      unsafe.Pointer // ring buffer of dataqsiz elements, nil if dataqsiz==0
    elemsize uint16         // size of one element, so buf can be indexed without generics
    elemtype *_type         // element's type, so the GC knows how to scan buf

    closed uint32           // 0 = open, nonzero = closed
    sendx  uint             // send index — next slot chansend() writes to
    recvx  uint             // receive index — next slot chanrecv() reads from

    recvq waitq             // FIFO queue of goroutines parked waiting to receive
    sendq waitq             // FIFO queue of goroutines parked waiting to send

    lock mutex              // guards every field above — channels are not lock-free
}`} />
        <p>
          Nothing about a channel is lock-free. Every operation — send, receive, close, even <code>len()</code> and{' '}
          <code>cap()</code> — takes <code>hchan.lock</code> first. That's a deliberate simplicity trade: channels are meant to
          be a correct, general-purpose coordination primitive, not the fastest possible queue. If you need lock-free, you
          reach for <code>atomic</code> or <code>sync/atomic</code>-backed structures instead — a channel's job is to make
          concurrent code easy to reason about, not to win a microbenchmark.
        </p>
        <p>
          <code>buf</code> is a plain ring buffer: <code>dataqsiz</code> slots, <code>sendx</code> and <code>recvx</code> as
          cursors that wrap around with modulo arithmetic, and <code>qcount</code> as the one field that tells you how full it
          is — you can't derive fullness from <code>sendx</code> and <code>recvx</code> alone, since <code>sendx == recvx</code>{' '}
          means either completely empty or completely full depending on which operation last ran. An unbuffered channel
          (<code>make(chan T)</code>) has <code>dataqsiz == 0</code> and <code>buf == nil</code> — there's no ring at all, which
          is the whole reason unbuffered sends and receives behave so differently from buffered ones (Part 3).
        </p>
        <p>
          Play with the buffer below. Send and receive drive <code>sendx</code>, <code>recvx</code>, and <code>qcount</code>{' '}
          directly — watch what happens when the buffer fills, and when you try to receive from an empty one.
        </p>
        <Suspense fallback={<VisualizerFallback />}><HchanRingBuffer /></Suspense>
      </section>

      <section>
        <h2>Part 2: the send/receive state machine — fast path vs. slow path</h2>
        <p>
          Every <code>chansend</code> and <code>chanrecv</code> call is really two code paths wearing one syntax. The fast path
          runs when the operation can complete immediately — a buffer with room to send into, or data already there to receive
          — and it never touches the scheduler at all: lock, copy, update the cursor, unlock, return. The slow path runs when
          it can't: the calling goroutine has to stop running until some other goroutine makes progress possible.
        </p>
        <p>
          That "stop running" step is where <code>sudog</code> comes in. A <code>sudog</code> ("pseudo-g") is a small struct
          that represents one goroutine's participation in one blocking operation — not the goroutine itself, but a ticket for
          it, since the same goroutine can be waiting in a <code>select</code> across several channels at once (Part 4) and
          each one needs its own ticket:
        </p>
        <CodeBlock lang="go" code={`type sudog struct {
    g    *g             // the parked goroutine
    next *sudog         // FIFO links within the wait queue
    prev *sudog
    elem unsafe.Pointer // points at the value being sent, or where a receive should copy to
    c    *hchan         // the channel this sudog is queued on

    // select support: several of these can exist for one goroutine at once,
    // one per case, until the first one to fire cancels the rest
    isSelect bool
}`} />
        <p>
          A blocked sender's <code>sudog.elem</code> points at the value on its own stack — nothing gets copied into the
          channel at all when a receiver is already waiting. The receiver's <code>chanrecv</code> copies directly out of the
          sender's stack into its own, wakes the sender with <code>goready()</code>, and both goroutines carry on. No buffer,
          no double copy. This is the mechanism the runtime actually prefers: <code>chansend</code> checks{' '}
          <code>recvq</code> for a waiting receiver <em>before</em> it checks whether the buffer has room, because if a receiver
          is already parked, the buffer must be empty — there'd have been no reason for it to park otherwise.
        </p>
        <p>
          Watch a goroutine take the fast path when there's room, and the slow path — wrapped in a <code>sudog</code>, parked,
          waiting for <code>goready()</code> — when there isn't.
        </p>
        <Suspense fallback={<VisualizerFallback />}><ParkWakeQueue /></Suspense>
      </section>

      <section>
        <h2>Part 3: unbuffered vs. buffered — what actually changes</h2>
        <p>
          An unbuffered channel (<code>dataqsiz == 0</code>) can never take the buffered fast path, because there's no buffer to
          have room. Every single send either finds a receiver already parked (direct handoff) or parks itself and waits for
          one to show up — and symmetrically for receive. This is why an unbuffered channel is often called a{' '}
          <strong>rendezvous</strong>: the send doesn't complete until the receive does, at the same instant, on two different
          goroutines. There is no moment where the value exists anywhere except mid-transfer from one stack to another.
        </p>
        <p>
          A buffered channel decouples that, right up until the buffer fills. <code>ch &lt;- v</code> on a channel with room
          just copies into <code>buf[sendx]</code> and returns — the sender doesn't need a receiver to exist yet, doesn't need
          to know when one will show up, and doesn't block the scheduler waiting to find out. That's a real design lever:
          buffering trades a guarantee (the receiver has definitely seen this value by the time send returns) for throughput
          (the sender doesn't stall on every call). Neither is more "correct" — they're different contracts, and picking the
          wrong one is where scenario 7.8 later in this post comes from.
        </p>
        <p>
          Drive the same send/receive pair against both kinds of channel at once and watch where they diverge — and where a
          buffered channel starts behaving exactly like an unbuffered one, the moment it fills.
        </p>
        <Suspense fallback={<VisualizerFallback />}><HandoffVsBuffered /></Suspense>
      </section>

      <section>
        <h2>Part 4: <code>select</code> internals</h2>
        <p>
          <code>select</code> doesn't check its cases in source order and doesn't check them in a loop with a small sleep
          between attempts. <code>selectgo()</code> builds a poll order over every non-nil case in the statement, shuffles it,
          and walks it once looking for anything already ready. If more than one case is ready at the same instant, it picks
          pseudo-randomly among the ready ones — deliberately, so that a <code>select</code> with two channels that are both
          always busy doesn't starve whichever one happens to come second in the source.
        </p>
        <p>
          A <strong>nil channel case is not polled at all</strong> — it isn't added to the poll order, so it's never "checked
          and found not ready." It's simply skipped, forever, unless something reassigns that channel variable to a non-nil one
          later. That's a real, intentional pattern for disabling a <code>select</code> case at runtime (set the channel
          variable to <code>nil</code> and its case stops competing), and it's also a classic bug when a channel is nil by
          accident — the branch doesn't error, doesn't panic, doesn't spin. It just never fires, silently, and a whole workflow
          path goes quiet. More on that failure mode in scenario 7.6.
        </p>
        <p>
          If nothing is ready and there's a <code>default:</code> case, that fires immediately — no parking, no scheduler
          involvement, which is exactly the mechanism scenario 7.4 turns into a CPU problem when it's called in a loop with
          nothing to slow it down. If nothing is ready and there's no <code>default:</code>, the goroutine parks with one{' '}
          <code>sudog</code> per case, on every channel simultaneously — whichever one becomes ready first wakes the goroutine
          and the runtime dequeues the now-useless <code>sudog</code>s it queued on all the other channels.
        </p>
        <p>
          Toggle which channels are ready, include or drop the <code>default:</code> case, and turn the third case's channel
          nil to see it silently drop out of the poll.
        </p>
        <Suspense fallback={<VisualizerFallback />}><SelectFiring /></Suspense>
      </section>

      <section>
        <h2>Part 5: close semantics and the two panics</h2>
        <p>
          <code>close(ch)</code> takes the lock, sets <code>closed = 1</code>, and then walks both <code>sendq</code> and{' '}
          <code>recvq</code> waking every parked <code>sudog</code> on both — all at once, not one at a time as goroutines get
          scheduled. Parked senders wake into a panic, because a closed channel accepting a send is exactly the bug{' '}
          <code>close</code> exists to make detectable. Parked receivers wake with the zero value and <code>ok == false</code>.
          Anything still sitting in <code>buf</code> at close time is <em>not</em> discarded — receives continue to drain it
          normally, returning <code>ok == true</code> for each buffered value, until the buffer is empty, after which every
          further receive returns the zero value with <code>ok == false</code> immediately and never blocks again.
        </p>
        <p>
          That asymmetry — send-on-closed panics, receive-on-closed doesn't — isn't an inconsistency, it's the same design
          decision seen from both ends. A send on a closed channel almost always means a logic bug: something still believes
          it owns the right to write, and it doesn't. A receive on a closed channel is the *normal, designed* way a consumer
          finds out there's nothing left coming — every <code>for v := range ch</code> loop relies on it to exit cleanly.
          Panicking there would make the single most common consumer pattern in the language unsafe to use.
        </p>
        <CodeBlock lang="go" code={`ch := make(chan int, 2)
ch <- 1
ch <- 2
close(ch)

v, ok := <-ch // 1, true  — buffered value, drained normally
v, ok  = <-ch // 2, true  — last buffered value
v, ok  = <-ch // 0, false — buffer empty, channel closed: never blocks, ever again

ch <- 3 // panic: send on closed channel
close(ch) // panic: close of closed channel`} />
        <p>
          Double-close panics for the same reason send-on-closed does: <code>closechan()</code> checks{' '}
          <code>c.closed</code> under the lock before doing anything else, and a second call means two goroutines both believe
          they're the one responsible for shutting the channel down — which is a design bug worth surfacing loudly, not a
          runtime nicety. Scenario 7.5 is exactly this, arriving from a race instead of a straight-line mistake.
        </p>
      </section>

      <section>
        <h2>Part 6: GC interaction</h2>
        <p>
          <code>hchan.elemtype</code> exists specifically so the garbage collector knows how to scan <code>buf</code>. If a
          channel's element type contains pointers, the GC has to treat every occupied slot in <code>buf</code> as a set of
          roots — it can't skip the buffer just because it "looks like" opaque bytes. A channel of pointers or pointer-containing
          structs keeps every unreceived value alive for as long as it sits in the buffer, which is a second, quieter version of
          the same leak pattern that runs through this post's incident scenarios: something reachable through a channel that
          nobody drains stays reachable, and stays uncollected, indefinitely.
        </p>
        <p>
          <code>chan struct{'{}'}</code> is the cheapest possible signal for the opposite reason: <code>struct{'{}'}</code>{' '}
          has zero size, so <code>elemsize == 0</code>, <code>buf</code> holds nothing the GC needs to walk, and the channel
          carries no payload to keep alive — it's pure synchronization, no data. That's exactly why semaphores and "done"
          signals are idiomatically built on <code>chan struct{'{}'}</code> rather than <code>chan bool</code>: the bool costs
          a byte and communicates a payload nobody reads, where the empty struct costs nothing and says only "this happened."
        </p>
      </section>

      <section>
        <h2>Part 7: eleven bugs that have actually paged someone</h2>
        <p>
          Everything above is mechanism. This is where it earns its keep. For each scenario: a minimal repro, the symptom as it
          actually shows up (a dashboard, a <code>pprof</code> profile, a panic trace), the root cause traced back to a specific{' '}
          <code>hchan</code> field or behavior above, and the fix. The first two are written as incident narratives on purpose —
          that's the actual shape of finding this stuff in production, not a unit test that already knows what's wrong.
        </p>

        <h3>7.0 — The 2am page: p99 jumps 10x, nobody deployed anything</h3>
        <p>
          The alert fires on request latency. p99 goes from 4ms to 400ms in about ninety seconds. Nobody shipped anything in
          the last six hours. CPU is flat, the database is bored — the same shape of red herring as a TCP{' '}
          <code>TIME_WAIT</code> exhaustion page, different layer entirely.
        </p>
        <p>
          Tracing a slow request shows it isn't slow in handler logic. Every span in the handler completes in under a
          millisecond; the time is spent after the handler returns, waiting to send its result on a channel to a worker pool.
          A goroutine profile confirms it: hundreds of goroutines sitting in <code>runtime.chansend</code>, all blocked on the
          same channel. Following that channel back to its one consumer shows the consumer goroutine died three hours earlier
          — an unhandled panic in a code path nobody exercises often, recovered by a top-level <code>recover()</code> that
          logged it and moved on without noticing the goroutine reading from the result channel was gone for good.
        </p>
        <p>
          Once that one goroutine stopped calling <code>chanrecv</code>, every subsequent sender found <code>recvq</code>{' '}
          permanently empty and the buffer permanently full, and joined <code>sendq</code>. The backlog didn't show up as
          errors — sends don't time out on their own — it showed up as every request taking however long its predecessor in
          the queue took, compounding.
        </p>
        <Suspense fallback={<VisualizerFallback />}><LatencyGoroutineSim /></Suspense>
        <p>
          The fix that actually mattered wasn't the specific panic — it was giving the send a way out:{' '}
          <code>context</code> deadline on the send, and a supervisor that restarts a dead consumer instead of letting its
          absence surface three hours later as a latency graph.
        </p>
        <CodeBlock lang="go" code={`select {
case results <- v:
case <-ctx.Done():
    return ctx.Err() // never park in sendq forever just because the consumer vanished
}`} />

        <h3>7.1 — Heap alert: RSS climbing, GC not reclaiming</h3>
        <p>
          A memory alert fires. <code>pprof</code>'s heap profile is unremarkable — <code>alloc_objects</code> hasn't moved,
          nothing is allocating faster than it did last week. The graph everyone reaches for first says nothing is wrong, and
          RSS keeps climbing anyway.
        </p>
        <p>
          The move that finds it is putting the heap profile next to the goroutine profile instead of reading either alone.
          Goroutine count has been climbing at almost exactly the same slope as RSS since the alert window started. Each of
          those goroutines is parked in <code>chansend</code> or <code>chanrecv</code>, and each one is still holding whatever
          it was about to send — a request context, a response buffer, a closure capturing a few kilobytes of state. None of
          that is "allocation" in the sense a heap profile flags, because the allocation happened normally, once, a while ago.
          What's abnormal is that it's never freed, because the goroutine holding the reference never returns.
        </p>
        <Suspense fallback={<VisualizerFallback />}><HeapGoroutineCorrelation /></Suspense>
        <p>
          The diagnostic habit worth keeping from this one: an allocation-rate alert and a goroutine-count alert are watching
          two different failure modes, and a leak that comes from parked goroutines will not trip the first one. Alert on both.
        </p>

        <h3>7.2 — Goroutine leak via abandoned send</h3>
        <p>
          A worker computes a result and sends it back on an unbuffered channel. The caller that spawned it hit a timeout or an
          early-return error path and stopped reading. The worker's send has nobody left to hand off to — it parks on{' '}
          <code>sendq</code> forever, along with everything it's holding, and <code>runtime.NumGoroutine()</code> only ever
          goes up.
        </p>
        <CodeBlock lang="go" code={`// leaks: if the caller returns early, this goroutine parks in chansend forever
func doWork(input Input) <-chan Result {
    out := make(chan Result) // unbuffered
    go func() {
        out <- compute(input) // nobody may ever receive this
    }()
    return out
}

// fixed: give the send a way out
func doWork(ctx context.Context, input Input) <-chan Result {
    out := make(chan Result, 1) // buffered 1 — the send always has somewhere to land
    go func() {
        select {
        case out <- compute(input):
        case <-ctx.Done():
        }
    }()
    return out
}`} />
        <p>
          Both fixes matter here, not just one. The buffer of 1 means a send that beats the caller to the punch doesn't need a
          receiver present at all — it lands in the buffer and the goroutine exits clean even if nobody ever reads it. The{' '}
          <code>ctx.Done()</code> case means a send that's still in flight when the caller gives up has somewhere to go instead
          of parking. <code>runtime.Stack()</code> or a <code>pprof</code> goroutine dump on the leaking version shows exactly
          this shape: a growing pile of goroutines all blocked at the same line, in <code>chansend</code>.
        </p>

        <h3>7.3 — Fan-out worker pool deadlock</h3>
        <p>
          N workers each write their result to a shared, unbuffered results channel. The main goroutine reads results in a
          loop and returns early the first time it sees an error — a completely reasonable-looking short-circuit. Every
          worker still running at that point has a value ready to send and nobody left reading. They all pile into{' '}
          <code>sendq</code>, and since nothing ever drains it, the pool never actually terminates — the process just
          accumulates blocked goroutines every time this path runs.
        </p>
        <CodeBlock lang="go" code={`// deadlocks: main stops draining on first error, remaining workers park forever
results := make(chan Result) // unbuffered
for i := 0; i < n; i++ {
    go func(i int) { results <- doWork(i) }(i)
}
for i := 0; i < n; i++ {
    r := <-results
    if r.Err != nil {
        return r.Err // n-1 workers may still be trying to send
    }
}

// fixed: size the buffer to the fan-out, so every worker can always land its result
results := make(chan Result, n)
for i := 0; i < n; i++ {
    go func(i int) { results <- doWork(i) }(i)
}
for i := 0; i < n; i++ {
    r := <-results
    if r.Err != nil {
        return r.Err // remaining sends land in the buffer and those goroutines exit clean
    }
}`} />
        <p>
          Buffering to exactly the fan-out width is the general rule for this pattern: every goroutine you start gets a
          guaranteed landing spot for its one result, so an early return by the reader can never leave a sender stuck.
        </p>

        <h3>7.4 — CPU alert: one core pegged, no traffic increase</h3>
        <p>
          Different alert, same investigative shape as 7.0 and 7.1 — a graph fires, and the first hypothesis (more traffic) is
          wrong. Request volume is flat. A CPU flame graph points at a single goroutine, and the top of its stack is a{' '}
          <code>select</code> with a <code>default:</code> case, in a <code>for</code> loop, added at some point "to make it
          non-blocking."
        </p>
        <CodeBlock lang="go" code={`// spins: default fires every time nothing's ready, loop never sleeps
for {
    select {
    case v := <-ch:
        handle(v)
    default:
        // "non-blocking" — but nothing here ever yields
    }
}

// fixed: block when there's nothing to do, that's what gopark is for
for v := range ch {
    handle(v)
}`} />
        <Suspense fallback={<VisualizerFallback />}><CPUSpinSim /></Suspense>
        <p>
          <code>default:</code> is correct when the caller genuinely has other work to interleave and checking the channel is
          just one option among several in that iteration. It's wrong when it's the only thing in the loop — at that point
          there's no "other work," just a spin, and the fix is to let the goroutine block the normal way.
        </p>

        <h3>7.5 — Send-on-closed panic from a race to close</h3>
        <p>
          Multiple producers write to a shared channel. One of them decides it's done and calls <code>close()</code> without
          knowing whether the others are also still writing. Sooner or later one of them loses the race and panics mid-send.
        </p>
        <CodeBlock lang="text" code={`panic: send on closed channel

goroutine 42 [running]:
main.producer(0x3)
        /app/producer.go:19 +0x65
created by main.main
        /app/main.go:31 +0x94`} />
        <p>
          This is a design bug, not a runtime quirk to work around — the real problem is that "who closes this channel" was
          never decided. The fix is to make ownership explicit: either one dedicated goroutine owns the close (nobody who
          might still be sending is allowed to call it), or a <code>sync.Once</code> makes the close itself safe to call from
          multiple places without a double-close panic — which solves double-close, but not a send racing a close from another
          producer that's still in flight. The only real fix for that half is: producers never close a channel other producers
          might still be writing to.
        </p>
        <CodeBlock lang="go" code={`var closeOnce sync.Once
func shutdown() { closeOnce.Do(func() { close(done) }) } // safe against concurrent close() calls

// but a shared results channel is still safest closed by exactly one owner:
// a dedicated closer goroutine that waits for every producer via sync.WaitGroup,
// then closes — so no producer can ever race a close with its own send.
var wg sync.WaitGroup
for i := 0; i < n; i++ {
    wg.Add(1)
    go func() { defer wg.Done(); results <- doWork() }()
}
go func() { wg.Wait(); close(results) }() // closes only once every sender is done`} />

        <h3>7.6 — Nil channel gotcha</h3>
        <p>
          A <code>select</code> case reads from a channel variable that's <code>nil</code> — usually a feature flag disabled at
          startup, or a channel that's supposed to be assigned later and isn't yet. Part 4 covers the mechanism: a nil case is
          never added to the poll order, so it blocks forever by design and that's often exactly the intended behavior for
          disabling a case. The bug shows up when it's <em>not</em> intended — a channel that was supposed to be wired up and
          silently wasn't, so a whole workflow path goes quiet with no error, no panic, no spin. Nothing in the process
          behaves abnormally; work just never happens.
        </p>
        <CodeBlock lang="go" code={`type Worker struct {
    urgent chan Task // nil until StartUrgentQueue() is called
    normal chan Task
}

func (w *Worker) run() {
    for {
        select {
        case t := <-w.urgent: // if urgent was never started, this case never fires — ever
            handle(t)
        case t := <-w.normal:
            handle(t)
        }
    }
}`} />
        <p>
          The fix is almost always making the disabled state explicit instead of relying on an accidental nil — a boolean
          guard, or a channel that's deliberately never read from a variable that might silently stay unset. Reuse the
          select visualizer from Part 4 to see it directly: toggle chC to nil and watch it drop out of the poll order with no
          error at all.
        </p>

        <h3>7.7 — Buffered channel sized wrong as a semaphore</h3>
        <p>
          <code>chan struct{'{}'}</code> used as a concurrency limiter — acquire is a send into the buffer, release is a
          receive that frees a slot — only works if the buffer size actually matches what the downstream resource can take. Too
          small and you serialize work that could safely run in parallel. Too large and the semaphore stops limiting anything;
          you overload the downstream and pay for the extra goroutines in memory with nothing to show for it.
        </p>
        <CodeBlock lang="go" code={`sem := make(chan struct{}, n) // n should match the downstream's real concurrency ceiling

func call(ctx context.Context, req Request) (Response, error) {
    sem <- struct{}{}        // acquire — blocks once n are already in flight
    defer func() { <-sem }() // release
    return downstream.Do(ctx, req)
}`} />
        <Suspense fallback={<VisualizerFallback />}><SemaphoreSizingSim /></Suspense>
        <p>
          Size it from the downstream's actual ceiling — a connection pool limit, a rate limit, a CPU count for local work —
          not from a guess. The right number produces maximum throughput with the minimum number of goroutines held in flight;
          past it, you're only adding memory pressure.
        </p>

        <h3>7.8 — Pipeline stage that never closes downstream</h3>
        <p>
          A classic multi-stage pipeline — <code>stage1 → ch1 → stage2 → ch2 → stage3</code> — where each stage reads with{' '}
          <code>for v := range ch</code> and relies on the upstream closing its output channel to know when to stop. If one
          stage exits (normal completion, or an early return on error) without closing the channel it owns, the next stage's{' '}
          <code>range</code> loop blocks on a receive that will never come and never will, since nothing sends and nothing
          closes.
        </p>
        <CodeBlock lang="go" code={`// stage1 exits early on error without closing out — stage2's range blocks forever
func stage1(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out) // must run on every exit path, including early returns
        for v := range in {
            if v < 0 {
                return // BUG: deferred close still runs — but only because it's deferred
            }
            out <- v * 2
        }
    }()
    return out
}`} />
        <p>
          The bug in that snippet is actually already fixed by <code>defer close(out)</code> — which is the point. The rule
          that prevents this whole class of bug is: <strong>whoever creates a channel owns closing it, exactly once, on every
          exit path</strong> — and <code>defer</code> is how you get "every exit path" for free instead of remembering to
          call <code>close()</code> at each individual return. The version that actually deadlocks is the one where a stage
          returns via a bare <code>return</code> or <code>panic</code>-and-<code>recover</code> path that was added later,
          after the <code>close()</code> call was written as a one-off at the bottom of the function instead of a{' '}
          <code>defer</code> at the top.
        </p>

        <h3>7.9 — HTTP/gRPC handler leak on client disconnect</h3>
        <p>
          A handler spins up a goroutine to compute something and send the result back over a channel. The client disconnects
          — a mobile connection drops, a browser tab closes — and the handler returns because the framework already noticed
          the disconnect. Nothing told the background goroutine, so it finishes its work and tries to send a result nobody
          will ever read.
        </p>
        <CodeBlock lang="go" code={`// leaks on client disconnect: result channel is never read after handler returns
func (s *Server) Handle(w http.ResponseWriter, r *http.Request) {
    result := make(chan Result) // unbuffered
    go func() { result <- expensiveCompute(r.Context()) }()
    select {
    case res := <-result:
        writeResponse(w, res)
    case <-r.Context().Done(): // client gone — but the goroutine above never heard about it
        return
    }
}

// fixed: the same context both sides already have is the wiring
func (s *Server) Handle(w http.ResponseWriter, r *http.Request) {
    result := make(chan Result, 1) // buffered — a late send always has somewhere to land
    go func() {
        select {
        case result <- expensiveCompute(r.Context()):
        case <-r.Context().Done():
        }
    }()
    select {
    case res := <-result:
        writeResponse(w, res)
    case <-r.Context().Done():
        return
    }
}`} />
        <p>
          This is scenario 7.2's exact shape wearing a request-handler costume — it's worth calling out on its own because it's
          the easiest of all of them to introduce by accident: the request's <code>context.Context</code> is sitting right
          there, already threaded through the handler, and it's easy to assume the framework wires it into every goroutine you
          spawn. It doesn't. You have to.
        </p>

        <h3>7.10 — Bounded event-queue channel under load</h3>
        <p>
          An observability agent pushes events into a bounded channel that a background goroutine drains and ships elsewhere.
          Under a load spike, production rate exceeds drain rate and the queue fills. At that point there are exactly two
          policies, and both cost something real: block the send — which pushes latency onto whatever's producing events,
          typically the exact hot path the agent isn't supposed to slow down — or drop the event — silent data loss, visible
          only through a drop counter if one exists.
        </p>
        <Suspense fallback={<VisualizerFallback />}><EventQueueDropSim /></Suspense>
        <CodeBlock lang="go" code={`events := make(chan Event, cap) // dataqsiz == cap

// drop policy — hot path never stalls, loss is only visible via a counter
select {
case events <- ev:
default:
    droppedTotal.Inc()
}

// block policy — no loss, but the caller now pays queue depth as latency
events <- ev`} />
        <p>
          The metrics worth alerting on are the two <code>hchan</code> fields this whole tradeoff is made of:{' '}
          <code>qcount</code> (as a <code>len(ch)</code> gauge, so a queue trending toward its cap is visible before it's
          full) and either a drop counter or an added-latency histogram, depending on which policy you chose. Neither policy is
          the "correct" one in the abstract — it's a decision about which failure mode is cheaper for the specific thing being
          monitored, and it should be a decision someone made on purpose, not whatever the default happened to be.
        </p>

        <h3>7.11 — Double-read on a closed, drained channel</h3>
        <p>
          <code>v, ok := &lt;-ch</code> exists because a receive on an empty, closed channel returns the zero value
          immediately rather than blocking — and code that ignores <code>ok</code> can't tell that apart from a real, sent
          zero value. This is exactly as true for the eleventh time you read from a drained closed channel as it is for the
          first: it will keep returning the zero value, silently, forever.
        </p>
        <CodeBlock lang="go" code={`// bug: ignores ok — can't distinguish "received a real 0" from "channel closed and drained"
for {
    v := <-counts
    total += v // once counts is closed and drained, this adds zero forever, in a tight loop
}

// fixed: ok tells the two cases apart
for {
    v, ok := <-counts
    if !ok {
        break // channel closed and drained — stop, don't keep "receiving" zeroes
    }
    total += v
}

// idiomatic form for the same loop
for v := range counts {
    total += v // range already checks ok internally and exits when the channel closes
}`} />
        <p>
          The tight-loop version of this bug is its own quiet cousin of scenario 7.4 — a loop that isn't blocked but isn't
          doing meaningful work either, once <code>ok</code> starts coming back <code>false</code> and nobody checked.
        </p>
      </section>

      <section>
        <h2>Putting it together</h2>
        <p>
          Every scenario above traces back to the same handful of <code>hchan</code> fields. <code>sendq</code>/<code>recvq</code>{' '}
          explain every leak and deadlock — a goroutine parked there is a goroutine that will never return until something
          drains the other side. <code>qcount</code>/<code>dataqsiz</code> explain every backpressure and sizing decision —
          block, drop, serialize, or overload are just names for what happens once <code>qcount</code> reaches{' '}
          <code>dataqsiz</code> and stays there. <code>closed</code> explains every panic and every clean shutdown, depending
          on which side of the channel you're standing on when it flips. None of this needs to be memorized as eleven separate
          incident playbooks — it falls out of the nine fields in Part 1, applied to whatever shape of bug is in front of you.
        </p>
        <p>
          The habit worth keeping, the same one that ran through{' '}
          <Link to="/monitoring-agent-internals">the monitoring agent post</Link> and{' '}
          <Link to="/tcp-internals">TCP from the inside</Link>: when a symptom doesn't fully explain itself at the first
          profile, go one layer deeper. A latency graph points at a goroutine profile. A goroutine profile points at one
          specific channel. That channel points at <code>hchan</code>, and <code>hchan</code> always has an answer.
        </p>
        <hr />
        <p>
          Related: <Link to="/monitoring-agent-internals">the anatomy of a lightweight monitoring agent's performance</Link>{' '}
          walks a similar diagnostic path through goroutines and buffered channels from the design side rather than the bug
          side. <Link to="/tcp-internals">TCP from the inside</Link> and{' '}
          <Link to="/kafka-internals">Kafka beyond the basics</Link> cover the same kind of queue-and-backpressure tradeoffs
          one layer further from the application, in the kernel's send buffer and a broker's partition log respectively.
        </p>
      </section>
    </article>
  )
}
