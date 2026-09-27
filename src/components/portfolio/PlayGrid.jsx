import Copy from './Copy'
import Section from './Section'
import Tag from '../Tag'
import { playgrounds, PLAY_URL } from '../../portfolio'

/**
 * Cards for play.string-wise.com. Each card gets a small night sky that
 * hints at its playground. The sky stays dark in both themes, the same way
 * code blocks do. Open playgrounds link out; "soon" ones render dimmed and
 * unlinked, so there is never a dead link.
 */

// deterministic star field, so the prerendered markup matches hydration
const STARS = Array.from({ length: 22 }, (_, i) => ({
  x: (i * 73 + 17) % 300,
  y: (i * 41 + 9) % 96,
  r: i % 5 === 0 ? 1.2 : 0.7,
}))

function Art({ kind }) {
  return (
    <svg viewBox="0 0 300 96" className="play-art" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      {STARS.map((s, i) => <circle key={i} cx={s.x} cy={s.y} r={s.r} className="play-star" />)}
      {kind === 'cosmos' && (
        <g>
          <circle cx="150" cy="50" r="30" className="play-orbit" />
          <circle cx="150" cy="50" r="12" fill="#5fd4e6" />
          <ellipse cx="80" cy="58" rx="26" ry="7" fill="none" stroke="#8fa6ff" strokeWidth="1.5" />
          <circle cx="80" cy="58" r="14" fill="#6f8dff" />
          <circle cx="222" cy="36" r="6" fill="#ff7a6b" />
          <circle cx="248" cy="70" r="7" fill="#7fe0b8" />
          <circle cx="40" cy="30" r="8" fill="none" stroke="#c9906b" strokeWidth="1.2" />
        </g>
      )}
      {kind === 'garden' && (
        <g strokeWidth="1" fill="none">
          <path d="M40 30 L90 44 L130 26 L160 52 L200 50 L240 28 M40 72 L90 60 L130 74 L160 52 M200 50 L244 52 M200 50 L240 76" stroke="#6d7fc9" />
          {[[40, 30, '#ff8fb8'], [90, 44, '#ffd37a'], [130, 26, '#ffd37a'], [40, 72, '#ff8fb8'], [90, 60, '#ffd37a'], [130, 74, '#ffd37a'], [160, 52, '#ffffff'], [200, 50, '#7fe0b8'], [240, 28, '#6f8dff'], [244, 52, '#6f8dff'], [240, 76, '#6f8dff']]
            .map(([x, y, c], i) => <circle key={i} cx={x} cy={y} r={i > 7 ? 6 : 3.5} fill={c} stroke="none" />)}
        </g>
      )}
      {kind === 'lanterns' && (
        <g>
          <path d="M20 40 Q150 70 280 40" fill="none" stroke="#c98a55" strokeWidth="1" opacity=".6" />
          {[60, 110, 160, 210, 250].map((x, i) => <circle key={x} cx={x} cy={46 + Math.sin(i) * 8 + 8} r="5" fill="#ffb86b" opacity={0.35 + i * 0.12} />)}
        </g>
      )}
      {kind === 'choir' && (
        <g fill="none" stroke="#9d8cff" strokeWidth="1.2" opacity=".75">
          {[14, 26, 38].map(r => <circle key={r} cx="150" cy="50" r={r} />)}
          <circle cx="150" cy="50" r="5" fill="#c9bfff" stroke="none" />
        </g>
      )}
      {kind === 'zen' && (
        <g fill="none" stroke="#8fa0b8" strokeWidth="1" opacity=".7">
          {[40, 50, 60, 70].map(y => <path key={y} d={`M20 ${y} Q150 ${y - 12} 280 ${y}`} />)}
          <circle cx="210" cy="48" r="9" fill="#46546a" stroke="none" />
        </g>
      )}
      {kind === 'drift' && (
        <g>
          <path d="M30 66 C 90 20, 150 90, 210 40 S 262 40, 276 30" fill="none" stroke="#6d7fc9" strokeWidth="1" strokeDasharray="3 5" />
          {[[30, 66], [104, 50], [170, 58], [232, 38]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="3" fill="#8fa6ff" />)}
          <path d="M268 26 l12 4 l-12 4 l3 -4 z" fill="#ffd37a" />
          <circle cx="276" cy="30" r="9" fill="#ffd37a" opacity=".15" />
        </g>
      )}
      {kind === 'orbit' && (
        <g>
          {[16, 28, 40].map(r => <circle key={r} cx="150" cy="50" r={r} fill="none" stroke="rgba(255,255,255,.14)" />)}
          <circle cx="150" cy="50" r="6" fill="#ffd37a" />
          <circle cx="166" cy="50" r="3.5" fill="#ff8fb8" />
          <circle cx="130" cy="30" r="4" fill="#7fe0b8" />
          <circle cx="150" cy="90" r="4.5" fill="#8fa6ff" />
          {[0, 1, 2, 3, 4].map(i => <rect key={i} x={36 + i * 12} y={62 - (i % 3) * 10} width="6" height={14 + (i % 3) * 10} rx="2" fill="#9d8cff" opacity=".55" />)}
          {[0, 1, 2, 3, 4].map(i => <rect key={i} x={218 + i * 12} y={52 - ((i + 1) % 3) * 8} width="6" height={20 + ((i + 1) % 3) * 8} rx="2" fill="#5fd4e6" opacity=".45" />)}
        </g>
      )}
    </svg>
  )
}

export default function PlayGrid() {
  const open = playgrounds.filter(p => p.path).length
  return (
    <Section id="play" index={5} title="Play" count={`${open} open · ${playgrounds.length - open} soon`}
             lede={<>Calm playgrounds for systems internals at <a href={PLAY_URL} target="_blank" rel="noopener noreferrer" className="play-lede-link">play.string-wise.com ↗</a>. No score, no timer, no way to lose. A few minutes each, and you leave knowing something real.</>}>
      <div className="play-grid">
        {playgrounds.map((p, i) => {
          const body = (
            <>
              <Art kind={p.art} />
              <div className="play-body">
                <div className="proj-top">
                  <h3 className="proj-name play-name"><Copy>{p.name}</Copy></h3>
                  <span className={`play-badge ${p.path ? 'play-badge-live' : ''}`}>{p.status}</span>
                </div>
                <p className="proj-blurb"><Copy>{p.line}</Copy></p>
                <div className="tag-list">
                  {p.tags.map(t => <Tag key={t}>{t}</Tag>)}
                </div>
                <p className="play-meta">
                  <span>≈{p.minutes} min{p.missions ? ` · ${p.missions} missions` : ''}</span>
                  {p.path && <span className="post-arrow">play ↗</span>}
                </p>
              </div>
            </>
          )
          return p.path ? (
            <a key={p.name} className="play-card" href={`${PLAY_URL}${p.path}`} target="_blank" rel="noopener noreferrer"
               style={{ animationDelay: `${i * 70}ms` }}>
              {body}
            </a>
          ) : (
            <div key={p.name} className="play-card play-card-soon" style={{ animationDelay: `${i * 70}ms` }}>
              {body}
            </div>
          )
        })}
      </div>
    </Section>
  )
}
