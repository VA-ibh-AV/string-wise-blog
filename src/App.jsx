import { Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import registry from './registry'
import useDocumentMeta from './useDocumentMeta'

function PostLoader({ post }) {
  const Component = post.component
  return (
    <Suspense fallback={<PostSkeleton />}>
      <Component />
    </Suspense>
  )
}

/**
 * Mirrors PostHeader's geometry (back link, meta row, title, tags, rule) so the
 * swap to the real post doesn't shift anything. Shares .article-shell, which
 * centres itself, rather than relying on the article's mx-auto.
 */
function PostSkeleton() {
  return (
    <div className="article-shell" aria-busy="true" aria-label="Loading post">
      <div className="skeleton-bar" style={{ height: 11, width: 128, marginBottom: 30 }} />
      <div className="skeleton-bar" style={{ height: 10, width: 210, marginBottom: 18 }} />
      <div className="skeleton-bar" style={{ height: 38, width: '78%', marginBottom: 12 }} />
      <div className="skeleton-bar" style={{ height: 38, width: '46%', marginBottom: 22 }} />
      <div style={{ display: 'flex', gap: 6, marginBottom: 38 }}>
        <div className="skeleton-bar" style={{ height: 22, width: 64 }} />
        <div className="skeleton-bar" style={{ height: 22, width: 96 }} />
        <div className="skeleton-bar" style={{ height: 22, width: 72 }} />
      </div>
      {['100%', '96%', '88%', '92%', '61%'].map((w, i) => (
        <div key={i} className="skeleton-bar" style={{ height: 13, width: w, marginBottom: 12 }} />
      ))}
    </div>
  )
}

export default function App() {
  useDocumentMeta()

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        {registry
          .filter(p => p.type === 'post')
          .map(post => (
            <Route
              key={post.slug}
              path={`/${post.slug}`}
              element={<PostLoader post={post} />}
            />
          ))}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  )
}

function NotFound() {
  return (
    <div className="not-found">
      <p className="micro-label">404 / signal lost</p>
      <h1>page not found</h1>
      <a href="/" className="back-link">← back to field notes</a>
    </div>
  )
}
