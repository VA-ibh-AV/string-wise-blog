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
    <div className="max-w-2xl mx-auto px-6 py-16 animate-pulse">
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
    <div className="max-w-2xl mx-auto px-6 py-32 text-center">
      <p className="font-mono text-zinc-400 text-sm mb-3">404</p>
      <h1 className="font-mono text-2xl font-bold text-zinc-900 mb-4">page not found</h1>
      <a href="/" className="text-accent-600 hover:text-accent-700 font-mono text-sm underline underline-offset-4">
        ← back to posts
      </a>
    </div>
  )
}
