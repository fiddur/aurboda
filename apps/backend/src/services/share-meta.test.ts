import { describe, expect, test } from 'vitest'

import {
  buildChallengeShareMeta,
  buildDashboardShareMeta,
  buildDefaultShareMeta,
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
