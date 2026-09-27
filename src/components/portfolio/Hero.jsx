import { useEffect, useRef } from 'react'
import Copy from './Copy'
import { profile, status } from '../../portfolio'

/**
 * Homepage hero — name and pitch on the left, a status readout on the right.
 *
 * Keeps the existing `.hero-section` grid and `.signal-card` panel rather than
 * inventing a new shape; the twelve-bar `.signal-wave` at the bottom of the
 * card is the one place the studio reference shows up.
 */
/**
 * A small solar system behind the hero's right column: a sun, three tilted
 * orbits, and a planet travelling each one (SVG animateMotion along the
 * ellipse). It prerenders as-is; under prefers-reduced-motion the SVG's
 * animation clock is paused after hydration, so the planets stay put.
 */
const ORBITS = [
  { rx: 120, ry: 44, r: 7,  fill: '#8fb8ff', dur: 38, begin: 4 },
  { rx: 190, ry: 70, r: 10, fill: '#9ef0b8', dur: 64, begin: 30 },
  { rx: 255, ry: 96, r: 5,  fill: '#ff9d8a', dur: 110, begin: 70 },
]

function Orbits() {
  const ref = useRef(null)
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) ref.current?.pauseAnimations?.()
  }, [])
  const cx = 280, cy = 260
  return (
    <svg ref={ref} className="hero-orbits" viewBox="0 0 560 520" aria-hidden="true">
      <defs>
        <radialGradient id="hero-sun" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff4cf" />
          <stop offset="45%" stopColor="#ffd37a" />
          <stop offset="100%" stopColor="#ffd37a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r="90" fill="url(#hero-sun)" opacity=".3" />
      <circle cx={cx} cy={cy} r="22" fill="#ffd37a" />
      <g transform={`rotate(-18 ${cx} ${cy})`}>
        {ORBITS.map(o => {
          const path = `M${cx - o.rx},${cy} a${o.rx},${o.ry} 0 1,0 ${2 * o.rx},0 a${o.rx},${o.ry} 0 1,0 ${-2 * o.rx},0`
          return (
            <g key={o.rx}>
              <path className="orbit-ring" d={path} />
              <circle r={o.r} fill={o.fill}>
                <animateMotion dur={`${o.dur}s`} begin={`-${o.begin}s`} repeatCount="indefinite" path={path} />
              </circle>
            </g>
          )
        })}
      </g>
    </svg>
  )
}

export default function Hero() {
  return (
    <section className="hero-section">
      <Orbits />
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
