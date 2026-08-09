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
| Deployment | Vercel | Auto-deploy on push, custom domain, free |

---

## Project Structure

```
string-wise-blog/
│
├── src/
│   ├── posts/
│   │   └── postgres-internals/
│   │       ├── index.jsx              # Post prose + layout
│   │       ├── MVCCVisualizer.jsx     # Live/dead tuple simulation
│   │       ├── AutovacuumSim.jsx      # Real-time autovacuum race simulation
│   │       └── QueryPlanExplainer.jsx # Seq scan vs index scan cost model
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
_None yet — first post incoming._

### In Progress
- **PostgreSQL Storage Internals** — MVCC, dead tuples, autovacuum, and query planning demystified with three embedded interactive visualizers.

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

## Deployment

The project deploys to Vercel. Every push to `main` triggers a production deploy.

```bash
# Local dev
npm install
npm run dev

# Production build (what Vercel runs)
npm run build
```

**Domain setup on Vercel:**
1. Add `string-wise.com` as a custom domain in the Vercel project settings
2. Update your DNS A record to point to Vercel's IP
3. Vercel handles SSL automatically

---

## Design Principles

- **Prose first.** The writing carries the post. Visualizers support understanding, they don't replace explanation.
- **No fluff.** No hero banners, no author bio carousels, no newsletter popups. Just a clean list of posts and a clean reading experience.
- **Fast.** Static output, lazy-loaded post components, no runtime data fetching. Lighthouse 100 is the target.
- **Visualizers are native.** Not iframes, not embeds. The interactive component is part of the post component tree — same styles, same fonts, same feel.

---

## Author

**Vaibhav** — Senior Software Developer, AirCOP Central DevOps @ Bharti Airtel  
Building distributed systems tooling and writing about it at string-wise.com

[LinkedIn](https://www.linkedin.com/in/vaibhav-bhardwaj-a0554a1b8/) · [GitHub](https://github.com/)
