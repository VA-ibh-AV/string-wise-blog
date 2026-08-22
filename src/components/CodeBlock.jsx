import { useState } from 'react'
import Prism from 'prismjs'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-c'
import 'prismjs/components/prism-go'
import 'prismjs/components/prism-properties'
import 'prismjs/components/prism-sql'

/**
 * Syntax-highlighted code block.
 *
 * Prism.highlight is synchronous and pure, so the same markup comes out of the
 * build-time prerender and the client hydration — no mismatch, no flash of
 * unhighlighted code. Blocks with lang="text" (ASCII diagrams) are left alone.
 */

const LABELS = {
  bash:       'shell',
  c:          'c',
  go:         'go',
  properties: 'config',
  sql:        'sql',
  text:       '',
}

export default function CodeBlock({ code, lang = 'text', caption }) {
  const [copied, setCopied] = useState(false)
  const source = String(code).replace(/\n$/, '')

  const grammar = Prism.languages[lang]
  const html = grammar ? Prism.highlight(source, grammar, lang) : null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(source)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked (insecure origin) — the code is selectable anyway */
    }
  }

  return (
    <div className="not-prose code-block">
      <div className="code-block-bar">
        <span className="code-block-lang">{caption ?? LABELS[lang] ?? lang}</span>
        <button type="button" className="code-block-copy" onClick={copy} aria-label="Copy code">
          {copied ? 'copied ✓' : 'copy'}
        </button>
      </div>
      <pre className={`code-block-pre language-${lang}`}>
        {html
          ? <code className={`language-${lang}`} dangerouslySetInnerHTML={{ __html: html }} />
          : <code className={`language-${lang}`}>{source}</code>}
      </pre>
    </div>
  )
}
