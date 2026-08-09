import { Link } from 'react-router-dom'
import Tag from './Tag'

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export default function PostHeader({ title, date, tags = [], readingTime }) {
  return (
    <div className="not-prose post-header">
      <Link to="/" className="back-link">← all field notes</Link>
      <div className="post-header-meta"><span>essay / {formatDate(date)}</span><span>•</span><span>{readingTime} read</span></div>
      <h1>{title}</h1>
      <div className="tag-list">{tags.map(tag => <Tag key={tag}>{tag}</Tag>)}</div>
      <hr />
    </div>
  )
}
