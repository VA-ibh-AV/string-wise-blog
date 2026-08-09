import registry from '../registry'
import PostCard from '../components/PostCard'

const LINKEDIN_URL = 'https://www.linkedin.com/in/vaibhav-bhardwaj-a0554a1b8/'

export default function Home() {
  return (
    <div className="home-page">
      <section className="hero-section">
        <div className="hero-copy">
          <p className="eyebrow"><span className="eyebrow-dot" /> independent engineering notes <span>/</span> 2025</p>
          <h1>Systems thinking,<br /><em>made legible.</em></h1>
          <p className="hero-description">
            Deep dives into distributed systems, databases, and Go — with interactive visualizers you can actually play with.
          </p>
          <div className="hero-actions">
            <a href="#posts" className="primary-action">read the field notes <span>↓</span></a>
            <a href={LINKEDIN_URL} target="_blank" rel="noopener noreferrer" className="secondary-action">connect on linkedin <span>↗</span></a>
          </div>
        </div>

        <div className="hero-aside">
          <div className="signal-card">
            <div className="signal-card-top">
              <span className="micro-label">signal / 001</span>
              <span className="live-badge"><span /> live</span>
            </div>
            <div className="signal-line"><span className="signal-key">focus</span><span>systems &amp; storage</span></div>
            <div className="signal-line"><span className="signal-key">format</span><span>essays + simulators</span></div>
            <div className="signal-line"><span className="signal-key">status</span><span className="signal-accent">always learning</span></div>
            <div className="signal-wave" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
          </div>
          <div className="hero-aside-note">A small, opinionated library<br />for understanding what runs underneath.</div>
        </div>
      </section>

      <section id="posts" className="library-section">
        <div className="section-heading">
          <div>
            <p className="micro-label">01 / the library</p>
            <h2>Latest field notes</h2>
          </div>
          <span className="section-count">{String(registry.length).padStart(2, '0')} entries</span>
        </div>

        <div className="post-grid">
          {registry.map((post, i) => <PostCard key={post.slug} post={post} index={i} />)}
        </div>
      </section>
    </div>
  )
}
