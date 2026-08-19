import type { ArticleContent } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { type BlockImageDataDeps, buildArticleMarkdown, renderableArticleBlocks } from './article-export.ts'

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
    // The label's `_` is markdown-escaped (#975), so the metric still reads through.
    expect(md).toContain('sleep\\_score')
  })

  test('uses the caption as alt text and adds an italic caption line', () => {
    const md = render([
      { caption: 'Overnight HR', end: WINDOW.end, metric: 'heart_rate', start: WINDOW.start, type: 'chart' },
    ])
    expect(md).toContain('![Overnight HR]')
    expect(md).toContain('*Overnight HR*')
  })

  test('escapes both `[` and `]` in the caption so an unbalanced bracket cannot break the image markdown', () => {
    const md = render([
      { caption: 'HR [bpm]', end: WINDOW.end, metric: 'heart_rate', start: WINDOW.start, type: 'chart' },
    ])
    // Both brackets escaped, so a lone `[` can't be matched against a later `]`.
    expect(md).toContain('![HR \\[bpm\\]]')
  })

  test('escapes an unbalanced lone `[` in the caption', () => {
    const md = render([
      { caption: 'run[ start', end: WINDOW.end, metric: 'heart_rate', start: WINDOW.start, type: 'chart' },
    ])
    expect(md).toContain('![run\\[ start]')
  })

  test('public/unlisted image URLs carry no token (a followers-only article is refused at the route)', () => {
    const md = render(
      [{ end: WINDOW.end, metric: 'heart_rate', start: WINDOW.start, type: 'chart' }],
      'unlisted',
    )
    expect(md).toContain(`?v=${V})`)
    expect(md).not.toContain('token=')
  })

  test('renders a prose-only article without dangling image sections', () => {
    const md = render([{ markdown: 'Just words', type: 'prose' }])
    expect(md).toBe('# My analysis\n\nJust words')
  })

  test('escapes `*` and `_` so the italic caption line stays one emphasis span (#975)', () => {
    const md = render([
      {
        caption: '5*3 sets and _underscored_',
        end: WINDOW.end,
        metric: 'heart_rate',
        start: WINDOW.start,
        type: 'chart',
      },
    ])
    expect(md).toContain('*5\\*3 sets and \\_underscored\\_*')
    expect(md).toContain('![5\\*3 sets and \\_underscored\\_]')
  })

  test('a block outside `renderableBlocks` gets a note instead of a dead image link (#974)', () => {
    const blocks: ArticleContent['blocks'] = [
      {
        caption: 'no data here',
        end: WINDOW.end,
        metric: 'blood_glucose',
        start: WINDOW.start,
        type: 'chart',
      },
      { caption: 'has data', end: WINDOW.end, metric: 'heart_rate', start: WINDOW.start, type: 'chart' },
    ]
    const md = buildArticleMarkdown(
      'https://aurboda.example/api',
      'fiddur',
      'POST',
      'public',
      'secret-token',
      UPDATED,
      article(blocks),
      new Set([1]),
    )
    expect(md).not.toContain('blocks/0/image.png')
    expect(md).toContain('*no data here — not enough data in this window.*')
    expect(md).toContain(`![has data](${base}/blocks/1/image.png?v=${V})`)
  })
})

describe('renderableArticleBlocks', () => {
  const CHART = { end: WINDOW.end, metric: 'heart_rate', start: WINDOW.start, type: 'chart' } as const
  const CORR = {
    end: WINDOW.end,
    outcome: { kind: 'metric', metric: 'sleep_score' },
    start: WINDOW.start,
    trigger: { kind: 'metric', metric: 'steps' },
    type: 'correlation',
  } as const

  const deps = (points: number, scatter: boolean): BlockImageDataDeps => ({
    chartSeries: async () => Array.from({ length: points }, (_, i) => i),
    correlationScatter: async () =>
      scatter
        ? {
            group_comparison: null,
            n: 3,
            outcome: CORR.outcome,
            pearson: null,
            pearson_p: null,
            series: [],
            spearman: null,
            trigger: CORR.trigger,
          }
        : null,
  })

  test('keeps blocks whose data draws; drops sparse ones (chart < 2 points, scatter null)', async () => {
    const blocks: ArticleContent['blocks'] = [{ markdown: 'p', type: 'prose' }, CHART, CORR]
    expect(await renderableArticleBlocks('u', article(blocks), deps(5, true))).toEqual(new Set([1, 2]))
    expect(await renderableArticleBlocks('u', article(blocks), deps(1, false))).toEqual(new Set())
  })

  test('drops a block with an unbounded window without fetching any data', async () => {
    let fetched = false
    const spying: BlockImageDataDeps = {
      chartSeries: async () => {
        fetched = true
        return [1, 2, 3]
      },
      correlationScatter: async () => null,
    }
    // No own window and no article default → unbounded → statically ineligible.
    const unbounded = { metric: 'heart_rate', type: 'chart' } as const
    expect(await renderableArticleBlocks('u', article([unbounded]), spying)).toEqual(new Set())
    expect(fetched).toBe(false)
  })
})
