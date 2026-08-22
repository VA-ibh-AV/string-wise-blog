/**
 * Shared shell for a homepage section.
 *
 * Reuses the `.section-heading` / `.micro-label` / `.section-count` trio the
 * writing list already uses, so every band down the page is set the same way.
 */
export default function Section({ id, index, title, count, lede, children }) {
  return (
    <section id={id} className="pf-section">
      <div className="section-heading">
        <div>
          <p className="micro-label">{String(index).padStart(2, '0')} / {title.toLowerCase()}</p>
          <h2>{title}</h2>
        </div>
        {count != null && <span className="section-count">{count}</span>}
      </div>
      {lede && <p className="pf-lede">{lede}</p>}
      {children}
    </section>
  )
}
