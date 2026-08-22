import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { contact } from '../portfolio'

const LINKEDIN_URL = contact.linkedin

export default function Layout({ children }) {
  return (
    <div className="site-shell">
      <Nav />
      <main className="site-main">{children}</main>
      <Footer />
    </div>
  )
}

function ThemeToggle() {
  // Must match what the inline script in index.html already applied, or
  // hydration of the prerendered markup mismatches on the first paint.
  // Dark-first: only an explicitly saved 'light' opts out.
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'dark'
    try {
      return window.localStorage.getItem('string-wise-theme') === 'light' ? 'light' : 'dark'
    } catch {
      return 'dark'
    }
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem('string-wise-theme', theme)
  }, [theme])

  const isDark = theme === 'dark'

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
    >
      {isDark ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20.6 15.3A8.5 8.5 0 0 1 8.7 3.4 8.5 8.5 0 1 0 20.6 15.3Z" />
        </svg>
      )}
    </button>
  )
}

function Nav() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden="true">sw</span>
          <span>string-wise</span>
          <span className="brand-context">/ vaibhav bhardwaj</span>
        </Link>

        <nav className="site-nav" aria-label="Primary navigation">
          {/* Plain anchors, not <Link>: react-router does not scroll to a hash,
              and these have to work from a post page as well as from the
              homepage. On a prerendered static site the full load is cheap. */}
          <a href="/#work" className="nav-link">work</a>
          <a href="/#writing" className="nav-link">writing</a>
          <a href="/#contact" className="nav-link">contact</a>
          <span className="nav-divider" aria-hidden="true" />
          <a href="https://hash.string-wise.com" target="_blank" rel="noopener noreferrer" className="nav-link nav-link-ext">
            hash <span>↗</span>
          </a>
          <a href="https://raft.string-wise.com" target="_blank" rel="noopener noreferrer" className="nav-link nav-link-ext">
            raft <span>↗</span>
          </a>
          <span className="nav-divider" aria-hidden="true" />
          <ThemeToggle />
        </nav>
      </div>
    </header>
  )
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div>
          <p className="footer-brand">string-wise<span>.</span></p>
          <p className="footer-copy">Systems writing and interactive visualizers by <a href={LINKEDIN_URL} target="_blank" rel="noopener noreferrer">Vaibhav Bhardwaj ↗</a></p>
        </div>

        <div className="footer-projects">
          <p className="micro-label">elsewhere</p>
          <div className="footer-links">
            <a href="https://hash.string-wise.com" target="_blank" rel="noopener noreferrer">hash.string-wise.com ↗</a>
            <a href="https://raft.string-wise.com" target="_blank" rel="noopener noreferrer">raft.string-wise.com ↗</a>
            {/* Rendered only once set in src/portfolio.js, so the footer never
                ships a mailto: to nowhere or a bare github.com link. */}
            {contact.github && (
              <a href={contact.github} target="_blank" rel="noopener noreferrer">
                {contact.github.replace(/^https?:\/\//, '')} ↗
              </a>
            )}
            {contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}
            {contact.resume && <a href={contact.resume}>résumé (pdf)</a>}
          </div>
        </div>

        <p className="footer-end">built for curious engineers<br />© {new Date().getFullYear()}</p>
      </div>
    </footer>
  )
}
