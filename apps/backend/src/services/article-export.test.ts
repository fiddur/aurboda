import type { ArticleContent } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { buildArticleMarkdown } from './article-export.ts'

const WINDOW = { end: '2026-07-02T00:00:00Z', start: '2026-07-01T00:00:00Z' }
const UPDATED = new Date('2026-07-09T00:00:00Z')
const V = String(UPDATED.getTime())
const base = 'https://aurboda.example/api/public/fiddur/feed/POST'

const article = (blocks: ArticleContent['blocks']): ArticleContent => ({ blocks, title: 'My analysis' })

const render = (
  blocks: ArticleContent['blocks'],
  visibility: 'public' | 'unlisted' | 'followers' = 'public',
) =>
  buildArticleMarkdown(
    'https://aurboda.example/api',
    'fiddur',
    'POST',
    visibility,
    'secret-token',
    UPDATED,
    article(blocks),
  )

describe('buildArticleMarkdown', () => {
  test('leads with an H1 title', () => {
    const md = render([{ markdown: 'Slept well.', type: 'prose' }])
    expect(md).toContain('# My analysis')
  })

  test('includes prose verbatim', () => {
    const md = render([{ markdown: '## Sleep\n\nSlept **well**.', type: 'prose' }])
    expect(md).toContain('## Sleep')
    expect(md).toContain('Slept **well**.')
  })

  test('links a chart block to its C1 image endpoint', () => {
    const md = render([{ end: WINDOW.end, metric: 'heart_rate', start: WINDOW.start, type: 'chart' }])
    expect(md).toContain(`![Heart Rate](${base}/blocks/0/image.png?v=${V})`)
  })

  test('links a correlation block, labelled from its selectors when no caption', () => {
    const md = render([
      {
        end: WINDOW.end,
        outcome: { kind: 'metric', metric: 'sleep_score' },
        start: WINDOW.start,
        trigger: { kind: 'metric', metric: 'steps' },
        type: 'correlation',
      },
    ])
    expect(md).toContain(`(${base}/blocks/0/image.png?v=${V})`)
    expect(md).toContain('steps')
    expect(md).toContain('sleep_score')
  })

  test('uses the caption as alt text and adds an italic caption line', () => {
    const md = render([
      { caption: 'Overnight HR', end: WINDOW.end, metric: 'heart_rate', start: WINDOW.start, type: 'chart' },
    ])
    expect(md).toContain('![Overnight HR]')
    expect(md).toContain('*Overnight HR*')
  })

  test('escapes a `]` in the caption so it cannot close the image markdown early', () => {
    const md = render([
      { caption: 'HR [bpm]', end: WINDOW.end, metric: 'heart_rate', start: WINDOW.start, type: 'chart' },
    ])
    expect(md).toContain('![HR [bpm\\]]')
  })

  test('carries the capability token for a followers-only post', () => {
    const md = render(
      [{ end: WINDOW.end, metric: 'heart_rate', start: WINDOW.start, type: 'chart' }],
      'followers',
    )
    expect(md).toContain(`?v=${V}&token=secret-token`)
  })

  test('renders a prose-only article without dangling image sections', () => {
    const md = render([{ markdown: 'Just words', type: 'prose' }])
    expect(md).toBe('# My analysis\n\nJust words')
  })
})
