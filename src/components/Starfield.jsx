import { mulberry32 } from '../lib/rng'

/**
 * The fixed star layer behind every page. Stars come from a seeded PRNG, so
 * the prerendered markup and the hydrated markup are identical. Everything
 * that moves is CSS (twinkle, one shooting star), and all of it stops under
 * prefers-reduced-motion. No timers, no canvas, no scroll listeners.
 */

const W = 1600
const H = 1000

function makeStars() {
  const rand = mulberry32(20260927)
  const layers = [
    { n: 170, r: [0.5, 0.9], o: [0.25, 0.6] },   // dust
    { n: 60,  r: [0.9, 1.4], o: [0.45, 0.8] },   // stars
    { n: 12,  r: [1.5, 2.1], o: [0.8, 1] },      // bright ones
  ]
  const stars = []
  layers.forEach((l, li) => {
    for (let i = 0; i < l.n; i++) {
      stars.push({
        x: +(rand() * W).toFixed(1),
        y: +(rand() * H).toFixed(1),
        r: +(l.r[0] + rand() * (l.r[1] - l.r[0])).toFixed(2),
        o: +(l.o[0] + rand() * (l.o[1] - l.o[0])).toFixed(2),
        // roughly one star in five twinkles, each on its own phase
        twinkle: li > 0 && rand() < 0.35 ? +(rand() * 5).toFixed(2) : null,
      })
    }
  })
  return stars
}

const STARS = makeStars()

export default function Starfield() {
  return (
    <div className="starfield" aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
        {STARS.map((s, i) => (
          <circle
            key={i}
            cx={s.x} cy={s.y} r={s.r}
            className={s.twinkle != null ? 'star star-twinkle' : 'star'}
            style={s.twinkle != null ? { opacity: s.o, animationDelay: `-${s.twinkle}s` } : { opacity: s.o }}
          />
        ))}
      </svg>
      <span className="shooting-star" />
    </div>
  )
}
