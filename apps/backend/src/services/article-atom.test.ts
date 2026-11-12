import { describe, expect, test } from 'vitest'

import {
  type AtomArticleSource,
  articleEntryHtml,
  buildArticlesAtom,
  buildOfficialFeedAtom,
  buildTagFeedAtom,
  officialFeedTitle,
  postEntryHtml,
  postEntryTitle,
  remoteEntryTitle,
} from './article-atom.ts'

const source = (overrides: Partial<AtomArticleSource> = {}): AtomArticleSource => ({
  article: {
    blocks: [
      { markdown: 'A look at **sleep**.', type: 'prose' },
      {
        bucket: '1h',
        caption: 'Resting HR',
        end: '2026-07-07T00:00:00.000Z',
        metric: 'heart_rate',
        start: '2026-07-01T00:00:00.000Z',
        type: 'chart',
      },
    ],
    title: 'Sleep & HRV',
  },
  created_at: new Date('2026-07-08T10:00:00Z'),
  id: '11111111-2222-4333-8444-555555555555',
  image_token: 'secret-token',
  updated_at: new Date('2026-07-09T10:00:00Z'),
  visibility: 'public',
  ...overrides,
})

describe('articleEntryHtml', () => {
  test('renders the prose and inlines each renderable chart as an image, without the title', () => {
    const html = articleEntryHtml('https://qs.example/api', 'fiddur', source(), new Set([1]))
    expect(html).toContain('<p>A look at <strong>sleep</strong>.</p>')
    expect(html).toContain(
      '<img src="https://qs.example/api/public/fiddur/feed/11111111-2222-4333-8444-555555555555/blocks/1/image.png?v=1783591200000" alt="Resting HR" />',
    )
    expect(html).toContain('<em>Resting HR</em>')
    expect(html).not.toContain('Sleep &amp; HRV')
    expect(html).not.toContain('secret-token')
  })

  test('replaces a chart without data by a note instead of a dead image', () => {
    const html = articleEntryHtml('https://qs.example/api', 'fiddur', source(), new Set())
    expect(html).not.toContain('<img')
    expect(html).toContain('not enough data in this window')
  })

  test('is empty for an article with no blocks', () => {
    const html = articleEntryHtml(
      'https://qs.example/api',
      'fiddur',
      source({ article: { blocks: [], title: 'Empty' } }),
    )
    expect(html).toBe('')
  })
})

describe('buildArticlesAtom', () => {
  const entry = {
    created_at: new Date('2026-07-08T10:00:00Z'),
    html: '<p>Tom & Jerry</p>',
    id: 'abc',
    title: 'Cats <and> mice',
    updated_at: new Date('2026-07-09T10:00:00Z'),
  }

  test('builds an Atom feed with blog, self and per-entry permalink URLs, all escaped', () => {
    const xml = buildArticlesAtom({
      apiBaseUrl: 'https://qs.example/api/',
      entries: [entry, { ...entry, id: 'old', updated_at: new Date('2026-07-01T00:00:00Z') }],
      now: new Date('2030-01-01T00:00:00Z'),
      username: 'fiddur',
      webHost: 'https://qs.example',
    })
    expect(
      xml.startsWith('<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">'),
    ).toBe(true)
    expect(xml).toContain('<id>https://qs.example/u/fiddur/articles</id>')
    expect(xml).toContain('<title type="text">fiddur\'s blog — Aurboda</title>')
    expect(xml).toContain(
      '<link rel="alternate" type="text/html" href="https://qs.example/u/fiddur/articles"/>',
    )
    expect(xml).toContain(
      '<link rel="self" type="application/atom+xml" href="https://qs.example/api/public/fiddur/articles.atom"/>',
    )
    expect(xml).toContain('  <updated>2026-07-09T10:00:00.000Z</updated>\n  <author>')
    expect(xml).toContain('<author><name>fiddur</name><uri>https://qs.example/u/fiddur</uri></author>')
    expect(xml).toContain('<id>https://qs.example/u/fiddur/posts/abc</id>')
    expect(xml).toContain(
      '<link rel="alternate" type="text/html" href="https://qs.example/u/fiddur/posts/abc"/>',
    )
    expect(xml).toContain('<title type="text">Cats &lt;and&gt; mice</title>')
    expect(xml).toContain('<published>2026-07-08T10:00:00.000Z</published>')
    expect(xml).toContain('<content type="html">&lt;p&gt;Tom &amp; Jerry&lt;/p&gt;</content>')
  })

  test('uses now as the feed update time when there are no entries', () => {
    const xml = buildArticlesAtom({
      apiBaseUrl: 'https://qs.example/api',
      entries: [],
      now: new Date('2030-01-01T00:00:00Z'),
      username: 'fiddur',
      webHost: 'https://qs.example',
    })
    expect(xml).toContain('<updated>2030-01-01T00:00:00.000Z</updated>')
    expect(xml).not.toContain('<entry>')
  })
})

