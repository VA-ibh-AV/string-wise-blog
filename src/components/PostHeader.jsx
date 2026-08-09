import { Link } from 'react-router-dom'
import Tag from './Tag'

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year:  'numeric',
    month: 'long',
    day:   'numeric',
  })
}

export default function PostHeader({ title, date, tags = [], readingTime }) {
  return (
    <div className="not-prose mb-14">
      <Link
        to="/"
        className="font-mono text-xs text-zinc-400 hover:text-accent-600 transition-colors mb-8 inline-flex items-center gap-1.5"
      >
        ← string-wise
      </Link>

      <div className="flex items-center gap-3 mb-5 mt-6">
        <span className="font-mono text-xs text-zinc-400">{formatDate(date)}</span>
        <span className="text-zinc-200">·</span>
        <span className="font-mono text-xs text-zinc-400">{readingTime} read</span>
      </div>

      <h1 className="font-mono text-3xl font-bold text-zinc-900 leading-tight mb-5 tracking-tight">
        {title}
      </h1>

      <div className="flex flex-wrap gap-2">
        {tags.map(tag => <Tag key={tag}>{tag}</Tag>)}
      </div>

      <hr className="border-zinc-200 mt-10" />
    </div>
  )
}
