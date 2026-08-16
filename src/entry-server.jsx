import { StrictMode } from 'react'
import { Writable } from 'node:stream'
import { renderToPipeableStream } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'
import App from './App'

export { allRoutes, metaForPath, sitemapEntries, SITE } from './seo'

/**
 * Render one route to static HTML.
 *
 * renderToPipeableStream (not renderToString) because the post components and
 * their visualizers are behind React.lazy — onAllReady waits for every lazy
 * chunk and Suspense boundary to resolve, so the real prose ends up in the
 * markup instead of a fallback.
 */
export function render(url) {
  return new Promise((resolve, reject) => {
    const chunks = []
    const sink = new Writable({
      write(chunk, _enc, cb) { chunks.push(Buffer.from(chunk)); cb() },
    })
    sink.on('finish', () => resolve(Buffer.concat(chunks).toString('utf8')))

    let settled = false
    const { pipe, abort } = renderToPipeableStream(
      <StrictMode>
        <StaticRouter location={url}>
          <App />
        </StaticRouter>
      </StrictMode>,
      {
        onAllReady() { settled = true; clearTimeout(timeout); pipe(sink) },
        onError(err) { settled = true; clearTimeout(timeout); reject(err) },
      }
    )

    const timeout = setTimeout(() => {
      if (settled) return
      abort()
      reject(new Error(`prerender timed out for ${url}`))
    }, 20000)
  })
}
