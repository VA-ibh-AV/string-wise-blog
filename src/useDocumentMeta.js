import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { metaForPath } from './seo'

function setTag(selector, attrs) {
  let el = document.head.querySelector(selector)
  if (!el) {
    el = document.createElement(attrs.tag ?? 'meta')
    document.head.appendChild(el)
  }
  Object.entries(attrs).forEach(([k, v]) => { if (k !== 'tag') el.setAttribute(k, v) })
  return el
}

/**
 * Keeps title/description/canonical/OG in sync on client-side navigation.
 *
 * The prerendered HTML already carries the correct tags for the entry route;
 * this only matters once React Router takes over and the document would
 * otherwise keep the previous page's head.
 */
export default function useDocumentMeta() {
  const { pathname } = useLocation()

  useEffect(() => {
    const meta = metaForPath(pathname)

    document.title = meta.title
    setTag('meta[name="description"]', { name: 'description', content: meta.description })
    setTag('link[rel="canonical"]', { tag: 'link', rel: 'canonical', href: meta.canonical })
    setTag('meta[property="og:title"]', { property: 'og:title', content: meta.title })
    setTag('meta[property="og:description"]', { property: 'og:description', content: meta.description })
    setTag('meta[property="og:url"]', { property: 'og:url', content: meta.canonical })
    setTag('meta[property="og:type"]', { property: 'og:type', content: meta.type })
  }, [pathname])
}