describe('postEntryTitle', () => {
  test('names a post by its article, activity, exercise or challenge name', () => {
    expect(postEntryTitle({ article: { blocks: [], title: 'Sleep & HRV' }, kind: 'article' })).toBe(
      'Sleep & HRV',
    )
    expect(postEntryTitle({ activity_title: 'Morning run', kind: 'activity', message: 'Felt good' })).toBe(
      'Morning run',
    )
    expect(
      postEntryTitle({ exercise: { name: 'Bench press' } as never, kind: 'exercise', message: 'PR!' }),
    ).toBe('Bench press')
    expect(
      postEntryTitle({
        challenge: { name: 'Step-tember', url: 'https://qs.example/u/fiddur/c' },
        kind: 'challenge',
      }),
    ).toBe('Step-tember')
  })

  test('falls back to the start of the text, cut at a word', () => {
    expect(postEntryTitle({ kind: 'activity', message: 'Short note' })).toBe('Short note')
    const long = `${'word '.repeat(30)}end`
    const title = postEntryTitle({ kind: 'activity', message: long })
    expect(title.length).toBeLessThanOrEqual(80)
    expect(title.endsWith('word…')).toBe(true)
    expect(postEntryTitle({ content: '<p>Ran <strong>5 km</strong> &amp; more</p>', kind: 'activity' })).toBe(
      'Ran 5 km & more',
    )
    expect(postEntryTitle({ kind: 'activity' })).toBe('Post')
  })
})

describe('postEntryHtml', () => {
  test('uses the federated content, a challenge invitation, or the message as prose', () => {
    expect(postEntryHtml({ content: '<p>Ran 5 km</p>', kind: 'activity', message: 'ignored' })).toBe(
      '<p>Ran 5 km</p>',
    )
    const challenge = postEntryHtml({
      challenge: { name: 'Step-tember', url: 'https://qs.example/u/fiddur/c' },
      kind: 'challenge',
      message: 'Join **us**',
    })
    expect(challenge).toContain('<strong>Step-tember</strong>')
    expect(challenge).toContain('<strong>us</strong>')
    expect(challenge).toContain('href="https://qs.example/u/fiddur/c"')
    expect(postEntryHtml({ kind: 'exercise', message: 'Hello *there*' })).toContain('<em>there</em>')
    expect(postEntryHtml({ kind: 'exercise' })).toBe('')
  })
})

