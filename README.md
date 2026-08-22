# string-wise.com — Technical Blog Platform

A clean, fast, static blog built for long-form technical writing with embedded interactive visualizers. No backend, no CMS, no database — just code and ideas.

**Live:** [string-wise.com](https://string-wise.com)

---

## Sister Projects

These live on their own subdomains and are independent repos. The blog links to them.

| Project | URL | Description |
|---|---|---|
| Consistent Hashing Visualizer | [hash.string-wise.com](https://hash.string-wise.com) | Interactive ring-based consistent hashing demo |
| Raft Consensus Visualizer | [raft.string-wise.com](https://raft.string-wise.com) | Step-through Raft leader election and log replication |

---

## What This Is

Every post is a self-contained React component. Prose explains the concept, an embedded interactive visualizer lets the reader *feel* it. No iframes, no embeds — the visualizer is part of the post.

Posts are organized as folders. Adding a new post means creating a folder, writing the component, and adding one entry to `registry.js`. Push to main, it's live.

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | React + Vite | Fast dev, zero-config static output |
| Routing | React Router v6 | Client-side, no server needed |
| Styling | Tailwind CSS + Typography plugin | Beautiful prose layout, no custom CSS |
| Syntax highlighting | Shiki | Zero client-side JS, every language |
| Deployment | Docker + Nginx | Portable production container with automatic restarts |

---

## Project Structure

```
string-wise-blog/
│
├── src/
│   ├── posts/
│   │   ├── postgres-internals/
│   │   │   ├── index.jsx              # Post prose + layout
│   │   │   ├── MVCCVisualizer.jsx     # Live/dead tuple simulation
│   │   │   ├── AutovacuumSim.jsx      # Real-time autovacuum race simulation
│   │   │   └── QueryPlanExplainer.jsx # Seq scan vs index scan cost model
│   │   │
│   │   └── kafka-internals/
│   │       ├── index.jsx              # Post prose + layout
│   │       ├── PartitionFlow.jsx      # Hero — partitioner, append, consumer lag
│   │       ├── LogSegmentExplorer.jsx # Segment files + sparse .index offset lookup
│   │       ├── ConsumerGroupSim.jsx   # Group assignment across four assignors
│   │       ├── RebalanceRace.jsx      # Eager vs cooperative rebalance timelines
│   │       ├── ISRReplication.jsx     # 3-broker ISR, acks, high watermark
│   │       ├── LogCompaction.jsx      # Log cleaner pass + tombstones
│   │       └── ExactlyOnceSim.jsx     # Idempotent producer + transaction/LSO
│   │
│   ├── components/
│   │   ├── Layout.jsx                 # Nav, footer, reading width wrapper
│   │   ├── PostCard.jsx               # Card used on the homepage listing
│   │   └── PostHeader.jsx             # Title, date, tags, reading time
│   │
│   ├── registry.js                    # Source of truth — all post metadata
│   └── App.jsx                        # Router, homepage, 404
│
├── public/
│   └── og/                            # Open Graph images per post
│
├── index.html
├── vite.config.js
├── tailwind.config.js
└── package.json
```

---

## Adding a New Post

**1. Create the folder**

```bash
mkdir src/posts/your-post-slug
```

**2. Write the component**

```jsx
// src/posts/your-post-slug/index.jsx
import PostHeader from '../../components/PostHeader';

export default function YourPost() {
  return (
    <article className="prose prose-neutral max-w-none">
      <PostHeader
        title="Your Post Title"
        date="2025-08-10"
        tags={['distributed-systems', 'go']}
        readingTime="8 min"
      />

      <p>Your post content here...</p>

      {/* Drop in your visualizer component */}
      <YourVisualizer />
    </article>
  );
}
```

**3. Register it**

```js
// src/registry.js
{
  slug: 'your-post-slug',
  title: 'Your Post Title',
  date: '2025-08-10',
  description: 'One sentence that shows up on the homepage card and in OG meta.',
  tags: ['distributed-systems', 'go'],
  readingTime: '8 min',
  component: lazy(() => import('./posts/your-post-slug')),
}
```

That's it. Push to main. Vercel deploys in ~25 seconds.

---

## Posts Roadmap

### Published
- **PostgreSQL Storage Internals** — MVCC, dead tuples, autovacuum, and query planning demystified with three embedded interactive visualizers.
- **Kafka Beyond the Basics** — the log on disk, consumer group assignment, rebalancing, ISR and the high watermark, log compaction, and exactly-once, with seven embedded visualizers.
- **TCP From the Inside** — handshake and teardown, RTO and fast retransmit, flow control vs congestion control, the state machine and TIME_WAIT, the Linux kernel path (`sk_buff`, `tcp_sendmsg`, NAPI, eBPF tracepoints), and the production gotchas, with seven embedded visualizers.

### Planned
- Consistent hashing — deep-dive companion to [hash.string-wise.com](https://hash.string-wise.com)
- Raft consensus — deep-dive companion to [raft.string-wise.com](https://raft.string-wise.com)
- eBPF for application developers — what kprobes actually see
- Go memory model — a visual guide to happens-before

---

## Postgres Post — Visualizer Specs

The postgres post ships with three embedded interactive components. Documented here so each can be built and tested independently before being wired into the post.

### 1. `MVCCVisualizer`

Shows a storage page as a grid of tuples (rows). User can INSERT, UPDATE, and DELETE rows and watch live/dead tuple counts change in real time. VACUUM button reclaims dead space visually.

Key metrics displayed: live tuples, dead tuples, bloat ratio, autovacuum threshold progress bar.

### 2. `AutovacuumSim`

A time-based simulation. The user controls the UPDATE rate (rows/sec), `autovacuum_vacuum_scale_factor`, `autovacuum_vacuum_cost_delay`, and table size. A live chart plots dead tuples over time. Autovacuum trigger events are shown as vertical lines on the chart. If the update rate overwhelms the vacuum speed, bloat accumulates and a warning fires.

The point: make it viscerally obvious that default autovacuum settings are too conservative for large, high-churn tables.

### 3. `QueryPlanExplainer`

Shows the Postgres cost model for choosing between a Sequential Scan and an Index Scan. User sets table size, WHERE clause selectivity, and `random_page_cost`. Both plan costs are computed live using the real Postgres formulas and shown as cards — winner highlighted.

The point: developers almost never understand why Postgres ignores their index. This makes it obvious.

---

## Kafka Post — Visualizer Specs

Seven embedded components, all plain React + SVG/CSS — no charting dependency.

### 1. `PartitionFlow` (hero)

Producer → partitioner → partition log. Toggle between a keyed record (`murmur2(key) % numPartitions`) and a null key (sticky partitioner). Slider changes the partition count. Records append to the tail of a partition; a consumer walks behind them and lag is computed live.

The point: partition choice happens on the client, and ordering is per-partition, never per-topic.

### 2. `LogSegmentExplorer`

A partition directory of three segments with their `.log`, `.index` and `.timeindex` files. Pick a target offset and step through the real lookup path: binary search the segment base offsets, binary search the sparse index, seek to the byte position, scan forward.

The point: an offset is a position, and the sparse index is why seeking into a 1 GB segment is cheap.

### 3. `ConsumerGroupSim`

N consumers, M partitions, four assignors (Range, RoundRobin, Sticky, CooperativeSticky). Sliders change group size and partition count; a churn counter shows how many partitions changed hands, and per-partition lag ticks live. Idle consumers are called out when members exceed partitions.

The point: Kafka balances partitions, not messages — and the assignment is computed by the group leader, a consumer.

### 4. `RebalanceRace`

Side-by-side tick timelines for the same event (a fourth consumer joining a group of three owning six partitions). Eager pauses every partition; cooperative-sticky revokes only the two that move. Green = processing, red = revoked. A partition-tick counter quantifies the gap.

The point: eager rebalance stops the world for partitions that were never going to move.

### 5. `ISRReplication`

Three brokers, one leader and two followers, replicating on a tick loop. Toggle `acks` between `0`, `1` and `all`. Stall a follower to push it past `replica.lag.time.max.ms` and watch the ISR shrink, the high watermark stall, and the `min.insync.replicas` guard trip.

The point: `acks=all` means "all *current* ISR members" — without `min.insync.replicas` it silently degrades to `acks=1`.

### 6. `LogCompaction`

A keyed log split into a cleanable region and an untouchable active segment. Append records and tombstones, then run the cleaner: superseded records vanish, offsets stay unrenumbered with gaps, and tombstones are purged only on a later pass. A materialized-view panel shows the table the log converges to.

The point: compaction is key-based and orthogonal to time-based retention, and the active segment is never compacted.

### 7. `ExactlyOnceSim`

Two panels. First: a produce whose ACK is lost, with `enable.idempotence` toggleable — off appends a silent duplicate, on returns `DUPLICATE_SEQUENCE_NUMBER`. Second: a step-through transaction across two data topics plus `__consumer_offsets`, showing records sitting above the LSO until the commit marker lands.

The point: exactly-once is a *processing* guarantee bounded by Kafka, not a delivery guarantee.

---

## Deployment

Build and run the production container on the Raspberry Pi. It serves the static app through Nginx on port `3006`, supports direct React Router URLs, and restarts automatically after reboots.

```bash
docker compose up -d --build
docker compose ps
```

Point `string-wise.com` (or your reverse proxy) at the Pi and forward traffic to port `3006`. Enable Docker at boot with `sudo systemctl enable --now docker`. See [SETUP.md](SETUP.md) for the full deployment workflow.

---

## Design Principles

- **Prose first.** The writing carries the post. Visualizers support understanding, they don't replace explanation.
- **The homepage is a portfolio; the posts are the proof.** Skills, experience and projects live on `/`, but the writing is what the site is actually for. No newsletter popups, no testimonials, no skill-percentage bars.
- **One page, no new routes.** `allRoutes` in `src/seo.js` is derived from the post registry and `nginx.conf` has no SPA fallback, so a route the prerenderer never emitted returns a real 404 in production. Portfolio sections are anchors on `/`, not separate routes. Keep it that way unless you also teach `seo.js` about the new route.
- **Tokens, not hex.** Every colour comes from the CSS custom properties at the top of `src/index.css`. Both themes are defined there and nowhere else; a hardcoded hex in a component is a bug waiting for the next palette change.
- **Fast.** Static output, lazy-loaded post components, no runtime data fetching. Lighthouse 100 is the target.
- **Visualizers are native.** Not iframes, not embeds. The interactive component is part of the post component tree — same styles, same fonts, same feel.

## Editing the portfolio

All homepage content lives in **`src/portfolio.js`** — profile, status lines, "now", skills, experience, projects, contact. The components under `src/components/portfolio/` are layout only.

Anything left marked `TODO` renders on the live site in a loud red with a dotted underline (`.pf-todo`), so unfinished copy is impossible to miss. Values that are `null` — a contact link, an employment date — are simply not rendered rather than shipping a dead `mailto:` or a placeholder.

---

## Author

**Vaibhav Bhardwaj** — Senior Software Developer @ Bharti Airtel  
Building distributed systems tooling and writing about it at string-wise.com

[LinkedIn](https://www.linkedin.com/in/vaibhav-bhardwaj-a0554a1b8/) · [GitHub](https://github.com/VA-ibh-AV)
