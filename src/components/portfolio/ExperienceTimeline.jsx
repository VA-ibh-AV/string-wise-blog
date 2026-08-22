import Copy, { isTodo } from './Copy'
import Section from './Section'
import { experience } from '../../portfolio'

/**
 * `start: null` means the dates are not filled in yet — render nothing rather
 * than a placeholder. `end: null` on a started role means "present".
 */
function range(start, end) {
  if (!start) return null
  return `${start} — ${end ?? 'present'}`
}

export default function ExperienceTimeline() {
  return (
    <Section id="experience" index={3} title="Experience" count={`${experience.length} roles`}>
      <div className="tl">
        {experience.map((job, i) => (
          <article className="tl-item" key={`${job.company}-${i}`}>
            <div className="tl-rail">
              {range(job.start, job.end) && <span className="tl-date">{range(job.start, job.end)}</span>}
              {!isTodo(job.location) && <span className="tl-place">{job.location}</span>}
              {job.current && <span className="tl-current">current</span>}
            </div>

            <div>
              <h3 className="tl-role"><Copy>{job.role}</Copy></h3>
              <p className="tl-company"><Copy>{job.company}</Copy></p>
              <ul className="tl-bullets">
                {job.bullets.map((line, j) => (
                  <li key={j}><Copy>{line}</Copy></li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </div>
    </Section>
  )
}
