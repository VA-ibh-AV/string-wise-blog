import { lazy, Suspense } from 'react'
import PostHeader from '../../components/PostHeader'
import CodeBlock from '../../components/CodeBlock'

const PartitionFlow      = lazy(() => import('./PartitionFlow'))
const LogSegmentExplorer = lazy(() => import('./LogSegmentExplorer'))
const ConsumerGroupSim   = lazy(() => import('./ConsumerGroupSim'))
const RebalanceRace      = lazy(() => import('./RebalanceRace'))
const ISRReplication     = lazy(() => import('./ISRReplication'))
const LogCompaction      = lazy(() => import('./LogCompaction'))
const ExactlyOnceSim     = lazy(() => import('./ExactlyOnceSim'))

function VisualizerFallback() {
  return <div className="viz-card viz-loading" aria-label="Loading interactive visualizer">loading interactive visualizer…</div>
}

export default function KafkaInternals() {
  return (
    <article className="article-shell prose prose-neutral mx-auto">
      <PostHeader
        title="Kafka beyond the basics"
        date="2025-08-16"
        tags={['kafka', 'distributed-systems', 'internals']}
        readingTime="22 min"
      />

      <section>
        <h2>Everybody can write a consumer. Almost nobody can explain a rebalance.</h2>
        <p>
          Every Kafka tutorial ends at the same place: produce a message, consume a message, congratulations. That's enough to ship a prototype and nowhere near enough to debug the 3 a.m. page where consumer lag is climbing, throughput is zero, and the logs say nothing except <code>Attempt to heartbeat failed since group is rebalancing</code> over and over.
        </p>
        <p>
          This post is the layer underneath. Six things that actually determine how Kafka behaves in production — the log on disk, group assignment, rebalancing, replication and the high watermark, compaction, and exactly-once — each with an interactive visualizer you can poke at until the mental model clicks.
        </p>
        <p>
          Start with the machine at the centre of it all: a producer choosing a partition, and a consumer walking behind it.
        </p>

        <Suspense fallback={<VisualizerFallback />}><PartitionFlow /></Suspense>

        <p>
          Two things in there are worth naming right now. First, <strong>the partition is chosen on the client, not the broker</strong> — the producer hashes the key and picks. Second, <strong>ordering is a per-partition property</strong>, never a per-topic one. Every record with key <code>user-42</code> lands in the same partition and is therefore ordered relative to every other <code>user-42</code> record. Its ordering relative to <code>order-991</code> is undefined and always will be.
        </p>
        <p>
          That single fact is the source of most Kafka design mistakes. If you need two events ordered with respect to each other, they must share a key. If they don't share a key, you cannot get that ordering back downstream, no matter how many consumers you throw at it.
        </p>
        <p>
          That widget is the whole machine in miniature — a producer picking a partition, a log accepting the write, a consumer walking behind it. The rest of this post opens it up one layer at a time, starting with the thing everything else is built on.
        </p>
      </section>

      <section>
        <h2>Part 1: The log is the whole product</h2>

        <p>
          Kafka is not a queue. A queue's defining move is destructive read — you take a message and it's gone. Kafka never removes a record because someone read it. A partition is an <strong>append-only, immutable, ordered sequence of bytes on disk</strong>, and reading is just a positioned scan over that file. Ten consumers reading the same partition cost the broker almost nothing extra, because none of them mutate anything.
        </p>

        <p>
          On disk, a partition directory looks like this:
        </p>

        <CodeBlock lang="text" code={`/var/lib/kafka/data/events-0/
  00000000000000000000.log        # records 0..8191
  00000000000000000000.index      # sparse: relative offset -> byte position
  00000000000000000000.timeindex  # sparse: timestamp -> relative offset
  00000000000000008192.log        # the active segment, still being written
  00000000000000008192.index
  leader-epoch-checkpoint`} />

        <p>
          The filename is the <strong>base offset</strong> — the offset of the first record in that segment. Only the newest segment is open for writes; the rest are sealed. That single design choice is why retention is cheap: deleting old data means unlinking whole files, never rewriting anything.
        </p>

        <h3>An offset is a position, not an ID</h3>

        <p>
          This is the most common misreading. An offset is not a primary key handed out by the broker; it's the record's index in its partition. Offset 4192 in <code>events-0</code> has nothing whatsoever to do with offset 4192 in <code>events-1</code>. And a consumer doesn't ask "give me the message with ID 4192" — it says "position me at 4192 in this partition and stream forward."
        </p>

        <p>
          Which raises the obvious question: how do you find byte position of offset 4192 in a 1 GB file without reading 1 GB? The <code>.index</code> file. It's <em>sparse</em> — one entry roughly every 4 KB of log, not one per record — so it stays small enough to memory-map. The lookup is a binary search on the index, a seek, and a short forward scan.
        </p>

        <p>
          Drag the slider and run a lookup. Watch how few records actually get read.
        </p>

        <Suspense fallback={<VisualizerFallback />}><LogSegmentExplorer /></Suspense>

        <p>
          The consequence of this design is the feature everyone eventually needs: <strong>re-reading</strong>. Because reads don't consume, resetting a consumer group to an earlier offset replays history exactly as it happened.
        </p>

        <CodeBlock lang="bash" code={`# replay a bad deploy's worth of events
kafka-consumer-groups.sh --bootstrap-server localhost:9092 \\
  --group billing-worker --topic events --reset-offsets \\
  --to-datetime 2025-08-16T02:00:00.000 --execute`} />

        <p>
          That <code>--to-datetime</code> is served by <code>.timeindex</code>, the same sparse-lookup trick keyed on timestamp instead of offset. Rebuild a corrupted downstream store, backfill a new service, re-run a fixed aggregation — all of it is the same operation: move a number and read again.
        </p>
      </section>

      <section>
        <h2>Part 2: Consumer groups and who owns what</h2>

        <p>
          The mental model most people carry is "consumers subscribe to a topic and Kafka load-balances messages between them." That's wrong in a way that matters, and the correct version is only slightly harder: <strong>Kafka balances partitions, not messages.</strong> A partition is owned by exactly one consumer in a group at a time. Add a ninth consumer to a group reading eight partitions and it sits idle forever.
        </p>

        <p>
          Two roles run the show, and they are not the same thing:
        </p>

        <ul>
          <li><strong>Group Coordinator</strong> — a broker. The one hosting the <code>__consumer_offsets</code> partition for <code>hash(group.id) % 50</code>. It tracks membership, receives heartbeats, and decides when a rebalance is needed.</li>
          <li><strong>Group Leader</strong> — a <em>consumer</em>. The first member to join. It receives the full member list and <strong>runs the assignment algorithm locally</strong>, then uploads the result.</li>
        </ul>

        <p>
          Yes: the partition assignment your production cluster is using was computed by one of your own application pods, not by a broker. That's deliberate — it means you can ship a custom assignor without touching the cluster.
        </p>

        <p>
          The handshake is two phases:
        </p>

        <CodeBlock lang="text" code={`consumer                       coordinator (broker)
   |-- FindCoordinator --------->|
   |-- JoinGroup --------------->|   collects members until all arrive
   |<-- JoinGroup response ------|   one member marked leader, given member list
   |-- SyncGroup (leader: full   |
   |   assignment; others: {}) ->|
   |<-- SyncGroup response ------|   each member gets only its own partitions
   |-- Heartbeat (every 3s) ---->|`} />

        <p>
          Where do the committed offsets themselves live? In <code>__consumer_offsets</code>, an ordinary Kafka topic with 50 partitions — no special storage engine, no database. A commit is just a produce to it, keyed by <code>(group, topic, partition)</code>. And because that topic is <strong>compacted</strong> rather than time-retained, the latest value for every key survives forever while the history is collapsed away. That's why your group's position survives a broker restart, and why the offsets topic doesn't grow without bound despite every consumer writing to it every few seconds. Part 5 covers the mechanism.
        </p>

        <p>
          Move the sliders below. Watch what happens to the "partitions moved" counter as you switch strategies — that number is the cost of the rebalance you just triggered.
        </p>

        <Suspense fallback={<VisualizerFallback />}><ConsumerGroupSim /></Suspense>

        <h3>Which assignor to use</h3>

        <ul>
          <li><strong>Range</strong> (the historical default) — contiguous blocks per topic. With 2 consumers and 2 topics of 3 partitions each, consumer 1 gets 4 partitions and consumer 2 gets 2. Skew is structural, not bad luck.</li>
          <li><strong>RoundRobin</strong> — even distribution, but no memory. Every rebalance can reshuffle everything.</li>
          <li><strong>Sticky</strong> — even <em>and</em> minimises movement from the previous assignment. Still stop-the-world.</li>
          <li><strong>CooperativeSticky</strong> — sticky plus incremental revocation. This is the one you want; see the next section for why.</li>
        </ul>

        <h3>What lag actually measures</h3>

        <p>
          Lag is <code>log end offset − last committed offset</code>, per partition. Two things follow that people get wrong constantly:
        </p>

        <ol>
          <li><strong>Lag is measured against the committed offset, not the processed one.</strong> If you process records and commit every 30 seconds, your reported lag sawtooths by 30 seconds' worth of traffic while nothing is actually wrong.</li>
          <li><strong>Total lag hides the failure mode that matters.</strong> One stuck partition at 2 M lag and eleven healthy ones averages out to something unalarming. Always alert on <em>max</em> partition lag, not the sum.</li>
        </ol>

        <p>
          And lag that is flat but nonzero is fine. Lag with a positive first derivative is the incident.
        </p>
      </section>

      <section>
        <h2>Part 3: Rebalancing, the part that bites</h2>

        <p>
          A rebalance is Kafka redistributing partitions across a group. It's triggered by:
        </p>

        <ul>
          <li>a member joining or leaving cleanly (deploy, scale-up)</li>
          <li><code>session.timeout.ms</code> elapsing with no heartbeat — the consumer process is gone or wedged</li>
          <li><code>max.poll.interval.ms</code> elapsing between <code>poll()</code> calls — the process is alive and heartbeating, but stuck processing a batch</li>
          <li>partitions being added to a subscribed topic, or a regex subscription matching a new one</li>
        </ul>

        <p>
          That third trigger is the one that causes production incidents, because the heartbeat runs on a background thread. Your consumer keeps telling the coordinator "I'm alive!" while the main thread has been sitting in a 6-minute batch write for the last 6 minutes. Default <code>max.poll.interval.ms</code> is 5 minutes. The coordinator evicts it mid-batch, hands its partitions to somebody else, and your commit fails afterwards with <code>CommitFailedException</code> — those records get processed twice.
        </p>

        <p>
          Now the important part: <em>how</em> the redistribution happens. Press the button and watch both strategies handle the identical event.
        </p>

        <Suspense fallback={<VisualizerFallback />}><RebalanceRace /></Suspense>

        <h3>Eager: stop the world</h3>
        <p>
          Every member calls <code>onPartitionsRevoked</code> for <strong>all</strong> its partitions, rejoins, and waits. Between the revoke and the new assignment, the group processes <strong>nothing</strong> — not the partitions that were moving, not the ones that were staying put. On a group with heavy state or a slow rebalance, that's seconds to minutes of total blackout for a change that affected two partitions.
        </p>

        <h3>Cooperative: revoke only what moves</h3>
        <p>
          Two rebalances instead of one, but the first revokes nothing. Members compute the new assignment, diff it against what they hold, and only give up the partitions that genuinely change hands. The second rebalance hands those out. Everything else never stops.
        </p>

        <CodeBlock lang="properties" code={`partition.assignment.strategy=org.apache.kafka.clients.consumer.CooperativeStickyAssignor`} />

        <p>
          One migration caveat that has burned plenty of teams: you cannot flip this in a single rolling restart. Deploy once with <strong>both</strong> assignors listed (<code>CooperativeStickyAssignor,RangeAssignor</code>), let the whole group land on that build, then deploy again with only the cooperative one. The group negotiates the common protocol; if you jump straight there, members disagree and the group won't stabilise.
        </p>

        <h3>The rebalance storm</h3>

        <p>
          The pathological loop, and it is genuinely self-sustaining:
        </p>

        <ol>
          <li>A consumer takes slightly too long in <code>poll()</code> and gets evicted.</li>
          <li>Rebalance starts. Every other consumer pauses (eager) and their in-flight work stalls.</li>
          <li>The pause makes <em>their</em> next <code>poll()</code> late too.</li>
          <li>More evictions. Another rebalance. Go to 2.</li>
        </ol>

        <p>
          The group burns its entire day rebalancing and processes nothing. Lag goes vertical. The fixes, in order of how often they're the actual answer:
        </p>

        <CodeBlock lang="properties" code={`# 1. process less per poll — the single highest-leverage knob
max.poll.records=100

# 2. give slow batches room, but not so much that dead consumers linger
max.poll.interval.ms=600000

# 3. survive a rolling deploy without any rebalance at all (Kafka 2.3+)
group.instance.id=worker-3        # static membership
session.timeout.ms=45000

# 4. wait for stragglers before assigning, so one restart = one rebalance
group.initial.rebalance.delay.ms=3000`} />

        <p>
          <strong>Static membership</strong> deserves the callout. With <code>group.instance.id</code> set, a consumer that disappears and comes back within <code>session.timeout.ms</code> reclaims exactly its old partitions and <em>no rebalance happens at all</em>. For a StatefulSet doing a rolling restart, that turns N rebalances into zero. Pair it with a session timeout comfortably longer than your pod restart time.
        </p>
      </section>

      <section>
        <h2>Part 4: ISR, replication and the high watermark</h2>

        <p>
          Each partition has one leader replica and some followers. All reads and writes go to the leader; followers are pure fetchers, running an ordinary consumer fetch loop against it.
        </p>

        <p>
          The <strong>ISR</strong> (In-Sync Replicas) is the subset of replicas currently caught up — specifically, replicas that have fetched from the leader within <code>replica.lag.time.max.ms</code> (default 30s). Note what that definition is <em>not</em>: it is not "within N records." Kafka dropped the message-count criterion years ago because a legitimate traffic burst would eject every follower at once.
        </p>

        <p>
          The <strong>high watermark</strong> is the minimum log-end-offset across the ISR, and it is the visibility boundary: <strong>consumers cannot read past it.</strong> A record that exists on the leader's disk but hasn't been replicated is simply invisible. That's what stops a consumer from reading a record that a subsequent leader failover would erase.
        </p>

        <p>
          Produce a few records, then stall a follower and watch the ISR shrink.
        </p>

        <Suspense fallback={<VisualizerFallback />}><ISRReplication /></Suspense>

        <h3>What acks actually buys you</h3>

        <table>
          <thead>
            <tr><th><code>acks</code></th><th>Leader waits for</th><th>You lose data when</th></tr>
          </thead>
          <tbody>
            <tr><td><code>0</code></td><td>nothing, no response sent</td><td>anything at all — a full socket buffer is enough</td></tr>
            <tr><td><code>1</code></td><td>its own local write</td><td>the leader dies before any follower fetches</td></tr>
            <tr><td><code>all</code></td><td>every current ISR member</td><td>all ISR members die together</td></tr>
          </tbody>
        </table>

        <p>
          Here's the trap: <strong><code>acks=all</code> alone does not make you durable.</strong> If the ISR has shrunk to just the leader, then "all ISR members" is one broker, and <code>acks=all</code> degrades silently to <code>acks=1</code>. The setting that closes that hole is broker- or topic-side:
        </p>

        <CodeBlock lang="bash" code={`# topic must have >= 2 in-sync replicas or produces are rejected outright
kafka-configs.sh --alter --entity-type topics --entity-name events \\
  --add-config min.insync.replicas=2`} />

        <p>
          With <code>replication.factor=3</code>, <code>min.insync.replicas=2</code> and <code>acks=all</code>, you can lose one broker and keep writing, lose two and start getting <code>NOT_ENOUGH_REPLICAS</code> — which is the correct behaviour. A rejected write is an incident you can see; a silently unreplicated write is one you discover a week later.
        </p>

        <h3>Leader epoch: the subtle one</h3>

        <p>
          When a leader fails and a follower takes over, the follower's log may be shorter. What happens to the extra records the old leader had?
        </p>

        <p>
          Pre-0.11, the recovering old leader truncated to its high watermark and refetched — and there were interleavings where that lost committed data or produced divergent logs. The fix is the <strong>leader epoch</strong>: a monotonic counter bumped on every leader change, stamped into every record batch. A recovering replica now asks the new leader "what's the end offset for epoch 5?" and truncates to precisely that point rather than guessing from its watermark.
        </p>

        <p>
          You never configure this. You just want it on, which means keeping <code>message.format.version</code> modern and never enabling <code>unclean.leader.election.enable</code> — unclean election lets an out-of-sync replica become leader, which is the one setting that will knowingly discard committed records.
        </p>
      </section>

      <section>
        <h2>Part 5: Compaction is not retention</h2>

        <p>
          Two independent cleanup policies, routinely confused:
        </p>

        <ul>
          <li><strong><code>cleanup.policy=delete</code></strong> — drop whole segments older than <code>retention.ms</code> or beyond <code>retention.bytes</code>. Time-based. Doesn't care about content.</li>
          <li><strong><code>cleanup.policy=compact</code></strong> — keep <em>at least the last value for every key</em>, forever. Key-based. Doesn't care about time.</li>
        </ul>

        <p>
          A compacted topic is a changelog that converges to a table. Read it from offset 0 and you reconstruct the current state of every key — which is exactly how <code>__consumer_offsets</code> works, how Kafka Streams restores its state stores, and how CDC topics stay bounded while remaining complete.
        </p>

        <p>
          The log cleaner is a background thread that picks the partition with the highest ratio of dirty (uncompacted) to total bytes, builds an in-memory map of key → highest offset over the dirty region, and rewrites the segments keeping only records whose offset matches the map. Two rules do most of the surprising work:
        </p>

        <ul>
          <li><strong>The active segment is never compacted.</strong> Your latest writes stay duplicated until the segment rolls. This is why <code>segment.ms</code> matters on low-traffic compacted topics — a segment that never fills also never rolls, and compaction never runs.</li>
          <li><strong>Offsets are never renumbered.</strong> Compaction removes records, leaving gaps. Offset 7 can simply not exist. Any code assuming contiguous offsets is broken code.</li>
        </ul>

        <p>
          Append records with repeating keys, drop a tombstone, run the cleaner.
        </p>

        <Suspense fallback={<VisualizerFallback />}><LogCompaction /></Suspense>

        <h3>Tombstones, and the delete window</h3>

        <p>
          A record with a <code>null</code> value is a <strong>tombstone</strong>: it means "this key is deleted." The cleaner keeps it around for <code>delete.retention.ms</code> (default 24h) before purging it, and that window exists for one specific reason — a consumer rebuilding state from offset 0 must observe the deletion. Purge tombstones too aggressively and a slow bootstrap misses the delete entirely, resurrecting rows that should be gone.
        </p>

        <CodeBlock lang="bash" code={`kafka-topics.sh --create --topic user-profiles --partitions 12 \\
  --config cleanup.policy=compact \\
  --config min.cleanable.dirty.ratio=0.1 \\   # compact aggressively (default 0.5)
  --config segment.ms=3600000 \\               # roll hourly so compaction can run
  --config delete.retention.ms=86400000       # 24h for consumers to see tombstones`} />

        <p>
          You can also set <code>cleanup.policy=compact,delete</code> — keep the latest value per key <em>and</em> drop anything older than the retention window. That's the right choice for a state topic where truly ancient keys are worthless.
        </p>
      </section>

      <section>
        <h2>Part 6: Exactly-once, honestly explained</h2>

        <p>
          "Exactly-once delivery" is impossible in a distributed system — that's the Two Generals problem and no vendor has repealed it. What Kafka provides is <strong>exactly-once <em>processing semantics</em></strong>: the observable effects of a record are applied once, even when the delivery underneath was at-least-once. The distinction is not pedantry; it tells you exactly where the guarantee stops (inside Kafka) and where it doesn't (your external database).
        </p>

        <h3>The problem: retries are duplicates</h3>

        <p>
          A producer sends a batch. The broker writes it. The ACK is lost on the way back. The producer, having no way to distinguish "never arrived" from "arrived, response lost," retries. Now the record is on the log twice — and the producer thinks everything is fine.
        </p>

        <p>
          <strong>Idempotent producer</strong> closes this. The producer gets a <code>producerId</code> from the broker and stamps every batch with a monotonic sequence number per partition. The broker keeps the last five sequence numbers per producer per partition and rejects anything it has already seen with <code>DUPLICATE_SEQUENCE_NUMBER</code> — which the client treats as success. Cost: effectively zero. It has been on by default since Kafka 3.0.
        </p>

        <p>
          Flip the toggle and lose an ACK both ways.
        </p>

        <Suspense fallback={<VisualizerFallback />}><ExactlyOnceSim /></Suspense>

        <h3>Transactions: atomicity across partitions</h3>

        <p>
          Idempotence protects one producer session writing to one partition. Transactions extend that to <strong>many partitions, many topics, and the consumer's own offsets, atomically</strong>.
        </p>

        <CodeBlock lang="go" code={`// confluent-kafka-go/v2. InitTransactions fences any zombie still holding
// this transactional.id — it must run once, before the loop.
if err := producer.InitTransactions(ctx); err != nil {
    log.Fatalf("init transactions: %v", err)
}

for {
    msgs := drain(consumer, 500*time.Millisecond, 1000)
    if len(msgs) == 0 {
        continue
    }
    if err := processBatch(ctx, producer, consumer, msgs); err != nil {
        log.Printf("batch aborted, will be reprocessed: %v", err)
    }
}

func processBatch(ctx context.Context, p *kafka.Producer, c *kafka.Consumer,
    msgs []*kafka.Message) error {

    if err := p.BeginTransaction(); err != nil {
        return err
    }

    // Every failure past this point must abort, or the transaction hangs open
    // and read_committed consumers stall behind the LSO until it times out.
    abort := func(err error) error {
        p.AbortTransaction(ctx) // outputs AND offsets roll back together
        return err
    }

    for _, m := range msgs {
        if err := p.Produce(enrich(m), nil); err != nil {
            return abort(err)
        }
        if err := p.Produce(audit(m), nil); err != nil {
            return abort(err)
        }
    }

    meta, err := c.GetConsumerGroupMetadata()
    if err != nil {
        return abort(err)
    }

    // The input offsets join the SAME transaction. This is the whole trick.
    // Note nextOffsets returns last-read + 1 — the offset to resume FROM.
    if err := p.SendOffsetsToTransaction(ctx, nextOffsets(msgs), meta); err != nil {
        return abort(err)
    }

    return p.CommitTransaction(ctx)
}`} />

        <p>
          That <code>SendOffsetsToTransaction</code> call is what makes read-process-write atomic. The consumer offset commit is written into <code>__consumer_offsets</code> as part of the transaction, so "I produced the output" and "I marked the input consumed" either both happen or neither does. Without it you have two separate commits and a window between them.
        </p>

        <p>
          Go's explicit error handling makes the shape of this clearer than the Java equivalent does: <strong>every path out of the transaction is either a commit or an abort, never a return.</strong> Leaking out without calling one of them leaves the transaction open, and every <code>read_committed</code> consumer on those partitions blocks behind the LSO until <code>transaction.timeout.ms</code> expires.
        </p>

        <p>
          Mechanically: a <strong>Transaction Coordinator</strong> (a broker, chosen by <code>hash(transactional.id)</code>) writes state to the internal <code>__transaction_state</code> topic, then writes commit or abort <strong>markers</strong> into every partition the transaction touched. A <code>read_committed</code> consumer never reads past the <strong>LSO</strong> (Last Stable Offset) — the first offset of any still-open transaction — so uncommitted records are on disk and invisible, and become visible all at once when the marker lands.
        </p>

        <p>
          Step through the transaction timeline in the second panel above and watch the LSO hold everything back until the commit.
        </p>

        <h3>The four settings, and the one caveat</h3>

        <CodeBlock lang="properties" code={`# producer
enable.idempotence=true
transactional.id=order-enricher-3      # MUST be stable across restarts
transaction.timeout.ms=60000

# consumer
isolation.level=read_committed
enable.auto.commit=false               # non-negotiable — offsets go via the transaction`} />

        <p>
          <code>transactional.id</code> must be stable per logical task and unique across instances. That's what fences zombies: when a new instance calls <code>initTransactions()</code> with an existing id, the coordinator bumps the producer epoch, and the old instance's next write fails with <code>ProducerFencedException</code> instead of corrupting the stream.
        </p>

        <p>
          The caveat worth stating loudly: <strong>the guarantee ends at Kafka's boundary.</strong> A transaction covering a Kafka write and a Postgres <code>INSERT</code> does not exist. For that path you still need an idempotent write downstream — a unique key, an upsert, or an outbox table — and read-committed consumption. Exactly-once inside Kafka, idempotence at every edge.
        </p>
      </section>

      <section>
        <h2>The production checklist</h2>

        <p>
          Everything above, compressed into things to actually go and check:
        </p>

        <ul>
          <li><strong>Alert on max partition lag, not total.</strong> And alert on its rate of change, not its value.</li>
          <li><strong>Alert on rebalance rate.</strong> <code>consumer-coordinator-metrics:rebalance-rate-per-hour</code> above single digits means something is wrong.</li>
          <li><strong>Set <code>min.insync.replicas=2</code></strong> on every topic that matters. <code>acks=all</code> without it is a comfortable lie.</li>
          <li><strong>Keep <code>unclean.leader.election.enable=false</code>.</strong> Availability is not worth silent data loss.</li>
          <li><strong>Move to <code>CooperativeStickyAssignor</code></strong> — but through a two-step rolling deploy with both assignors listed.</li>
          <li><strong>Set <code>group.instance.id</code></strong> on stateful consumers. Rolling restarts stop triggering rebalances entirely.</li>
          <li><strong>Tune <code>max.poll.records</code> down</strong> before you tune <code>max.poll.interval.ms</code> up. Smaller batches fix more incidents than longer timeouts.</li>
          <li><strong>Set <code>segment.ms</code> on low-traffic compacted topics.</strong> A segment that never rolls is never compacted.</li>
          <li><strong>Watch <code>UnderReplicatedPartitions</code> and <code>UnderMinIsrPartitionCount</code>.</strong> Non-zero for more than a minute is a page.</li>
        </ul>
      </section>

      <section>
        <h2>Summary</h2>

        <p>
          Kafka is a log with careful bookkeeping around it. The log gives you cheap fan-out, replay, and retention by file deletion. The bookkeeping — group coordination, ISR tracking, high watermarks, sequence numbers, transaction markers — is what turns that log into something you can build a business on.
        </p>

        <p>
          Almost every Kafka production surprise traces back to one of six misunderstandings — one per section of this post:
        </p>

        <ol>
          <li><strong>Thinking it's a queue.</strong> It's a log. Reads don't consume, which is why replay is free and fan-out is cheap.</li>
          <li><strong>Thinking Kafka balances messages.</strong> It balances <em>partitions</em>. That's why your ninth consumer on an eight-partition topic does nothing at all.</li>
          <li><strong>Not knowing a rebalance stops the world.</strong> Under the eager protocol, partitions that were never going to move stop anyway.</li>
          <li><strong>Thinking <code>acks=all</code> is enough on its own.</strong> Without <code>min.insync.replicas</code>, a shrunken ISR silently downgrades it to <code>acks=1</code>.</li>
          <li><strong>Confusing compaction with retention.</strong> One is keyed and keeps the latest value forever; the other is timed and deletes whole segments. They're orthogonal, and you can run both.</li>
          <li><strong>Expecting exactly-once to cross Kafka's boundary.</strong> It doesn't. The moment you write to Postgres, you're back to needing an idempotent write.</li>
        </ol>

        <p>
          Play with the visualizers until each one feels obvious. Then go and look at your consumer group's rebalance rate.
        </p>

        <hr />

        <p>
          Related: <a href="/tcp-internals">TCP from the inside</a> — every replica ack, every fetch and every heartbeat in this post is a byte stream over TCP, and
          the delivery guarantee ISR is built on top of turns out to be sequence numbers, cumulative ACKs and a retransmit timer.
          Also: <a href="/postgres-internals">PostgreSQL storage internals</a> — MVCC, dead tuples and the cost-based planner,
          <a href="https://raft.string-wise.com">Raft consensus visualizer</a>, which covers the leader-election machinery Kafka's own KRaft controller is built on, and
          the <a href="https://hash.string-wise.com">consistent hashing visualizer</a> for the partitioning problem one layer down.
        </p>
      </section>
    </article>
  )
}
