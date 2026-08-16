/**
 * Build-time prerender.
 *
 * Vite emits dist/index.html as an empty SPA shell — every route returned the
 * same contentless HTML, so link unfurlers (LinkedIn, Slack, X) and any crawler
 * that doesn't execute JS saw nothing at all. This renders each route to real
 * markup and writes per-route head tags, then emits sitemap.xml + robots.txt.
 *
 * Runs after `vite build` and `vite build --ssr`. See package.json.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root    = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(root, 'dist')
const ssrEntry = path.join(root, 'dist-ssr', 'entry-server.js')

const { render, allRoutes, metaForPath, sitemapEntries, SITE } = await import(ssrEntry)

const template = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8')

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

function headFor(meta) {
  const tags = [
    `<link rel="canonical" href="${esc(meta.canonical)}" />`,
    `<meta property="og:type" content="${meta.type}" />`,
    `<meta property="og:site_name" content="${esc(SITE.name)}" />`,
    `<meta property="og:locale" content="${SITE.locale}" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    `<meta property="og:description" content="${esc(meta.description)}" />`,
    `<meta property="og:url" content="${esc(meta.canonical)}" />`,
    `<meta name="twitter:card" content="${meta.image ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${esc(meta.title)}" />`,
    `<meta name="twitter:description" content="${esc(meta.description)}" />`,
    `<meta name="author" content="${esc(SITE.author)}" />`,
  ]

  if (meta.image) {
    tags.push(`<meta property="og:image" content="${esc(meta.image)}" />`)
    tags.push(`<meta name="twitter:image" content="${esc(meta.image)}" />`)
  }
  if (meta.type === 'article') {
    tags.push(`<meta property="article:published_time" content="${meta.published}" />`)
    tags.push(`<meta property="article:author" content="${esc(SITE.author)}" />`)
    ;(meta.tags ?? []).forEach(t => tags.push(`<meta property="article:tag" content="${esc(t)}" />`))
  }

  tags.push(
    `<script type="application/ld+json">${JSON.stringify(meta.jsonLd).replace(/</g, '\\u003c')}</script>`
  )

  return tags.map(t => `    ${t}`).join('\n')
}

function pageFor(appHtml, meta) {
  return template
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(meta.title)}</title>`)
    .replace(
      /<meta name="description"[^>]*\/?>/,
      `<meta name="description" content="${esc(meta.description)}" />`
    )
    .replace('</head>', `${headFor(meta)}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root">${appHtml}</div>`)
}

let written = 0
for (const route of allRoutes) {
  const meta = metaForPath(route)
  const appHtml = await render(route)
  const outPath = route === '/'
    ? path.join(distDir, 'index.html')
    : path.join(distDir, route.replace(/^\//, ''), 'index.html')

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, pageFor(appHtml, meta))
  written++
  console.log(`  prerendered ${route.padEnd(24)} → ${path.relative(root, outPath)} (${(appHtml.length / 1024).toFixed(1)} kB of markup)`)
}

// The SPA fallback nginx serves for unknown paths must NOT carry the homepage's
// prerendered markup, or a 404 would render the homepage with a stale <title>.
const fallbackMeta = metaForPath('/')
fs.writeFileSync(
  path.join(distDir, '404.html'),
  pageFor('', { ...fallbackMeta, title: `page not found — ${SITE.name}`, canonical: SITE.url + '/' })
)

fs.writeFileSync(
  path.join(distDir, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries.map(e => `  <url>
    <loc>${e.loc}</loc>
    <lastmod>${e.lastmod}</lastmod>
    <priority>${e.priority}</priority>
  </url>`).join('\n')}
</urlset>
`
)

fs.writeFileSync(
  path.join(distDir, 'robots.txt'),
  `User-agent: *\nAllow: /\n\nSitemap: ${SITE.url}/sitemap.xml\n`
)

console.log(`  prerendered ${written} route(s) + 404.html, sitemap.xml, robots.txt`)
