import Copy from './Copy'
import { profile, status } from '../../portfolio'

/**
 * Homepage hero — name and pitch on the left, a status readout on the right.
 *
 * Keeps the existing `.hero-section` grid and `.signal-card` panel rather than
 * inventing a new shape; the twelve-bar `.signal-wave` at the bottom of the
 * card is the one place the studio reference shows up.
 */
export default function Hero() {
  return (
    <section className="hero-section">
      <div className="hero-copy">
        <p className="eyebrow">
          <span className="eyebrow-dot" /> {profile.role} <span>/</span> {profile.company}
        </p>

        <h1>
          {profile.tagline.lead}<br />
          <em>{profile.tagline.accent}</em>
        </h1>

        <p className="hero-description">{profile.blurb}</p>

        <div className="hero-actions">
          <a href="#writing" className="primary-action">read the field notes <span>↓</span></a>
          <a href="#experience" className="secondary-action">what I&rsquo;ve worked on <span>↓</span></a>
        </div>
      </div>

      <div className="hero-aside">
        <div className="signal-card">
          <div className="signal-card-top">
            <span className="micro-label">signal / 001</span>
            <span className="live-badge"><span /> live</span>
          </div>

          {status.map(line => (
            <div className="signal-line" key={line.key}>
              <span className="signal-key">{line.key}</span>
              <span className={line.accent ? 'signal-accent' : undefined}>{line.value}</span>
            </div>
          ))}

          <div className="signal-wave" aria-hidden="true">
            <i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i />
          </div>
        </div>

        <div className="hero-aside-note">
          <Copy>{profile.location}</Copy><br />
          Systems, storage, and the layer under the abstraction.
        </div>
      </div>
    </section>
  )
}
