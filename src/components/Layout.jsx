import { Link } from 'react-router-dom'

export default function Layout({ children }) {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1">
        {children}
      </main>
      <Footer />
    </div>
  )
}

function Nav() {
  return (
    <header className="border-b border-zinc-200 bg-paper/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-2xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link to="/" className="font-mono text-sm font-bold text-zinc-900 hover:text-accent-600 transition-colors tracking-tight">
          string-wise
        </Link>
        <nav className="flex items-center gap-6">
          <a
            href="https://hash.string-wise.com"
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs text-zinc-400 hover:text-zinc-700 transition-colors"
          >
            hash ↗
          </a>
          <a
            href="https://raft.string-wise.com"
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs text-zinc-400 hover:text-zinc-700 transition-colors"
          >
            raft ↗
          </a>
          <a
            href="https://www.linkedin.com/in/vaibhav-bhardwaj-a0554a1b8/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs text-zinc-400 hover:text-zinc-700 transition-colors"
          >
            linkedin ↗
          </a>
        </nav>
      </div>
    </header>
  )
}

function Footer() {
  return (
    <footer className="border-t border-zinc-200 mt-20">
      <div className="max-w-2xl mx-auto px-6 py-10">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div>
            <p className="font-mono text-sm font-bold text-zinc-900 mb-1">string-wise</p>
            <p className="text-xs text-zinc-400">
              Technical writing by{' '}
              <a href="https://www.linkedin.com/in/vaibhav-bhardwaj-a0554a1b8/" target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:text-accent-700">
                Vaibhav on LinkedIn
              </a>
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <p className="font-mono text-[10px] text-zinc-400 uppercase tracking-widest">projects</p>
            <div className="flex gap-4">
              <a href="https://hash.string-wise.com" target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-zinc-500 hover:text-accent-600 transition-colors">
                hash.string-wise.com ↗
              </a>
              <a href="https://raft.string-wise.com" target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-zinc-500 hover:text-accent-600 transition-colors">
                raft.string-wise.com ↗
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
