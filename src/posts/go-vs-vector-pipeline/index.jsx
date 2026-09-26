import { lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import PostHeader from '../../components/PostHeader'
import CodeBlock from '../../components/CodeBlock'

const AdaptiveConcurrencySim = lazy(() => import('./AdaptiveConcurrencySim'))
const BatchEconomicsSim      = lazy(() => import('./BatchEconomicsSim'))
const RegexCostBars          = lazy(() => import('./RegexCostBars'))
const DecodeAllocSim         = lazy(() => import('./DecodeAllocSim'))
const CopyChainSim           = lazy(() => import('./CopyChainSim'))

function VisualizerFallback() {
  return <div className="viz-card viz-loading" aria-label="Loading interactive visualizer">loading interactive visualizer…</div>
}

const VECTOR_SHA = '2389f1f7eac8cbf6d6e133f0bd0fabc667c26615'

/** Code-block caption that links a snippet to the exact Vector file it came from. */
function VecSrc({ path }) {
  return <a href={`https://github.com/vectordotdev/vector/blob/${VECTOR_SHA}/${path}`} target="_blank" rel="noreferrer" style={{ textTransform: 'none', letterSpacing: 0, color: 'inherit' }}>vector · {path}</a>
}

/** Static left-to-right architecture strip. Not interactive on purpose. */
function Pipeline({ title, stages, result }) {
  return (
    <div className="viz-card not-prose">
      <p className="viz-title">↳ {title}</p>
      <div className="flex flex-wrap items-center gap-2">
        {stages.map((s, i) => (
          <div key={s.name} className="flex items-center gap-2">
            {i > 0 && <span className="font-mono text-xs viz-muted">→</span>}
            <div className={`viz-chip px-3 py-2 ${s.hot ? 'viz-chip-bad' : s.queue ? 'viz-chip-hl' : ''}`}>
              <span className="font-mono text-[11px]">{s.name}</span>
              {s.sub && <span className="font-mono text-[10px] opacity-75">{s.sub}</span>}
            </div>
          </div>
        ))}
      </div>
      <p className="font-mono text-[11px] viz-dim mt-4">{result}</p>
    </div>
  )
}

export default function GoVsVectorPipeline() {
  return (
    <article className="article-shell prose prose-neutral mx-auto">
      <PostHeader
        title="We diffed our pipeline against Vector's source. Here's what we found."
        date="2026-09-23"
        tags={['go', 'rust', 'performance', 'elasticsearch', 'kafka']}
        readingTime="22 min"
      />

      <section>
        <h2>We built a Logstash replacement in Go. Vector does twice the work on the same workload.</h2>
        <p>
          The pipeline is simple to describe: read log events from Kafka, parse and enrich them, and bulk-index them into
          Elasticsearch. We replaced Logstash with a Go service to get lower memory use, simpler deployment, and code we
          understand. We got all three. Then we hit a throughput wall.
        </p>
        <p>
          We fixed the obvious problem, which took us from about 50k events/sec to about 1 lakh (100k). That figure is the
          total across every pod of both services, not a per-pod number. On the same workload,{' '}
          <a href="https://vector.dev">Vector</a> does about 2 lakh (200k). We did not want to guess at more tuning. So we
          went through Vector's source and its documented defaults, line by line, and diffed them against our own code.
        </p>
        <p>
          This post is that diff. It is not a "rewrite it in Rust" post. Most of what we found has nothing to do with the
          language. Each finding is a design choice that a production Rust pipeline made on purpose and that we made by
          accident. We are fixing each one in Go. The gap is still open at the end of this post, and we say so there.
        </p>
      </section>

      <section>
        <h2>1. The setup</h2>
        <p>
          The first version was one service that did everything: consume from Kafka, parse each event,
          build a bulk request, and push it to Elasticsearch. It was easy to reason about. It also meant parsing and pushing
          shared one process, one set of goroutines, and one failure domain.
        </p>
        <Pipeline
          title="v1: one service does everything"
          stages={[
            { name: 'kafka', sub: 'raw log topics', queue: true },
            { name: 'consume + parse + bulk push', sub: 'one process', hot: true },
            { name: 'elasticsearch' },
          ]}
          result="~50k events/sec, with consumer lag. A slow ES response stalled parsing, and a parsing spike delayed pushes."
        />
        <p>
          The symptom was consumer lag. The cause was coupling. When Elasticsearch slowed down, the
          push goroutines blocked. Then the parse goroutines blocked behind them. Then the consumer stopped fetching.
          Parse-heavy bursts caused the opposite problem: pushes waited for CPU that parsing held.
        </p>
      </section>

      <section>
        <h2>2. The first fix: decoupling</h2>
        <p>
          We split the service in two. A <strong>parse/bridge service</strong> consumes raw events, parses them, and produces
          the parsed result back to Kafka. An <strong>ES-push service</strong> consumes the parsed topic and only does bulk
          indexing. Kafka sits between them as a durable buffer. Each side can now scale and fail on its own.
        </p>
        <Pipeline
          title="v2: parse and push decoupled through kafka"
          stages={[
            { name: 'kafka', sub: 'raw log topics', queue: true },
            { name: 'parse/bridge service', sub: 'consume + parse + produce' },
            { name: 'kafka', sub: 'logs.parsed', queue: true },
            { name: 'ES-push service', sub: 'consume + bulk index' },
            { name: 'elasticsearch' },
          ]}
          result="~100k events/sec in total, summed over every pod of both services. Vector on the same workload: ~200k."
        />
        <p>
          Throughput doubled. It was a real fix, and it is the right architecture. But 100k, summed over every pod of two
          services, is still half of what Vector does on the same workload. The architecture was no longer the problem.
        </p>
      </section>

      <section>
        <h2>3. Why still short: going to the source</h2>
        <p>
          The usual next step is to tune: raise worker counts, raise batch sizes, add replicas, and watch a dashboard. We had
          done some of that, and each change moved the number a little or not at all. That is a sign you are tuning
          constants inside a design that caps you.
        </p>
        <p>
          So we changed method. Vector solves the same problem, it is open source, and its defaults are documented. We read
          its Kafka source, its Elasticsearch sink, its batching and request layers, and its event model. For every place
          where Vector made a choice, we found the matching place in our code and wrote down what we did instead. Five groups
          of findings came out of that: concurrency, batching, regex, JSON, and copies. Concurrency is the biggest one.
        </p>
      </section>

      <section>
        <h2>4. Concurrency: a fixed semaphore vs. adaptive concurrency</h2>
        <h3>What we do</h3>
        <p>
          The ES-push service limits in-flight bulk requests with one global semaphore, <code>ESWorkers</code>, default 16.
          Every partition of every topic shares it. There is a second
          problem in how the token is held. The retry loop sits <em>inside</em> the acquire/release pair, so a batch keeps its
          token through every backoff sleep:
        </p>
        <CodeBlock lang="go" code={`var esSem = make(chan struct{}, cfg.ESWorkers) // 16, shared by every topic and partition

func (p *Pusher) push(ctx context.Context, batch []Event) error {
    esSem <- struct{}{}
    defer func() { <-esSem }()

    for attempt := 0; ; attempt++ {
        err := p.sendOnce(ctx, batch)
        if err == nil || attempt == p.maxRetries {
            return err
        }
        time.Sleep(backoff(attempt)) // token still held: one of 16 slots does nothing
    }
}`} />
        <p>
          When Elasticsearch has a bad minute and starts returning 429s, batches start retrying. Each retrying batch sleeps
          while it holds a slot, so the effective limit drops below 16. Holding the slot is not the bug on its own. Vector
          does the same thing, as shown below. The bug is that nothing else reacts: new batches keep arriving at
          the same fixed limit while the cluster is asking everyone to slow down.
        </p>
        <p>
          The parse/bridge service has the same shape on the produce side. Every worker, for every topic, produces through a
          hardcoded pool of 8 <code>sarama.SyncProducer</code>s per broker. Each call blocks until every in-sync replica
          acknowledges, because <code>RequiredAcks = WaitForAll</code>:
        </p>
        <CodeBlock lang="go" code={`cfg := sarama.NewConfig()
cfg.Producer.RequiredAcks = sarama.WaitForAll
cfg.Producer.Return.Successes = true // required by SyncProducer

const producersPerBroker = 8 // shared by every worker and every topic

func (p *pool) send(msgs []*sarama.ProducerMessage) error {
    prod := <-p.idle          // wait for one of 8 producers
    defer func() { p.idle <- prod }()
    return prod.SendMessages(msgs) // blocks for the full ISR round trip
}`} />
        <p>
          <code>WaitForAll</code> is the correct durability setting, and we are keeping it. The problem is the pool. Eight
          synchronous callers means at most eight produce round trips in flight per broker, whatever the worker count is.
          Everything else queues behind the pool.
        </p>

        <h3>What Vector does</h3>
        <p>
          Vector's HTTP-based sinks, the Elasticsearch sink included, default to{' '}
          <strong>Adaptive Request Concurrency (ARC)</strong>. The shared sink service type shows the layering. Note that{' '}
          <code>Retry</code> sits <em>inside</em> the concurrency limit, the same as our retry loop inside the semaphore:
        </p>
        <CodeBlock lang="rust" caption={<VecSrc path="src/sinks/util/service.rs" />} code={`pub type Svc<S, L> =
    RateLimit<AdaptiveConcurrencyLimit<Retry<FibonacciRetryPolicy<L>, Timeout<S>>, L>>;`} />
        <p>
          The difference is the limit itself. The defaults start at 1 and cap at 200:
        </p>
        <CodeBlock lang="rust" caption={<VecSrc path="src/sinks/util/adaptive_concurrency/mod.rs" />} code={`const fn default_initial_concurrency() -> usize {
    1
}

const fn default_decrease_ratio() -> f64 {
    0.9
}

const fn default_ewma_alpha() -> f64 {
    0.4
}

const fn default_rtt_deviation_scale() -> f64 {
    2.5
}

const fn default_max_concurrency_limit() -> usize {
    200
}`} />
        <p>
          Once per RTT window, the controller compares the window's mean RTT with an EWMA of past RTTs. It adds 1 when the
          limit was fully used and RTT was at or below the average. It multiplies by 0.9 when RTT goes past the average by
          2.5 standard deviations, or when any response in the window was back-pressure:
        </p>
        <CodeBlock lang="rust" caption={<VecSrc path="src/sinks/util/adaptive_concurrency/controller.rs" />} code={`if inner.current_limit < self.settings.max_concurrency_limit
    && inner.reached_limit
    && !inner.had_back_pressure
    && current_rtt.is_some()
    && current_rtt.unwrap() <= past_rtt.mean
{
    // Increase (additive) the current concurrency limit
    self.semaphore.add_permits(1);
    inner.current_limit += 1;
}
// Back pressure responses, either explicit or implicit due
// to increasing response times, trigger a decrease in the
// concurrency limit.
else if inner.current_limit > 1
    && (inner.had_back_pressure || current_rtt.unwrap_or(0.0) >= past_rtt.mean + threshold)
{
    let new_limit =
        ((inner.current_limit as f64 * self.settings.decrease_ratio) as usize).max(1);
    self.semaphore
        .forget_permits(inner.current_limit - new_limit);
    inner.current_limit = new_limit;
}`} />
        <p>
          "Back-pressure" means any response the sink would retry. For Elasticsearch, that is a 429 or any 5xx:
        </p>
        <CodeBlock lang="rust" caption={<VecSrc path="src/sinks/elasticsearch/retry.rs" />} code={`match status {
    StatusCode::TOO_MANY_REQUESTS => RetryAction::Retry("too many requests".into()),
    StatusCode::NOT_IMPLEMENTED => {
        RetryAction::DontRetry("endpoint not implemented".into())
    }
    _ if status.is_server_error() => RetryAction::Retry(
        // ...
    ),
    // ...
}`} />
        <p>
          This is AIMD, the same additive-increase/multiplicative-decrease loop that TCP congestion control uses (the{' '}
          <Link to="/tcp-internals">TCP post</Link> has a visualizer for that one). The limit finds the cluster's real
          capacity, follows it down when the cluster slows, and climbs back when it recovers. Nobody picks the number.
        </p>
        <p>
          On the Kafka side, Vector's sink uses <code>rust-rdkafka</code>'s <code>FutureProducer</code>.{' '}
          <code>send_result</code> only enqueues the record into librdkafka's internal queue and returns a future for the
          delivery report. librdkafka batches and pipelines the actual produce requests. When the queue is full, the sink
          waits 100ms and tries again. No small pool of blocking callers exists to become the bottleneck:
        </p>
        <CodeBlock lang="rust" caption={<VecSrc path="src/sinks/kafka/service.rs" />} code={`loop {
    match this.kafka_producer.send_result(record) {
        // Record was successfully enqueued on the producer.
        Ok(fut) => {
            drop(blocked_state.take());
            return fut
                .await
                .expect("producer unexpectedly dropped")
                // ...
        }
        // Producer queue is full or a policy has been violated and the request should
        // be retried
        Err((
            KafkaError::MessageProduction(
                RDKafkaErrorCode::QueueFull | RDKafkaErrorCode::PolicyViolation,
            ),
            original_record,
        )) => {
            // ...
            record = original_record;
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        // ...
    }
}`} />

        <h3>See the difference</h3>
        <p>
          The simulator below runs both strategies against the same model cluster. Start it at 1× and watch ARC climb past 16
          toward the cluster's real capacity while the fixed limit stays flat. Then move the slowdown slider up and watch the
          fixed limit become too high: RTT grows, 429s arrive, and retries hold slots. Then add transient 5xx errors. ARC
          counts those as back-pressure too, so it backs off hard, and at low slowdown the fixed limit can win. ARC is built
          to protect the cluster, not to win every benchmark.
        </p>
        <Suspense fallback={<VisualizerFallback />}><AdaptiveConcurrencySim /></Suspense>
        <p>
          The lesson is not "16 is the wrong number." Every constant is the wrong number most of the time, because the
          cluster's capacity changes during the day. A fixed limit is too low when the cluster is healthy and too high when it
          is not. The fix in Go is to replace the constant with a feedback loop. An AIMD limiter is about 60 lines of Go. We
          are also moving the backoff sleep outside the limiter. Vector does not do that, so that part is our choice, not a
          finding from the diff. On the produce side, we are replacing the sync pool with <code>sarama.AsyncProducer</code>,
          and we are evaluating <code>franz-go</code>, which pipelines produce requests natively.
        </p>
        <CodeBlock lang="go" code={`for attempt := 0; ; attempt++ {
    if err := p.limiter.Acquire(ctx); err != nil { // adaptive limit, not a fixed channel
        return err
    }
    start := time.Now()
    err := p.sendOnce(ctx, batch)
    p.limiter.Release(time.Since(start), isRetryable(err)) // feed RTT and back-pressure back
    if err == nil || attempt == p.maxRetries {
        return err
    }
    time.Sleep(backoff(attempt)) // no slot held while sleeping
}`} />
      </section>

      <section>
        <h2>5. Batching economics</h2>
        <p>
          Every bulk request pays a fixed cost before Elasticsearch indexes a single document: the network round trip, HTTP
          framing, and fan-out from the coordinating node to the shards. Batch size decides how many events share that cost.
        </p>
        <p>
          Our ES-push service caps a batch at <strong>250 events or 2MB</strong>, whichever comes first. With log events of a
          couple of KB, the 250-event cap always binds first, and the 2MB cap never matters. Vector's Elasticsearch sink
          uses <code>RealtimeSizeBasedDefaultBatchSettings</code>: <strong>10MB, no event-count cap, and a 1-second
          timeout</strong>. It limits by bytes only, because bytes are what the cluster pays for.
        </p>
        <CodeBlock lang="rust" caption={<VecSrc path="src/sinks/util/batch.rs" />} code={`/// Reasonable default batch settings for sinks with timeliness concerns, limited by byte size.
#[derive(Clone, Copy, Debug, Default)]
pub struct RealtimeSizeBasedDefaultBatchSettings;

impl SinkBatchSettings for RealtimeSizeBasedDefaultBatchSettings {
    const MAX_EVENTS: Option<usize> = None;
    const MAX_BYTES: Option<usize> = Some(10_000_000);
    const TIMEOUT_SECS: f64 = 1.0;
}`} />
        <CodeBlock lang="rust" caption={<VecSrc path="src/sinks/elasticsearch/config.rs" />} code={`pub batch: BatchConfig<RealtimeSizeBasedDefaultBatchSettings>,`} />
        <p>
          Small batches hurt more when concurrency is fixed. With 16 requests in flight and 250 events in each, at most 4,000
          events are in flight at any time, however fast the cluster is. Move the slider to see where the fixed overhead stops
          dominating.
        </p>
        <Suspense fallback={<VisualizerFallback />}><BatchEconomicsSim /></Suspense>
        <p>
          The second panel shows a related problem in the parse/bridge service. The worker count is hardcoded to 96 or 256,
          whatever the topic's partition count is. Messages go to worker <code>partition % workers</code>. So a topic with 12
          partitions uses exactly 12 workers. The other 84 never get a message. Each one still runs a 10ms flush ticker, wakes
          up, finds an empty buffer, and goes back to sleep.
        </p>
        <CodeBlock lang="go" code={`workers := make([]*worker, max(cfg.Workers, 96)) // floor of 96, no link to partitions

func (r *router) dispatch(m *sarama.ConsumerMessage) {
    w := r.workers[int(m.Partition)%len(r.workers)] // only len(partitions) workers ever match
    w.in <- m
}

func (w *worker) run() {
    t := time.NewTicker(10 * time.Millisecond) // fires on idle workers too
    for {
        select {
        case m := <-w.in:
            w.add(m)
        case <-t.C:
            w.flush() // empty flush on most workers, forever
        }
    }
}`} />
        <p>
          Real parallelism was capped at the partition count all along. The extra workers added only idle goroutines and
          timer wakeups. The fix is to size workers as <code>min(partitions, GOMAXPROCS × k)</code> and to read the partition
          count from the consumer group claim, not from config.
        </p>
      </section>

      <section>
        <h2>6. The regex detour: same algorithm, different constant factor</h2>
        <p>
          This one started as "why is Vector's field extraction faster on the same patterns?" We expected an algorithm
          difference. There is none. Go's <code>regexp</code> and Rust's <code>regex</code> crate are both RE2-style engines.
          Both guarantee linear time in the input, and neither backtracks exponentially. A pattern that is safe in one is safe
          in the other.
        </p>
        <p>The gap comes from constant factors, and most of them were in our code:</p>
        <ul>
          <li>
            <strong>Compiling per call.</strong> This is the most common Go regex mistake. A{' '}
            <code>regexp.MustCompile</code> inside a function that runs per event costs tens of microseconds and dozens of
            allocations, every event.
          </li>
          <li>
            <strong>Capture groups when you only need a match.</strong> <code>FindStringSubmatch</code> allocates a result
            slice and forces Go to use a slower engine path than <code>MatchString</code>.
          </li>
          <li>
            <strong>Unanchored <code>.*</code> prefixes.</strong> A leading <code>.*</code> removes the literal prefix that
            lets the engine skip ahead, so it scans every byte.
          </li>
          <li>
            <strong>Engine-level differences.</strong> These are real, but smaller than the three above. Rust's crate has a
            lazy DFA and SIMD literal prefilters (<code>memchr</code>, Teddy). Go's engine uses an NFA, a one-pass matcher,
            or a bounded backtracker, with a simpler literal prefix check.
          </li>
        </ul>
        <CodeBlock lang="go" code={`// before: compiled on every event
func parseLine(line string) (map[string]string, bool) {
    re := regexp.MustCompile(\`.*status=(\\d+) latency=(\\d+)ms\`)
    m := re.FindStringSubmatch(line)
    ...
}

// after: compiled once, anchored on a literal
var lineRE = regexp.MustCompile(\`^\\S+ \\S+ status=(\\d+) latency=(\\d+)ms\`)

func parseLine(line string) (map[string]string, bool) {
    m := lineRE.FindStringSubmatch(line)
    ...
}`} />
        <p>
          Toggle each choice below. With compile-per-call turned on, Rust is slower than Go, because{' '}
          <code>Regex::new</code> does more up-front work so that matching is cheap later. The language is not the variable
          here.
        </p>
        <Suspense fallback={<VisualizerFallback />}><RegexCostBars /></Suspense>
      </section>

      <section>
        <h2>7. Death by a thousand JSON round-trips</h2>
        <p>
          This is where the Go code spent most of its CPU. Each event passes through <code>encoding/json</code> several times,
          and most of those passes do no useful work.
        </p>

        <h3>The bulk body: <code>buildBulk</code></h3>
        <p>
          For each event, <code>buildBulk</code> decodes the whole document into a{' '}
          <code>map[string]json.RawMessage</code> to read one or two fields. Then it calls <code>json.Marshal</code>, which
          uses reflection, on a nested map to produce the action line. That line is a fixed template with two variable
          values:
        </p>
        <CodeBlock lang="go" code={`// before: reflection to build a fixed string
action, _ := json.Marshal(map[string]any{
    "index": map[string]any{"_index": index, "_id": id},
})

// after: index names are [a-z0-9._-], ids are generated hex — no escaping needed
buf.WriteString(\`{"index":{"_index":"\`)
buf.WriteString(index)
buf.WriteString(\`","_id":"\`)
buf.WriteString(id)
buf.WriteString("\\"}}\\n")`} />
        <p>
          To be fair to Go: Vector does not use a string template here either. It builds the action line with{' '}
          <code>serde_json</code>'s <code>json!</code> macro. That still allocates a small value tree, but it involves no
          runtime reflection, which is the expensive part of <code>json.Marshal</code> on a map:
        </p>
        <CodeBlock lang="rust" caption={<VecSrc path="src/sinks/elasticsearch/encoder.rs" />} code={`(true, DocumentMetadata::Id(id)) => {
    write!(
        writer,
        "{}",
        json!({
            bulk_action: {
                "_index": index,
                "_id": id,
            }
        }),
    )
}`} />

        <h3>The bulk response: <code>sendOnce</code></h3>
        <p>
          After each request, <code>sendOnce</code> decodes the entire bulk response into a{' '}
          <code>map[string]json.RawMessage</code>, then calls <code>json.Unmarshal</code> once for each item. That is 251
          decode calls for a 250-item batch. It happens on every request, including the normal case where every item succeeded.
          Elasticsearch already reports this in a top-level <code>errors</code> boolean:
        </p>
        <CodeBlock lang="go" code={`var head struct {
    Errors bool \`json:"errors"\` // items is skipped without being decoded
}
if err := json.Unmarshal(body, &head); err != nil {
    return err
}
if !head.Errors {
    return nil // fast path: the whole batch succeeded
}
return p.collectItemErrors(body) // per-item decode only when something failed`} />
        <p>
          Vector's Elasticsearch retry logic goes further. On a 2xx response it does not decode anything unless a plain
          substring search finds a failure:
        </p>
        <CodeBlock lang="rust" caption={<VecSrc path="src/sinks/elasticsearch/retry.rs" />} code={`_ if status.is_success() => {
    let body = simdutf_bytes_utf8_lossy(response.http_response.body());

    if body.contains("\\"errors\\":true") {
        match EsResultResponse::parse(&body) {
            // ...
        }
    }
    // ...
}`} />

        <h3>The nested message: <code>parseSaramaMessage</code></h3>
        <p>
          The worst one is in the parse/bridge service. Each Kafka record wraps the real log event as a JSON string in a{' '}
          <code>"message"</code> field. <code>parseSaramaMessage</code> decodes that string into <code>any</code>. That is
          the most allocation-heavy path in <code>encoding/json</code>: every object becomes a map, every array a slice, and
          every value is boxed in an interface. Then the function passes the result straight to <code>json.Marshal</code>{' '}
          and never reads it.
        </p>
        <CodeBlock lang="go" code={`// before: build a full tree, then serialize it straight back
var inner any
if err := json.Unmarshal([]byte(env.Message), &inner); err != nil {
    return nil, err
}
out, err := json.Marshal(inner) // re-encodes what it just decoded

// after: check the syntax, keep the bytes
raw := json.RawMessage(env.Message)
if !json.Valid(raw) {
    return nil, errInvalidJSON
}`} />
        <p>
          The two versions do not produce byte-identical output. <code>json.Marshal</code> on a map sorts keys and escapes{' '}
          <code>&lt;</code>, <code>&gt;</code> and <code>&amp;</code>. The <code>RawMessage</code> version forwards the
          original bytes as they are. Both are equal as JSON. Before you switch, check that nothing downstream compares
          documents as bytes.
        </p>
        <p>Step through the payload to see where the allocations come from:</p>
        <Suspense fallback={<VisualizerFallback />}><DecodeAllocSim /></Suspense>

        <h3>What Vector does</h3>
        <p>
          Vector's JSON decoder is not magic. It parses into a generic <code>serde_json::Value</code> tree, which is the Rust
          equivalent of our decode into <code>any</code>, and then converts that tree into an event:
        </p>
        <CodeBlock lang="rust" caption={<VecSrc path="lib/codecs/src/decoding/format/json.rs" />} code={`let json: serde_json::Value = match self.lossy {
    true => serde_json::from_str(&simdutf_bytes_utf8_lossy(&bytes)),
    false => serde_json::from_slice(&bytes),
}
.map_err(|error| format!("Error parsing JSON: {error:?}"))?;

// If the root is an Array, split it into multiple events
let mut events = match json {
    serde_json::Value::Array(values) => values
        .into_iter()
        .map(|json| Event::from_json_value(json, log_namespace))
        .collect::<Result<SmallVec<[Event; 1]>, _>>()?,
    _ => smallvec![Event::from_json_value(json, log_namespace)?],
};`} />
        <p>
          The difference is what happens next. Vector keeps that tree as the event for the rest of the pipeline, and the
          sink serializes it once, straight into the bulk body with <code>serde_json::to_writer</code>. Our pipeline builds a
          tree, serializes it, sends the bytes through Kafka, and decodes them again in the ES-push service. Vector does not
          win on parser speed. It wins because it does not repeat the round-trip.
        </p>
      </section>

      <section>
        <h2>8. Copies, copies, copies</h2>
        <p>
          On the way out of the parse/bridge service, each payload is copied up to three times:
        </p>
        <CodeBlock lang="go" code={`payload, _ := json.Marshal(out)           // 1: allocates the payload (needed)
msg := cloneSaramaMessage(&sarama.ConsumerMessage{Value: payload})
                                           // 2: deep copy; payload is never used again
...
func WriteSaramaBatch(msgs []*sarama.ConsumerMessage) {
    for _, m := range msgs {
        v := make([]byte, len(m.Value))
        copy(v, m.Value)                   // 3: copies again for the producer message
        batch = append(batch, &sarama.ProducerMessage{Topic: topic, Value: sarama.ByteEncoder(v)})
    }
}`} />
        <p>
          The first allocation is necessary. Copies 2 and 3 protect against aliasing that cannot happen, because nothing
          else holds a reference to <code>payload</code>. At 100k events/sec and 2KB each, those two copies alone write
          about 400MB/sec of memory that becomes garbage at once. That raises GC frequency, and GC takes CPU from parsing.
        </p>

        <h3>The <code>Grow</code> call that does not add up</h3>
        <p>
          <code>buildBulk</code> tries to size its buffer before it writes, which is the right idea. But it calls{' '}
          <code>Grow</code> once per event:
        </p>
        <CodeBlock lang="go" code={`var buf bytes.Buffer
for _, ev := range events {
    buf.Grow(len(ev) + actionLineLen) // intent: reserve space for the whole batch
}
// actual result: capacity for about the single largest event`} />
        <p>
          <code>Grow(n)</code> guarantees space for <em>n more bytes past the current length</em>. The loop writes nothing,
          so the length stays 0. Each call asks for room for one event, and the buffer ends up sized for the largest one. The
          write loop that follows then grows and copies the buffer several times, which is what the pre-sizing was meant to
          prevent. The fix is to add up the sizes first and call <code>Grow</code> once:
        </p>
        <CodeBlock lang="go" code={`total := 0
for _, ev := range events {
    total += len(ev) + actionLineLen
}
buf.Grow(total)`} />

        <h3>What Vector does</h3>
        <p>
          Vector makes copies cheap in two places. Raw input arrives as <code>bytes::Bytes</code>, a reference-counted view
          into a shared buffer: the decoder above takes <code>bytes: Bytes</code>, and cloning a <code>Bytes</code>{' '}
          increments a counter without copying memory. The event itself is also reference-counted. A{' '}
          <code>LogEvent</code> holds its fields behind an <code>Arc</code>:
        </p>
        <CodeBlock lang="rust" caption={<VecSrc path="lib/vector-core/src/event/log_event.rs" />} code={`#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
pub struct LogEvent {
    #[serde(flatten)]
    inner: Arc<Inner>,
    // ...
}

pub fn value_mut(&mut self) -> &mut Value {
    let result = Arc::make_mut(&mut self.inner);
    // ...
}`} />
        <p>
          <code>#[derive(Clone)]</code> on a struct that holds an <code>Arc</code> means cloning an event bumps a
          reference count. The fields are copied only when someone writes to a shared event, through{' '}
          <code>Arc::make_mut</code>. This is copy-on-write: a fan-out to three sinks costs three counter increments, not
          three deep copies.
        </p>
        <p>
          Go has no <code>Bytes</code> type in the standard library, but it does not need one here. Pass the slice and agree
          on who owns it. Go slices already share memory when you do not copy them.
        </p>
        <Suspense fallback={<VisualizerFallback />}><CopyChainSim /></Suspense>
      </section>

      <section>
        <h2>9. What we're actually going to change</h2>
        <p>One line per finding, in the order we plan to ship them:</p>
        <ol>
          <li>Replace the fixed <code>ESWorkers</code> semaphore with an AIMD limiter that uses RTT and retryable responses as feedback.</li>
          <li>Release the limiter slot during retry backoff. This one is our own choice. Vector keeps retries inside its limit.</li>
          <li>Replace the pool of 8 sync producers with <code>sarama.AsyncProducer</code>, or move to <code>franz-go</code>.</li>
          <li>Drop the 250-event cap and batch by bytes only, starting at 5–10MB, with a timeout.</li>
          <li>Size parse/bridge workers from the partition count and CPU count, not a hardcoded floor.</li>
          <li>Hoist every <code>regexp.MustCompile</code> to package level, and anchor patterns on a literal.</li>
          <li>Build the bulk action line from a string template, not <code>json.Marshal</code>.</li>
          <li>Check the bulk response's top-level <code>errors</code> first, and decode items only when it is true.</li>
          <li>Pass the nested message as <code>json.RawMessage</code> after <code>json.Valid</code>, with no decode to <code>any</code>.</li>
          <li>Remove the two redundant payload copies, and fix the <code>Grow</code> loop to call <code>Grow</code> once with the total.</li>
        </ol>
        <p>
          We have not re-benchmarked yet, so the gap is still open. We are at about 100k events/sec, summed over every pod of
          both services, and Vector is at about 200k on the same workload. We do not expect every item on this list to matter equally. The concurrency changes and the JSON changes are
          the ones we expect to move the number most. We will publish the measured result as a follow-up, whether it closes
          the gap or not.
        </p>
        <p>
          The method is the main thing we took away. When tuning stops working, find a system that solves the same problem
          well, read its source, and write down every place where its design differs from yours. Most of what you find will
          not be about the language. It will be about constants that nobody chose on purpose.
        </p>
        <hr />
        <p>
          Related: <Link to="/kafka-internals">Kafka beyond the basics</Link> covers the partition and consumer group
          mechanics that decide how many workers can actually get work.{' '}
          <Link to="/go-channels-internals">Go channels: what's actually inside hchan</Link> covers semaphore sizing with{' '}
          <code>chan struct{'{}'}</code>, which is the limiter that section 4 replaces.{' '}
          <Link to="/tcp-internals">TCP from the inside</Link> has the congestion-control loop that ARC borrows from.
        </p>
      </section>
    </article>
  )
}
