# string-wise-blog — Setup & Deployment

## Local Development

```bash
# Install dependencies
npm install

# Start the dev server (http://localhost:3006)
npm run dev

# Build for production
npm run build

# Preview the production build locally
npm run preview
```

The dev server hot-reloads on file changes. Edit any React component and the browser updates instantly.

---

## Project Layout

```
src/
  App.jsx                 # Router, lazy loads posts
  main.jsx                # React entry point / hydration
  entry-server.jsx        # SSR render used by the prerenderer
  registry.js             # Single source of truth for all posts
  seo.js                  # SITE metadata, allRoutes, per-path head tags
  portfolio.js            # Homepage content — the file to edit
  index.css               # Theme tokens + all site and visualizer CSS
  components/
    Layout.jsx            # Nav, footer, theme toggle
    PostCard.jsx          # Writing-section listing card
    PostHeader.jsx        # Title, date, tags bar
    CodeBlock.jsx         # Prism-highlighted code block
    Tag.jsx               # Tag badge component
    portfolio/            # Homepage sections (layout only, content from portfolio.js)
      Hero.jsx  NowBlock.jsx  SkillGrid.jsx
      ExperienceTimeline.jsx  ProjectGrid.jsx  ContactBlock.jsx
      Section.jsx  Copy.jsx
  pages/
    Home.jsx              # Single-page portfolio + the writing list
  posts/
    postgres-internals/   # index.jsx + 3 visualizers
    kafka-internals/      # index.jsx + 7 visualizers
    tcp-internals/        # index.jsx + 7 visualizers
scripts/
  prerender.mjs           # Writes dist/<route>/index.html, sitemap, robots
  og/                     # OG card sources + regeneration steps
```

---

## Adding a New Post

1. **Create the folder:**
   ```bash
   mkdir src/posts/your-slug
   ```

2. **Write the post component** (`src/posts/your-slug/index.jsx`):
   ```jsx
   import PostHeader from '../../components/PostHeader'

   export default function YourPost() {
     return (
       <article className="prose prose-neutral max-w-2xl mx-auto px-6 py-16">
         <PostHeader
           title="Your Title"
           date="2025-08-15"
           tags={['tag1', 'tag2']}
           readingTime="8 min"
         />
         <p>Your post content...</p>
       </article>
     )
   }
   ```

3. **Register it in `registry.js`:**
   ```js
   {
     slug: 'your-slug',
     type: 'post',
     title: 'Your Title',
     date: '2025-08-15',
     description: 'One-liner for homepage card',
     tags: ['tag1', 'tag2'],
     readingTime: '8 min',
     component: lazy(() => import('./posts/your-slug')),
   }
   ```

4. **Push to deploy** — Vercel auto-deploys on git push.

---

## Styling

**Tailwind CSS** is fully configured. All components use utility classes:

- `prose prose-neutral` — typography styles on `<article>`
- `viz-card` — visualizer container styling
- `btn-sim`, `btn-sim-accent`, `btn-sim-danger` — button styles
- `slider-row`, `stat-card`, `sim-log` — visualizer component utilities

**Most styling lives in `src/index.css`, not in Tailwind classes.** The classes above are defined in a hand-written `@layer components` block there, on top of a set of CSS custom properties that define both themes:

- `:root` — the light (warm paper) theme
- `:root[data-theme='dark']` — the dark theme, which is the **default** for a first-time visitor
- The theme is applied by an inline pre-paint script in `index.html` and toggled by `ThemeToggle` in `src/components/Layout.jsx`. **Those two must resolve the theme identically** or the prerendered markup mismatches on hydration.

Never hardcode a colour in a component — use `var(--accent)`, `var(--ink-dim)`, `var(--surface-muted)` and friends, so both themes follow automatically.

`tailwind.config.js` holds the rest:

