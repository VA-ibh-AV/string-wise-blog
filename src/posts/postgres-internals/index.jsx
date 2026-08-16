import { lazy, Suspense } from 'react'
import PostHeader from '../../components/PostHeader'
import CodeBlock from '../../components/CodeBlock'

const MVCCVisualizer = lazy(() => import('./MVCCVisualizer'))
const AutovacuumSim = lazy(() => import('./AutovacuumSim'))
const QueryPlanExplainer = lazy(() => import('./QueryPlanExplainer'))

function VisualizerFallback() {
  return <div className="viz-card viz-loading" aria-label="Loading interactive visualizer">loading interactive visualizer…</div>
}

export default function PostgresInternals() {
  return (
    <article className="article-shell prose prose-neutral mx-auto">
      <PostHeader
        title="PostgreSQL storage internals"
        date="2025-08-10"
        tags={['postgres', 'databases', 'internals']}
        readingTime="12 min"
      />

      <section>
        <h2>Why does my Postgres database get slow for no reason?</h2>
        <p>
          You just deployed the same code that ran fine in staging. Queries that took 200ms suddenly take 5 seconds. Your database CPU spikes to 90%. You check the queries — they haven't changed. You check the data size — no new rows. Yet every sequential scan now requires scanning 40% more disk pages than yesterday.
        </p>
        <p>
          The answer lives inside Postgres itself, in how it stores rows, how it cleans them up, and how it decides between scanning an index or the table. This is about <strong>MVCC, dead tuples, and autovacuum</strong> — the three forces that secretly control your database's speed.
        </p>
      </section>

      <section>
        <h2>Part 1: MVCC — Why dead tuples exist</h2>

        <p>
          PostgreSQL never overwrites a row in place. When you run an <code>UPDATE</code>, it doesn't change the row — it marks the old row as dead and writes a new row version to disk. This is <strong>MVCC: Multi-Version Concurrency Control</strong>.
        </p>

        <p>
          Why? Because Postgres gives every query a snapshot of the data from the moment it started. A long-running report query that takes 30 minutes needs to see a consistent view of the table — even if 1,000 UPDATEs happen during the query. If Postgres overwrote rows in place, that report would see torn data. MVCC lets readers and writers work without locking each other.
        </p>

        <p>
          The tradeoff: old row versions don't get deleted immediately. They sit on disk, invisible to new queries but still consuming space. These are <strong>dead tuples</strong>.
        </p>

        <p>
          Play with the visualizer below. Watch what happens to live and dead tuple counts as you INSERT, UPDATE, and DELETE. Then press VACUUM to reclaim the space.
        </p>

        <Suspense fallback={<VisualizerFallback />}><MVCCVisualizer /></Suspense>

        <h3>Understanding the simulator</h3>
        <ul>
          <li><strong>Live tuple</strong>: the current, valid version of a row. Queries return these. They have <code>xmax=0</code> (nothing supersedes them yet).</li>
          <li><strong>Dead tuple</strong>: a row version that has been updated or deleted but the space hasn't been reclaimed. Invisible to new queries but still on disk.</li>
          <li><strong>Bloat ratio</strong>: (dead tuples / total tuples). Higher than 50% and your table is noticeably inefficient.</li>
          <li><strong>VACUUM</strong>: Postgres' garbage collector. It scans the table, marks dead tuples as free space, and allows future INSERTs to reuse that space.</li>
        </ul>

        <p>
          In production, you never run VACUUM manually — <strong>autovacuum</strong> does it automatically in the background. But autovacuum can fall behind on high-churn tables.
        </p>
      </section>

      <section>
        <h2>Part 2: Autovacuum — The janitor that can't keep up</h2>

        <p>
          Autovacuum wakes up periodically and looks for tables that need cleaning. It uses a formula to decide when to clean:
        </p>

        <div className="not-prose bg-zinc-50 rounded-xl border border-zinc-200 p-5 my-6 font-mono text-sm">
          <p>trigger when: dead_tuples {'>'} <span className="text-accent-600 font-semibold">autovacuum_vacuum_threshold</span> + (<span className="text-accent-600 font-semibold">autovacuum_vacuum_scale_factor</span> × live_tuples)</p>
          <p className="text-xs text-zinc-500 mt-3">Default: dead_tuples {'>'} 50 + (0.20 × live_tuples)</p>
        </div>

        <p>
          On a 100-row table, autovacuum waits for 70 dead tuples. On a 10 million row table, it waits for 2,000,050 dead tuples. <strong>This default is terrible for large tables.</strong>
        </p>

        <p>
          What makes it worse: autovacuum has only 3 workers by default and it's throttled to avoid hammering your disk. If your UPDATE rate is high enough, autovacuum can't keep up — dead tuples pile up faster than they're cleaned.
        </p>

        <p>
          Run the simulation below. Try increasing the UPDATE rate while keeping the default scale factor. Watch autovacuum trigger, but dead tuples still climb. This is production table bloat.
        </p>

        <Suspense fallback={<VisualizerFallback />}><AutovacuumSim /></Suspense>

        <h3>Fixing autovacuum in production</h3>
        <p>
          When you see <code>postgresql.dead_tuples</code> climbing and <code>postgresql.autovacuum.running</code> constantly 1, autovacuum is losing. The fix is per-table tuning:
        </p>

        <CodeBlock lang="sql" code={`ALTER TABLE orders SET (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_vacuum_cost_delay = 1
);`} />

        <p>
          This makes autovacuum trigger at 1% bloat (not 20%) and backs off less aggressively. On high-churn tables like <code>events</code> or <code>audit_log</code>, this is often necessary.
        </p>

        <p>
          Monitor <code>postgresql.autovacuum.running</code>, <code>postgresql.dead_tuples</code>, and the ratio (bloat_pct). Set up alerts: if bloat_pct {'>'} 30% for 5 minutes, page on-call.
        </p>
      </section>

      <section>
        <h2>Part 3: Why your index gets ignored</h2>

        <p>
          Dead tuples don't just waste space — they also slow down index performance. But there's another reason Postgres ignores your index entirely: the query planner's <strong>cost model</strong>.
        </p>

        <p>
          Postgres doesn't guess whether an index is faster. It calculates. For every query, it estimates the cost of:
        </p>

        <ul>
          <li><strong>Sequential Scan</strong>: read every page of the table sequentially. Fast for small selectivity (many matching rows). No random I/O.</li>
          <li><strong>Index Scan</strong>: use the index to find matching rows, then fetch them from the heap. Fast for high selectivity (few matching rows). Lots of random I/O.</li>
        </ul>

        <p>
          The planner picks whichever has lower cost. The issue: on HDD, random I/O is ~4× slower than sequential I/O. On SSD, it's ~1.1×. If your server has the wrong <code>random_page_cost</code> setting, the planner makes the wrong choice.
        </p>

        <p>
          Even worse: if your table has high bloat (40% dead tuples), sequential scans read more pages than necessary. This can flip the planner's decision — it switches to index scans even when sequential scan would be faster if the table weren't bloated.
        </p>

        <p>
          Use the visualizer below. Set a large table and low selectivity (e.g., 500k rows, 0.5% match). Watch the planner choose index scan. Now increase selectivity to 2% — the planner flips to sequential scan. At what point does it flip? That's your crossover selectivity.
        </p>

        <Suspense fallback={<VisualizerFallback />}><QueryPlanExplainer /></Suspense>

        <h3>The cost model in real queries</h3>
        <p>
          Run <code>EXPLAIN</code> on a slow query. You'll see:
        </p>

        <CodeBlock lang="sql" code={`EXPLAIN SELECT * FROM users WHERE status = 'active';

Seq Scan on users  (cost=0.00..45000.00 rows=50000)
  Filter: (status = 'active')`} />

        <p>
          That <code>cost=0.00..45000.00</code> is Postgres saying: "Full scan is going to cost about 45,000 units." The planner weighed this against the index scan alternative and chose the lower number.
        </p>

        <p>
          If your index isn't being used, <code>EXPLAIN</code> tells you why. Either:
        </p>

        <ol>
          <li>The selectivity is too high — too many rows match, so the index fetch cost is worse than sequential scan</li>
          <li>The table is so bloated that sequential scan reads nearly the entire table anyway</li>
          <li>Your <code>random_page_cost</code> is wrong for your storage (should be ~1.1 for SSD, 4.0 for HDD)</li>
        </ol>

        <p>
          The fix is almost never "add an index." It's usually: run VACUUM, tune autovacuum, or fix your query selectivity.
        </p>
      </section>

      <section>
        <h2>Putting it together: a production incident</h2>

        <p>
          Your metrics show:
        </p>

        <ul>
          <li><code>postgresql.dead_tuples</code> on the <code>orders</code> table: 45 million (climbing)</li>
          <li><code>postgresql.autovacuum.running</code>: constantly 1</li>
          <li>Query times: 500ms → 8 seconds in the last hour</li>
        </ul>

        <p>
          Here's what happened:
        </p>

        <ol>
          <li>Batch job started updating 500k rows/min. Updates create dead tuples.</li>
          <li>Autovacuum triggered (45M {'>'} threshold) but can't keep up with the update rate.</li>
          <li>Dead tuples pile up. Bloat reaches 35%.</li>
          <li>Sequential scans now read 35% more pages than necessary.</li>
          <li>Your application's index scan on <code>user_id</code> now looks more expensive relative to sequential scan (because the table is bigger).</li>
          <li>Planner flips to sequential scan. You're now doing full table scans instead of index scans.</li>
          <li>8 second queries.</li>
        </ol>

        <p>
          The fix:
        </p>

        <CodeBlock lang="sql" code={`-- Quick fix: manual vacuum
VACUUM ANALYZE orders;

-- Long-term: tune autovacuum for this table
ALTER TABLE orders SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_cost_delay = 0
);`} />

        <p>
          Queries drop back to 200ms. Root cause: table structure didn't change, queries didn't change, data didn't change — but invisible disk bloat made the planner's best guess wrong.
        </p>
      </section>

      <section>
        <h2>What to monitor</h2>

        <p>
          In your Dashboard metrics, track:
        </p>

        <ul>
          <li><code>postgresql.dead_tuples</code> per table — alert if climbing above baseline</li>
          <li><code>postgresql.autovacuum.running</code> — constantly 1 is a red flag</li>
          <li>Bloat ratio (dead / (dead + live)) — alert if {'>'}30%</li>
          <li><code>postgresql.table.hot_updates</code> — low ratio means lots of index thrashing on updates</li>
          <li>Query times per table — a slow query might just be high bloat, not bad code</li>
        </ul>

        <p>
          When you see a correlation between rising dead tuples and slower queries, the answer isn't usually more CPU or more connections. It's autovacuum tuning.
        </p>
      </section>

      <section>
        <h2>One more thing</h2>

        <p>
          The default Postgres tuning is conservative — it prioritizes not breaking things over performance. For a fresh install on modest hardware, it's fine. But any table that gets more than 1000 updates/minute needs custom settings.
        </p>

        <p>
          Check your <code>autovacuum_max_workers</code> (default: 3). In Patroni clusters with many tables, only 3 workers means some tables don't get cleaned at all. Consider raising it to 6+ for busy clusters.
        </p>

        <p>
          And measure your <code>random_page_cost</code>. If you're on SSD, the default 4.0 is costing you index usage. Set it to 1.1 and re-ANALYZE:
        </p>

        <CodeBlock lang="sql" code={`ALTER SYSTEM SET random_page_cost = 1.1;
SELECT pg_reload_conf();
ANALYZE;  -- rebuild planner stats`} />

        <p>
          Your index usage will improve immediately.
        </p>
      </section>

      <section>
        <h2>Summary</h2>

        <p>
          PostgreSQL is fast when its storage is clean. MVCC is incredible for concurrency, but it creates dead tuples. Autovacuum cleans them, but it's tuned conservatively. When you hit scale, autovacuum can't keep up. Bloat builds. The planner's cost model — which is rock solid when data is clean — now makes suboptimal choices. Your queries slow down for no apparent reason.
        </p>

        <p>
          The fix isn't more hardware. It's understanding what's happening and tuning three things: <code>autovacuum_vacuum_scale_factor</code>, <code>autovacuum_vacuum_cost_delay</code>, and <code>random_page_cost</code>.
        </p>

        <p>
          Monitor dead tuples. Watch autovacuum. Understand the cost model. Your database will thank you.
        </p>
      </section>
    </article>
  )
}
