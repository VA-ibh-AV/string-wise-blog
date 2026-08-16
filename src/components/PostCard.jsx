import { Link } from 'react-router-dom'
import Tag from './Tag'

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export default function PostCard({ post, index }) {
  const isExternal = post.type === 'external'
  const href = isExternal ? post.href : `/${post.slug}`
  const cardClass = `post-card ${index === 0 ? 'post-card-featured' : ''}`

  const inner = (
    <article className={cardClass} style={{ animationDelay: `${index * 70}ms` }}>
      <div className="post-card-top">
        <span className="post-index">{String(index + 1).padStart(2, '0')} / {isExternal ? 'visualizer' : 'essay'}</span>
        <span className="post-date">{formatDate(post.date)}</span>
      </div>

      <div className="post-card-body">
        <h3>{post.title}<span className="post-arrow">↗</span></h3>
        <p>{post.description}</p>
      </div>

      <div className="post-card-footer">
        <div className="tag-list">{post.tags.map(tag => <Tag key={tag}>{tag}</Tag>)}</div>
        <span className="reading-time">{post.readingTime}<span> read</span></span>
      </div>
    </article>
  )

  if (isExternal) {
    return <a href={href} target="_blank" rel="noopener noreferrer" className="post-card-link">{inner}</a>
  }

  return <Link to={href} className="post-card-link">{inner}</Link>
}