- `accent.*` colour scale (amber, mirroring `--accent`) — only used by `accent-*` utilities hardcoded inside older visualizers
- Custom fonts: Inter (body), JetBrains Mono (code/headers)
- Typography plugin overrides, pointed at the same custom properties

---

## Docker deployment

The production container builds the Vite app once and serves the static output through Nginx. It listens on host port `3006`, supports React Router routes, and uses `restart: unless-stopped` so it comes back after Raspberry Pi reboots.

```bash
# Build and start in the background
docker compose up -d --build

# Check status and logs
docker compose ps
docker compose logs -f string-wise-blog
```

Open `http://localhost:3006` or point `string-wise.com` at the Raspberry Pi/reverse proxy that forwards to port `3006`.

Make sure Docker itself starts at boot:

```bash
sudo systemctl enable --now docker
```

To update after code changes:

```bash
docker compose up -d --build
```

## Deployment to Vercel

**Prerequisites:**
- GitHub repo with this code pushed
- Vercel account (free tier is fine)

**Steps:**

1. Go to [vercel.com](https://vercel.com)
2. Click "Import Project"
3. Paste your GitHub repo URL
4. Click "Import"
5. No build config needed — `vercel.json` already specifies everything
6. Click "Deploy"

**Add a custom domain:**
1. After deployment, go to your Vercel project settings
2. Add a custom domain (e.g., `blog.string-wise.com`)
3. Update your DNS records to point to Vercel's IP
4. Vercel handles SSL automatically

Every push to `main` triggers an auto-deploy.

---

## Environment

No environment variables needed. This is a fully static site — no backend, no database, no secrets.

---

## Performance Targets

- Lighthouse score: 98+ (aim for 100)
- First Contentful Paint: <1s
- Time to Interactive: <2s
- Bundle size: <150kb gzipped (recharts adds ~40kb)

The site is built as static HTML/CSS/JS. No runtime data fetching. Visualizers are all client-side React.

---

## Troubleshooting

**"Module not found" errors:**
```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

**Vercel build fails:**
Check the build logs in your Vercel dashboard. Most common issue: missing import or typo in `registry.js`.

**Localhost won't start:**
```bash
# Kill any existing process on port 3006
lsof -i :3006
kill -9 <PID>

# Then retry
npm run dev
```

**Charts not rendering:**
There is no chart library — every chart is hand-rolled inline SVG using the `.sim-chart-*` classes. A blank chart almost always means the series has fewer than two points, since `<polyline>` with a single point draws nothing.

**A new route 404s in production but works in `npm run dev`:**
`allRoutes` in `src/seo.js` is derived from the post registry, so the prerenderer never emitted HTML for your route, and `nginx.conf` has no SPA fallback. Either add the route to `allRoutes` and `metaForPath`, or make it an anchor section on `/` instead.

**Hydration mismatch warnings in the console:**
Usually the theme. The inline pre-paint script in `index.html` and the `useState` initializer in `ThemeToggle` must resolve to the same value. Both default to dark when nothing is saved.

**The build fails during prerender:**
`npm run build` renders every route through `renderToPipeableStream`. A component that touches `window` or `localStorage` at module scope or during render will crash the build rather than just the page — guard it with `typeof window === 'undefined'`.

---

## Extending the Blog

**Add a new visualizer to an existing post:**
- Create the component (e.g., `MyVisualizer.jsx`)
- Import it in the post file
- Drop it in where you want it in the article

**Link to external projects:**
In `registry.js`, set `type: 'external'` and `href`. The card will open in a new tab.

**Customize colors:**
Edit the accent color palette in `tailwind.config.js`. All `text-accent-*` and `bg-accent-*` classes will update automatically.

---

## Publishing Your First Post

Before pushing:

1. Test locally: `npm run dev` and read the full post in your browser
2. Check for typos and broken code blocks
3. Verify all visualizers are interactive and smooth
4. Take a screenshot for social media
5. Draft your LinkedIn/Twitter post
6. Push to main
7. Share the Vercel URL

Good luck! 🚀
