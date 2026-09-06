# LinkedIn drafts — Go channels: what's actually inside hchan

Post URL: https://string-wise.com/go-channels-internals

Hashtags for all variants: `#golang #concurrency #internals #backend #sre`

---

## Variant A — story-led

> The alert fired at 2am. p99 latency was up 10x. Nobody had deployed anything.
>
> Traces showed requests weren't slow in handler logic — they were stuck waiting to send a result on a channel. A goroutine profile showed hundreds of goroutines parked in `chansend`. Tracing it back: one consumer had died three hours earlier, `sendq` had been backing up ever since, and every new request was queuing behind it.
>
> None of that shows up if you don't know what's actually inside a channel.
>
> I opened up `hchan` — the real runtime struct behind every `chan` — field by field: the ring buffer, the two wait queues, `sudog`, the lock. Then used it to explain and fix 11 bugs that have taken down real production systems.
>
> Nine interactive visualizers:
>
> → the ring buffer, with live sendx/recvx cursors as you send and receive
> → a goroutine parking on sendq and getting woken by `goready()`
> → the same send run against an unbuffered and a buffered channel side by side
> → select's poll order, tie-break, and a nil channel silently dropping out
> → the 2am latency page, live
> → a heap alert where the leak is parked goroutines, not allocations
> → a `select{default:}` loop pegging a CPU core
> → sizing a `chan struct{}` semaphore against a real downstream ceiling
> → a bounded event queue: block the hot path, or drop the event
>
> https://string-wise.com/go-channels-internals

---

## Variant B — punchy / direct

> Every Go developer has written `ch <- v` a thousand times. Almost none have seen `hchan`.
>
> It's not exotic. A ring buffer, two wait queues, a lock. Nine fields explain almost every channel bug you'll ever debug.
>
> A few things in the post that surprise people:
>
> • `chansend` checks for a waiting receiver *before* it checks if the buffer has room — a direct handoff always beats a buffer trip.
> • A nil channel case in a `select` isn't "checked and found not ready." It's never polled at all. That's a feature until it's an accident.
> • Send-on-closed panics; receive-on-closed doesn't. Same design decision, seen from both ends — one is a bug, one is how `range` exits.
> • A `chan struct{}` semaphore sized above your downstream's real ceiling doesn't fail loudly. It just stops limiting anything and eats memory.
> • The classic "RSS climbing, GC not reclaiming" alert is often not an allocation problem at all — it's goroutines parked in `sendq`, still holding whatever they were about to send.
>
> 11 production incidents, 9 interactive visualizers, all traced back to a struct you can read in five minutes.
>
> https://string-wise.com/go-channels-internals

---

## Variant C — bug-catalog-led (the practitioner hook)

> Most channel bugs get explained one at a time, as isolated gotchas. They're not isolated — they're the same three fields of one struct, applied differently.
>
> `sendq` / `recvq` — every leak and every deadlock is a goroutine parked here that nothing will ever drain.
> `qcount` / `dataqsiz` — every backpressure decision (block, drop, serialize, overload) is just a name for what happens once these two are equal and stay that way.
> `closed` — every panic and every clean shutdown, depending which side of the channel you're standing on when it flips.
>
> The post walks all three through eleven real incidents: a 2am latency page traced to one dead consumer, a memory alert that's actually a goroutine leak in disguise, a `select{default:}` loop burning a full CPU core with flat traffic, a send-on-closed panic from a race between producers, a `chan struct{}` semaphore sized past its downstream's real ceiling, and more.
>
> ```go
> select {
> case results <- v:
> case <-ctx.Done():
>     return ctx.Err() // never park in sendq forever just because the consumer vanished
> }
> ```
>
> That one line fixes three of the eleven scenarios in the post, in three different disguises.
>
> https://string-wise.com/go-channels-internals

---

## Hacker News (Show HN)

Title: `Show HN: Go channels from the inside – hchan field by field, 11 production bugs, 9 interactive visualizers`

Body:

> I kept running into channel bugs explained as isolated gotchas — nil channels, leaked goroutines, a busy-polling `select{default:}` — with no shared mental model tying them together. They all come from the same nine fields of one struct.
>
> The post opens `hchan` from `runtime/chan.go`: the ring buffer (`buf`, `qcount`, `dataqsiz`, `sendx`, `recvx`), the two wait queues (`sendq`, `recvq`) and the `sudog` struct that represents a parked goroutine, `closed`, and the lock that guards all of it. Then it uses that struct to explain and fix 11 bugs that have actually paged someone: a 2am latency page traced from a goroutine profile back to one dead consumer, a memory alert that's a goroutine leak rather than an allocation problem, a fan-out worker pool that deadlocks on early return, a `select{default:}` loop pegging a CPU core, a send-on-closed panic from a race between producers, a `chan struct{}` semaphore sized past its downstream's real concurrency ceiling, and a few more.
>
> Nine interactive visualizers: the ring buffer with live cursors, a goroutine parking and getting woken on the wait queues, the same send run against an unbuffered and a buffered channel side by side, select's poll order and tie-break with a nil case you can toggle, and five lightweight incident-style charts (latency/goroutine correlation, heap/goroutine correlation, CPU spin, semaphore throughput vs. size, event-queue block-vs-drop).
>
> No framework beyond React + SVG (plus framer-motion for the park/wake animation); everything is prerendered so it works without JS for the prose.
