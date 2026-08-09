import { Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import registry from './registry'

function PostLoader({ post }) {
  const Component = post.component
  return (
    <Suspense fallback={<PostSkeleton />}>
      <Component />
    </Suspense>
  )
}

function PostSkeleton() {
  return (
    <div className="article-shell animate-pulse">
      <div className="h-3 w-24 bg-zinc-200 rounded mb-6" />
      <div className="h-8 w-3/4 bg-zinc-200 rounded mb-4" />
      <div className="h-4 w-full bg-zinc-200 rounded mb-2" />
      <div className="h-4 w-5/6 bg-zinc-200 rounded mb-2" />
      <div className="h-4 w-4/6 bg-zinc-200 rounded" />
    </div>
  )
}

export default function App() {
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
