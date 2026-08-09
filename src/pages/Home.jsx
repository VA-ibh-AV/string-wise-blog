import registry from '../registry'
import PostCard from '../components/PostCard'

export default function Home() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-20">
      {/* Hero */}
      <div className="mb-16">
        <p className="font-mono text-zinc-400 text-sm mb-4 tracking-wide">
          writing by{' '}
          <a
            href="https://www.linkedin.com/in/vaibhav-bhardwaj-a0554a1b8/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-600 hover:text-accent-700 transition-colors"
          >
            Vaibhav on LinkedIn
          </a>
        </p>
        <h1 className="font-mono text-4xl font-bold text-zinc-900 leading-tight mb-5">
          string-wise
        </h1>
        <p className="text-zinc-500 text-base leading-relaxed max-w-lg">
          Deep dives into distributed systems, databases, and Go — with interactive
          visualizers you can actually play with.
        </p>
      </div>

      {/* Post list */}
      <div className="space-y-1">
        <p className="font-mono text-xs text-zinc-400 uppercase tracking-widest mb-6">
          posts
        </p>
        {registry.map((post, i) => (
          <PostCard key={post.slug} post={post} index={i} />
        ))}
      </div>
    </div>
  )
}
