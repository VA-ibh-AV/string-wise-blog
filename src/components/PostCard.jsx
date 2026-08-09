import { Link } from 'react-router-dom'
import Tag from './Tag'

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year:  'numeric',
    month: 'short',
    day:   'numeric',
  })
}

export default function PostCard({ post, index }) {
  const isExternal = post.type === 'external'
  const href = isExternal ? post.href : `/${post.slug}`

  const inner = (
    <div
      className="group py-6 border-b border-zinc-200 cursor-pointer"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex items-start justify-between gap-4 mb-2">
        <h2 className="font-mono text-base font-semibold text-zinc-900 group-hover:text-accent-600 transition-colors leading-snug">
          {post.title}
          {isExternal && (
            <span className="ml-2 text-zinc-300 group-hover:text-accent-300 transition-colors text-sm">
              ↗
            </span>
          )}
        </h2>
        <span className="font-mono text-xs text-zinc-400 whitespace-nowrap pt-0.5 shrink-0">
          {formatDate(post.date)}
        </span>
      </div>

      <p className="text-sm text-zinc-500 leading-relaxed mb-3 max-w-xl">
        {post.description}
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        {post.tags.map(tag => <Tag key={tag}>{tag}</Tag>)}
        <span className="ml-auto font-mono text-[11px] text-zinc-400">
          {post.readingTime}
        </span>
      </div>
    </div>
  )

  if (isExternal) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="block no-underline">
        {inner}
      </a>
    )
  }

  return (
    <Link to={href} className="block no-underline">
      {inner}
    </Link>
  )
}
