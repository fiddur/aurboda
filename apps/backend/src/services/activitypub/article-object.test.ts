import type { ArticleContent } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { articleImageAttachments, renderArticleContentHtml } from './article-object.ts'

const WINDOW = { end: '2026-07-02T00:00:00Z', start: '2026-07-01T00:00:00Z' }

const article = (blocks: ArticleContent['blocks']): ArticleContent => ({ blocks, title: 'My analysis' })

describe('renderArticleContentHtml', () => {
  test('renders prose markdown to HTML', () => {
    const html = renderArticleContentHtml(
      article([{ markdown: '# Sleep\n\nSlept **well**.', type: 'prose' }]),
    )
    expect(html).toContain('<h1')
    expect(html).toContain('Sleep')
    expect(html).toContain('<strong>well</strong>')
  })

  test('strips script/style from authored markdown (the #910 boundary, server side)', () => {
    const html = renderArticleContentHtml(
      article([{ markdown: 'Hi <script>alert(1)</script> <img src=x onerror=alert(2)>', type: 'prose' }]),
    )
    expect(html).not.toContain('<script')
    expect(html).not.toContain('alert(1)')
    expect(html).not.toContain('onerror')
  })

  test('keeps GFM tables and images in the federated content (richer than the inbound allowlist)', () => {
    const md = '| a | b |\n| - | - |\n| 1 | 2 |\n\n![alt](https://ex.example/p.png)\n\n---\n\n###### h6'
    const html = renderArticleContentHtml(article([{ markdown: md, type: 'prose' }]))
    expect(html).toContain('<table>')
    expect(html).toContain('<td>1</td>')
    expect(html).toContain('<img')
    expect(html).toContain('https://ex.example/p.png')
    expect(html).toContain('<hr')
    expect(html).toContain('<h6')
  })

  test('emits a caption as plain escaped text, not markdown (matches the web figcaption)', () => {
    const html = renderArticleContentHtml(
      article([
        {
          caption: '**not bold** <b>x</b>',
          end: WINDOW.end,
          metric: 'heart_rate',
          start: WINDOW.start,
          type: 'chart',
        },
      ]),
    )
    expect(html).toContain('**not bold** &lt;b&gt;x&lt;/b&gt;')
    expect(html).not.toContain('<strong>')
    expect(html).not.toContain('<b>x</b>')
  })

  test('includes chart/correlation captions but not the images (those are attachments)', () => {
    const html = renderArticleContentHtml(
      article([
        { markdown: 'Intro', type: 'prose' },
        { caption: 'HR trend', end: WINDOW.end, metric: 'heart_rate', start: WINDOW.start, type: 'chart' },
        { end: WINDOW.end, metric: 'steps', start: WINDOW.start, type: 'chart' }, // no caption → nothing
      ]),
    )
    expect(html).toContain('Intro')
    expect(html).toContain('HR trend')
    expect(html).not.toContain('img') // images ride as attachments, not inline
  })
})

describe('articleImageAttachments', () => {
  const base = 'https://aurboda.example/api/public/fiddur/feed/POST'
  const withBlocks = (blocks: ArticleContent['blocks']): ArticleContent => article(blocks)
  const chart = { end: WINDOW.end, metric: 'heart_rate', start: WINDOW.start, type: 'chart' } as const
  const correlation = {
    end: WINDOW.end,
    outcome: { kind: 'metric', metric: 'sleep_score' },
    start: WINDOW.start,
    trigger: { kind: 'metric', metric: 'steps' },
    type: 'correlation',
  } as const

  test('one image per chart/correlation block, indexed by block position, no token when public', () => {
    const atts = articleImageAttachments(
      'https://aurboda.example/api',
      'fiddur',
      'POST',
      'public',
      'secret-token',
      withBlocks([{ markdown: 'Intro', type: 'prose' }, chart, correlation]),
    )
    expect(atts.map((a) => a.url?.href)).toEqual([`${base}/blocks/1/image.png`, `${base}/blocks/2/image.png`])
  })

  test('followers-only attachments carry the capability token (#893)', () => {
    const atts = articleImageAttachments(
      'https://aurboda.example/api',
      'fiddur',
      'POST',
      'followers',
      'secret-token',
      withBlocks([chart]),
    )
    expect(atts.map((a) => a.url?.href)).toEqual([`${base}/blocks/0/image.png?token=secret-token`])
  })

  test('names an attachment from its caption, else its data label', () => {
    const atts = articleImageAttachments(
      'https://aurboda.example/api',
      'fiddur',
      'POST',
      'public',
      'secret-token',
      withBlocks([{ ...chart, caption: 'Overnight HR' }, correlation]),
    )
    expect(atts[0].name?.toString()).toBe('Overnight HR')
    expect(atts[1].name?.toString()).toContain('steps') // correlation label from selectors
  })

  test('no attachments for a prose-only article', () => {
    const atts = articleImageAttachments(
      'https://aurboda.example/api',
      'fiddur',
      'POST',
      'public',
      'secret-token',
      withBlocks([{ markdown: 'Just words', type: 'prose' }]),
    )
    expect(atts).toEqual([])
  })
})