describe('buildOfficialFeedAtom', () => {
  test('titles the feed by the instance host and names each entry its own author and permalink', () => {
    const xml = buildOfficialFeedAtom({
      apiBaseUrl: 'https://qs.example/api',
      entries: [
        {
          created_at: new Date('2026-07-08T10:00:00Z'),
          html: '<p>Hi</p>',
          id: 'abc',
          origin: 'local',
          title: 'Morning run',
          updated_at: new Date('2026-07-09T10:00:00Z'),
          username: 'alice',
        },
      ],
      now: new Date('2030-01-01T00:00:00Z'),
      webHost: 'https://qs.example',
    })
    expect(xml).toContain('<id>https://qs.example/blog</id>')
    expect(xml).toContain('<title type="text">qs.example blog</title>')
    expect(xml).toContain(
      '<link rel="self" type="application/atom+xml" href="https://qs.example/api/public/official-feed.atom"/>',
    )
    expect(xml).toContain('<id>https://qs.example/u/alice/posts/abc</id>')
    expect(xml).toContain('    <author><name>alice</name><uri>https://qs.example/u/alice</uri></author>')
    expect(xml).not.toContain('\n  <author>')
  })

  test('carries a remote post as received, linking its original and titled by its first line', () => {
    const xml = buildOfficialFeedAtom({
      apiBaseUrl: 'https://qs.example/api',
      entries: [
        {
          actor_uri: 'https://aurboda.net/users/fiddur',
          content: '<p>Release 2.0 &amp; more</p><p>Details follow.</p>',
          display_name: 'Fredrik',
          handle: '@fiddur@aurboda.net',
          images: [{ url: 'https://aurboda.net/a.png' }],
          note_uri: 'https://aurboda.net/notes/1',
          origin: 'remote',
          published_at: new Date('2026-07-08T10:00:00Z'),
          updated_at: new Date('2026-07-09T10:00:00Z'),
          url: 'https://aurboda.net/u/fiddur/posts/1',
        },
      ],
      now: new Date('2030-01-01T00:00:00Z'),
      webHost: 'https://qs.example',
    })
    expect(xml).toContain('<id>https://aurboda.net/notes/1</id>')
    expect(xml).toContain('<title type="text">Release 2.0 &amp; more</title>')
    expect(xml).toContain('href="https://aurboda.net/u/fiddur/posts/1"')
    expect(xml).toContain('<author><name>Fredrik</name><uri>https://aurboda.net/users/fiddur</uri></author>')
    expect(xml).toContain('<published>2026-07-08T10:00:00.000Z</published>')
    expect(xml).toContain('&lt;p&gt;Details follow.&lt;/p&gt;')
    expect(xml).toContain('&lt;img src=&quot;https://aurboda.net/a.png&quot;')
  })

  test('falls back to a plain title when the web host is not a URL', () => {
    expect(officialFeedTitle('not a url')).toBe('Blog')
  })
})

describe('remoteEntryTitle', () => {
  test('is the first non-empty line of the text, else the author', () => {
    expect(remoteEntryTitle({ content: '<p></p><p>Hello<br>world</p>' }, 'Bob')).toBe('Hello')
    expect(remoteEntryTitle({ content: `<p>${'word '.repeat(30)}</p>` }, 'Bob')).toMatch(/…$/)
    expect(remoteEntryTitle({ content: '<p><img src="x"></p>' }, 'Bob')).toBe('Bob')
  })
})

describe('buildTagFeedAtom', () => {
  test('escapes a hostile remote author and url, and ids each entry by its note id', () => {
    const xml = buildTagFeedAtom({
      apiBaseUrl: 'https://aurboda.example/api',
      entries: [
        {
          actor_uri: 'https://peer.example/users/eve',
          content: '<p>a & b</p></content><script>x</script>',
          display_name: '</name></author><entry><id>forged</id>',
          handle: '@eve@peer.example',
          images: [],
          note_uri: 'https://peer.example/notes/1',
          published_at: new Date('2026-11-01T10:00:00Z'),
          updated_at: new Date('2026-11-01T10:00:00Z'),
          url: 'https://peer.example/@eve/1?a=1&b="2"',
        },
      ],
      now: new Date('2026-11-10T00:00:00Z'),
      tag: 'aurboda',
      webHost: 'https://aurboda.example',
    })
    expect(xml).toContain('<id>https://peer.example/notes/1</id>')
    expect(xml).not.toContain('<id>forged</id>')
    expect(xml).not.toContain('<script>')
    expect(xml).toContain('&lt;/name&gt;&lt;/author&gt;&lt;entry&gt;&lt;id&gt;forged&lt;/id&gt;')
    expect(xml).toContain('&lt;p&gt;a &amp; b&lt;/p&gt;&lt;/content&gt;&lt;script&gt;')
    expect(xml).toContain('href="https://peer.example/@eve/1?a=1&amp;b=&quot;2&quot;"')
    expect(xml.match(/<entry>/g)).toHaveLength(1)
  })
})
