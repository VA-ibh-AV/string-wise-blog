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
  main.jsx                # React entry point
  registry.js             # Single source of truth for all posts
  index.css               # Tailwind directives + visualizer utilities
  components/
    Layout.jsx            # Nav, footer wrapper
    PostCard.jsx          # Homepage listing card
    PostHeader.jsx        # Title, date, tags bar
    Tag.jsx               # Tag badge component
  pages/
    Home.jsx              # Homepage — lists all posts
  posts/
    postgres-internals/
      index.jsx           # The full post article + prose
      MVCCVisualizer.jsx  # Live/dead tuple simulator
      AutovacuumSim.jsx   # Real-time autovacuum race
      QueryPlanExplainer.jsx  # Cost model visualizer
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

**No CSS files to edit.** Everything is Tailwind classes. The custom config is in `tailwind.config.js`:

- Accent color palette (blue-based)
- Custom fonts: Inter (body), JetBrains Mono (code/headers)
- Typography plugin with custom prose styling

---

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
Recharts requires `<ResponsiveContainer>` to have a defined height. Make sure parent div has explicit height (e.g., `h-44`).

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
