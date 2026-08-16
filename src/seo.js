import registry from './registry'

export const SITE = {
  url:         'https://string-wise.com',
  name:        'string-wise',
  title:       'string-wise — field notes on distributed systems',
  description: 'Technical writing and interactive visualizers on distributed systems, databases, and Go.',
  author:      'Vaibhav Bhardwaj',
  twitter:     '@goroutine_guy',
  locale:      'en_US',
}

const posts = registry.filter(p => p.type === 'post')

/** Every path the prerenderer emits as a real HTML file. */
export const allRoutes = ['/', ...posts.map(p => `/${p.slug}`)]

/**
 * Head metadata for a path. Used at build time by the prerenderer and at
 * runtime by useDocumentMeta on client-side navigation, so both agree.
 */
export function metaForPath(pathname) {
  const slug = pathname.replace(/^\/|\/$/g, '')
  const post = posts.find(p => p.slug === slug)

  if (!post) {
    return {
      title:       SITE.title,
      description: SITE.description,
      canonical:   SITE.url + '/',
      type:        'website',
      image:       post?.ogImage ?? null,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'Blog',
        name: SITE.name,
        url: SITE.url,
        description: SITE.description,
        author: { '@type': 'Person', name: SITE.author },
        blogPost: posts.map(p => ({
          '@type': 'BlogPosting',
          headline: p.title,
          url: `${SITE.url}/${p.slug}`,
          datePublished: p.date,
          keywords: p.tags.join(', '),
        })),
      },
    }
  }

  return {
    title:       `${post.title} — ${SITE.name}`,
    description: post.description,
    canonical:   `${SITE.url}/${post.slug}`,
    type:        'article',
    image:       post.ogImage ? SITE.url + post.ogImage : null,
    published:   post.date,
    tags:        post.tags,
    readingTime: post.readingTime,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.title,
      description: post.description,
      datePublished: post.date,
      dateModified: post.date,
      keywords: post.tags.join(', '),
      url: `${SITE.url}/${post.slug}`,
      mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE.url}/${post.slug}` },
      author: { '@type': 'Person', name: SITE.author, url: SITE.url },
      publisher: { '@type': 'Organization', name: SITE.name, url: SITE.url },
    },
  }
}

/** Post metadata the sitemap needs, without dragging in the components. */
export const sitemapEntries = [
  { loc: SITE.url + '/', lastmod: posts.map(p => p.date).sort().pop(), priority: '1.0' },
  ...posts.map(p => ({ loc: `${SITE.url}/${p.slug}`, lastmod: p.date, priority: '0.8' })),
]
