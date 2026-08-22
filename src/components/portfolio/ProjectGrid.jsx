import Copy from './Copy'
import Section from './Section'
import Tag from '../Tag'
import { projects } from '../../portfolio'

/**
 * Project cards. Each one carries a "what was hard" line, which is the part
 * most portfolios leave out and the only part worth reading.
 *
 * A project without an `href` renders as a plain card rather than a dead link.
 */
export default function ProjectGrid() {
  return (
    <Section id="work" index={4} title="Work" count={`${projects.length} projects`}
             lede="Things I built that you can poke at, and one or two you cannot.">
      <div className="proj-grid">
        {projects.map((p, i) => {
          const body = (
            <>
              <div className="proj-top">
                <span className="proj-status">{p.status}</span>
                {p.href && <span className="post-arrow">↗</span>}
              </div>
              <h3 className="proj-name"><Copy>{p.name}</Copy></h3>
              <p className="proj-blurb"><Copy>{p.blurb}</Copy></p>
              <p className="proj-hard"><b>hard part —</b> <Copy>{p.hard}</Copy></p>
              <div className="tag-list">
                {p.stack.map((s, j) => <Tag key={`${s}-${j}`}><Copy>{s}</Copy></Tag>)}
              </div>
            </>
          )

          return p.href ? (
            <a className="proj-card" key={p.name} href={p.href} target="_blank" rel="noopener noreferrer"
               style={{ animationDelay: `${i * 70}ms` }}>
              {body}
            </a>
          ) : (
            <div className="proj-card" key={p.name} style={{ animationDelay: `${i * 70}ms` }}>
              {body}
            </div>
          )
        })}
      </div>
    </Section>
  )
}
