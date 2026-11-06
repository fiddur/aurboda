import { describe, expect, test } from 'vitest'

import { type AtomArticleSource, articleEntryHtml, buildArticlesAtom } from './article-atom.ts'

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
