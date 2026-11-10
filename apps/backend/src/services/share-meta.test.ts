import { describe, expect, test } from 'vitest'

import {
  buildArticleShareMeta,
  buildBlogShareMeta,
  buildChallengeShareMeta,
  buildDashboardShareMeta,
  buildExerciseShareMeta,
  buildDefaultShareMeta,
  buildHomeShareMeta,
  buildPostShareMeta,
  buildProfileShareMeta,
  defaultOgImage,
  injectShareMeta,
  renderShareMetaTags,
  resourceOgImage,
  type ShareMeta,
} from './share-meta.ts'

const template = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Aurboda</title>
  </head>
  <body><div id="app"></div></body>
</html>`

const meta: ShareMeta = {
  description: 'A description',
  image: 'https://aurboda.net/og-default.png',
  imageAlt: 'Alt text',
  title: 'My dashboard — Aurboda',
  type: 'website',
  url: 'https://aurboda.net/u/fiddur/abc',
}

describe('renderShareMetaTags', () => {
  test('emits og and twitter tags with the 1200x630 dimensions', () => {
    const html = renderShareMetaTags(meta)
    expect(html).toContain('<meta property="og:title" content="My dashboard — Aurboda">')
    expect(html).toContain('<meta property="og:image" content="https://aurboda.net/og-default.png">')
    expect(html).toContain('<meta property="og:image:width" content="1200">')
    expect(html).toContain('<meta property="og:image:height" content="630">')
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">')
    expect(html).toContain('<meta name="description" content="A description">')
    expect(html).toContain('<link rel="canonical" href="https://aurboda.net/u/fiddur/abc">')
  })

  test('escapes attribute-breaking characters', () => {
    const html = renderShareMetaTags({ ...meta, title: ' Evil " <x> & y' })
    expect(html).toContain('content=" Evil &quot; &lt;x&gt; &amp; y"')
    expect(html).not.toContain('<x>')
  })

  test('embeds JSON-LD when provided, escaping </script', () => {
    const html = renderShareMetaTags({
      ...meta,
      jsonLd: { '@type': 'WebPage', name: '</script><script>alert(1)' },
    })
    expect(html).toContain('<script type="application/ld+json">')
    expect(html).not.toContain('</script><script>alert(1)')
    expect(html).toContain('\\u003c/script>')
  })
})

describe('injectShareMeta', () => {
  test('replaces the title and inserts meta before </head>', () => {
    const html = injectShareMeta(template, meta)
    expect(html).toContain('<title>My dashboard — Aurboda</title>')
    expect(html).not.toContain('<title>Aurboda</title>')
    // Meta block sits inside the head.
    const headEnd = html.indexOf('</head>')
    expect(html.indexOf('og:title')).toBeLessThan(headEnd)
    expect(html).toContain('<body><div id="app"></div></body>')
  })

  test('appends when no </head> is present', () => {
    const result = injectShareMeta('<html><title>x</title></html>', meta)
    expect(result).toContain('og:title')
  })
})

describe('builders', () => {
  test('dashboard meta uses the name and default image', () => {
    const m = buildDashboardShareMeta({
      name: 'Training',
      url: 'https://aurboda.net/u/fiddur/abc',
      username: 'fiddur',
    })
    expect(m.title).toBe('Training — Aurboda')
    expect(m.type).toBe('website')
    expect(m.image).toBe('https://aurboda.net/u/fiddur/abc/opengraph-image.png')
    expect(m.description).toContain('Training')
  })

  test('dashboard meta falls back when the description is empty/whitespace', () => {
    const m = buildDashboardShareMeta({
      description: '   ',
      name: 'Training',
      url: 'https://aurboda.net/u/fiddur/abc',
      username: 'fiddur',
    })
    expect(m.description).toContain('Training')
    expect(m.description.trim()).not.toBe('')
  })

  test('dashboard meta prefers an author description', () => {
    const m = buildDashboardShareMeta({
      description: 'Two years of training and effect.',
      name: 'Training',
      url: 'https://aurboda.net/u/fiddur/abc',
      username: 'fiddur',
    })
    expect(m.description).toBe('Two years of training and effect.')
  })

  test('dashboard meta clamps very long descriptions', () => {
    const m = buildDashboardShareMeta({
      description: 'word '.repeat(100),
      name: 'x',
      url: 'https://aurboda.net/u/fiddur/abc',
      username: 'fiddur',
    })
    expect(m.description.length).toBeLessThanOrEqual(201)
    expect(m.description.endsWith('…')).toBe(true)
  })

  test('exercise meta uses the name, the progress description and the rendered image', () => {
    const m = buildExerciseShareMeta({
      activityTypeName: 'Strength training',
      name: 'Bench',
      url: 'https://aurboda.net/u/fiddur/ex1',
      username: 'fiddur',
      value: 'Bench Press',
    })
    expect(m.title).toBe('Bench — Aurboda')
    expect(m.description).toBe("Bench — fiddur's progress on Aurboda.")
    expect(m.image).toBe('https://aurboda.net/u/fiddur/ex1/opengraph-image.png')
    expect(m.imageAlt).toBe('Aurboda exercise: Bench Press (Strength training)')
    expect(m.oembedUrl).toBeUndefined()
  })

  test('profile meta is of type profile with ProfilePage JSON-LD', () => {
    const m = buildProfileShareMeta({
      url: 'https://aurboda.net/u/fiddur',
      username: 'fiddur',
    })
    expect(m.type).toBe('profile')
    expect(m.jsonLd?.['@type']).toBe('ProfilePage')
    expect(m.image).toBe('https://aurboda.net/u/fiddur/opengraph-image.png')
  })

  test('challenge meta mentions federation', () => {
    const m = buildChallengeShareMeta({
      name: 'Step count',
      url: 'https://aurboda.net/u/fiddur/xyz',
      username: 'fiddur',
    })
    expect(m.title).toBe('Step count — Aurboda')
    expect(m.description.toLowerCase()).toContain('challenge')
  })

  test('challenge meta with details says what, when and who has joined', () => {
    const details = {
      joined: 0,
      measure: 'Steps',
      participants: 1,
      phrase: 'Starts in 3 days',
      range: '1 Oct – 31 Oct 2026',
      status: 'upcoming' as const,
    }
    const m = buildChallengeShareMeta({
      details,
      name: 'October steps',
      url: 'https://aurboda.net/u/fiddur/xyz',
      username: 'fiddur',
    })
    expect(m.description).toBe(
      'Steps challenge, 1 Oct – 31 Oct 2026 · Starts in 3 days · Be the first to join. Hosted by fiddur on Aurboda — join from any instance.',
    )
    const joined = buildChallengeShareMeta({
      details: { ...details, joined: 4, participants: 5 },
      name: 'October steps',
      url: 'https://aurboda.net/u/fiddur/xyz',
      username: 'fiddur',
    })
    expect(joined.description).toContain('· 4 joined.')
  })

  test('ended challenge meta says who took part and does not invite to join', () => {
    const details = {
      joined: 2,
      measure: 'Steps',
      participants: 3,
      phrase: 'Ended 31 Oct 2026',
      range: '1 Oct – 31 Oct 2026',
      status: 'ended' as const,
    }
    const m = buildChallengeShareMeta({
      details,
      name: 'October steps',
      url: 'https://aurboda.net/u/fiddur/xyz',
      username: 'fiddur',
    })
    expect(m.description).toBe(
      'Steps challenge, 1 Oct – 31 Oct 2026 · Ended 31 Oct 2026 · 3 took part. Hosted by fiddur on Aurboda.',
    )
    const empty = buildChallengeShareMeta({
      details: { ...details, joined: 0, participants: 0 },
      name: 'October steps',
      url: 'https://aurboda.net/u/fiddur/xyz',
      username: 'fiddur',
    })
    expect(empty.description).toBe(
      'Steps challenge, 1 Oct – 31 Oct 2026 · Ended 31 Oct 2026. Hosted by fiddur on Aurboda.',
    )
  })

  test('default meta has no leaked resource specifics', () => {
    const m = buildDefaultShareMeta('https://aurboda.net', 'https://aurboda.net/u/x/y')
    expect(m.title).toBe('Aurboda')
    expect(m.jsonLd).toBeUndefined()
    expect(m.image).toBe('https://aurboda.net/og-default.png')
  })

  test('home meta describes the site at its root URL', () => {
    const m = buildHomeShareMeta('https://aurboda.net/')
    expect(m.url).toBe('https://aurboda.net/')
    expect(m.title).toBe('Aurboda: see how your sleep, training and everyday life fit together')
    expect(m.description).toMatch(/^Aurboda collects what your watch/)
    expect(m.image).toBe('https://aurboda.net/og-default.png')
    expect(m.jsonLd).toMatchObject({ '@type': 'WebSite', url: 'https://aurboda.net/' })
  })
})

describe('blog and article meta', () => {
  test('blog meta links the Atom feed and uses the profile image', () => {
    const blog = buildBlogShareMeta({
      feedUrl: 'https://x.test/api/public/fiddur/articles.atom',
      profileUrl: 'https://x.test/u/fiddur',
      url: 'https://x.test/u/fiddur/articles',
      username: 'fiddur',
    })
    expect(blog.title).toBe("fiddur's blog — Aurboda")
    expect(blog.image).toBe('https://x.test/u/fiddur/opengraph-image.png')
    expect(blog.jsonLd?.['@type']).toBe('Blog')
    expect(renderShareMetaTags(blog)).toContain(
      '<link rel="alternate" type="application/atom+xml" title="fiddur\'s blog — Aurboda" href="https://x.test/api/public/fiddur/articles.atom">',
    )
  })

  test('article meta uses the title and clamps the excerpt', () => {
    const article = buildArticleShareMeta({
      excerpt: 'word '.repeat(80),
      feedUrl: 'https://x.test/api/public/fiddur/articles.atom',
      title: 'Sleep vs HRV',
      url: 'https://x.test/u/fiddur/posts/abc',
      username: 'fiddur',
    })
    expect(article.title).toBe('Sleep vs HRV — Aurboda')
    expect(article.type).toBe('article')
    expect(article.description.length).toBeLessThanOrEqual(201)
    expect(article.description.endsWith('…')).toBe(true)
    expect(article.jsonLd).toMatchObject({ '@type': 'Article', headline: 'Sleep vs HRV' })
    expect(article.image).toBe('https://x.test/u/fiddur/posts/abc/opengraph-image.png')
  })

  test('article meta falls back to a generic line when there is no prose', () => {
    const article = buildArticleShareMeta({
      excerpt: '  ',
      feedUrl: 'https://x.test/api/public/fiddur/articles.atom',
      title: 'Charts only',
      url: 'https://x.test/u/fiddur/posts/abc',
      username: 'fiddur',
    })
    expect(article.description).toBe('An article by fiddur on Aurboda.')
  })
})

describe('buildPostShareMeta', () => {
  const input = {
    createdAt: '2026-11-01T07:30:00.000Z',
    description: 'Felt great today',
    title: 'Morning run',
    url: 'https://x.test/u/fiddur/posts/abc',
    username: 'fiddur',
  }

  test('describes the post as a social-media posting with its own card', () => {
    const post = buildPostShareMeta(input)
    expect(post.title).toBe('Morning run — Aurboda')
    expect(post.description).toBe('Felt great today')
    expect(post.type).toBe('article')
    expect(post.url).toBe('https://x.test/u/fiddur/posts/abc')
    expect(post.image).toBe('https://x.test/u/fiddur/posts/abc/opengraph-image.png')
    expect(post.imageAlt).toBe('Aurboda post: Morning run')
    expect(post.feedUrl).toBeUndefined()
    expect(post.jsonLd).toEqual({
      '@context': 'https://schema.org',
      '@type': 'SocialMediaPosting',
      author: { '@type': 'Person', name: 'fiddur' },
      datePublished: '2026-11-01T07:30:00.000Z',
      headline: 'Morning run',
      url: 'https://x.test/u/fiddur/posts/abc',
    })
  })

  test('falls back to a generic line without a description, and clamps a long one', () => {
    expect(buildPostShareMeta({ ...input, description: ' ' }).description).toBe(
      'A post by fiddur on Aurboda.',
    )
    const long = buildPostShareMeta({ ...input, description: 'word '.repeat(80) }).description
    expect(long.length).toBeLessThanOrEqual(201)
    expect(long.endsWith('…')).toBe(true)
  })
})

describe('defaultOgImage', () => {
  test('joins without double slashes', () => {
    expect(defaultOgImage('https://aurboda.net/')).toBe('https://aurboda.net/og-default.png')
    expect(defaultOgImage('https://aurboda.net')).toBe('https://aurboda.net/og-default.png')
  })
})

describe('resourceOgImage', () => {
  test('appends the image path to the resource URL', () => {
    expect(resourceOgImage('https://aurboda.net/u/fiddur/abc')).toBe(
      'https://aurboda.net/u/fiddur/abc/opengraph-image.png',
    )
    expect(resourceOgImage('https://aurboda.net/u/fiddur/abc/')).toBe(
      'https://aurboda.net/u/fiddur/abc/opengraph-image.png',
    )
  })
})
