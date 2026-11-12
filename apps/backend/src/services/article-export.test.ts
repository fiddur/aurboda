import type { ArticleContent } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { impactData } from '../test/impact-fixture.ts'
import { articleBlockCacheKey, createNegativeCache } from './article-block-misses.ts'
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
    // The label's `_` is markdown-escaped, so the metric still reads through.
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

describe('buildArticleMarkdown — impact blocks', () => {
  const IMPACT = { ...WINDOW, activity: 'yoga', activity_type: 'activity_type', type: 'impact' } as const

  test('links the impact image, labelled with the activity', () => {
    expect(render([IMPACT])).toContain(`![Impact of yoga](${base}/blocks/0/image.png?v=${V})`)
  })

  test('says there is not enough data when the image would not draw', () => {
    const md = buildArticleMarkdown(
      'https://aurboda.example/api',
      'fiddur',
      'POST',
      'public',
      'secret-token',
      UPDATED,
      article([IMPACT]),
      new Set(),
    )
    expect(md).toContain('*Impact of yoga — not enough data in this window.*')
  })
})

describe('buildArticleMarkdown — challenge blocks', () => {
  const CHALLENGE = {
    caption: 'Join *us*',
    challenge_url: 'https://qs.example/u/olle/nov',
    type: 'challenge',
  } as const

  test('renders the standings image, the caption and a join link', () => {
    const md = render([CHALLENGE])
    expect(md).toContain(`![Join \\*us\\*](${base}/blocks/0/image.png?v=${V})`)
    expect(md).toContain('*Join \\*us\\**')
    expect(md).toContain('[Join the challenge](https://qs.example/u/olle/nov)')
  })

  test('without drawable standings, keeps the caption and the join link but no image', () => {
    const md = buildArticleMarkdown(
      'https://aurboda.example/api',
      'fiddur',
      'POST',
      'public',
      'secret-token',
      UPDATED,
      article([{ challenge_url: 'https://qs.example/u/olle/nov', type: 'challenge' }]),
      new Set(),
    )
    expect(md).not.toContain('![')
    expect(md).not.toContain('not enough data')
    expect(md).toContain('[Join the challenge](https://qs.example/u/olle/nov)')
  })

  test('escapes characters that would break the link target', () => {
    const md = render([{ challenge_url: 'https://qs.example/u/olle/nov?x=(1) 2', type: 'challenge' }])
    expect(md).toContain('[Join the challenge](https://qs.example/u/olle/nov?x=%281%29%202)')
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

  const POST_ID = '11111111-1111-4111-8111-111111111111'

  const race = (lines: number) => ({
    asOf: UPDATED,
    endTime: UPDATED,
    lines: Array.from({ length: lines }, () => ({
      color: '#2b9ea7',
      name: 'olle',
      points: [[UPDATED, 0] as [Date, number]],
    })),
    startTime: UPDATED,
    timezone: 'UTC',
    title: 'Steps',
  })

  const deps = (
    points: number,
    scatter: boolean,
    misses = createNegativeCache(),
    raceLines: number | null = null,
    sessions = 0,
  ): BlockImageDataDeps => ({
    challengeRace: async () => (raceLines == null ? null : race(raceLines)),
    chartSeries: async () => Array.from({ length: points }, (_, i) => i),
    impact: async () => impactData({ occurrences: sessions }),
    misses,
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
    expect(await renderableArticleBlocks('u', POST_ID, article(blocks), deps(5, true))).toEqual(
      new Set([1, 2]),
    )
    expect(await renderableArticleBlocks('u', POST_ID, article(blocks), deps(1, false))).toEqual(new Set())
  })

  test('keeps a challenge block only when its race has a line to draw', async () => {
    const CHALLENGE = { challenge_url: 'https://qs.example/u/olle/nov', type: 'challenge' } as const
    const blocks: ArticleContent['blocks'] = [CHALLENGE]
    expect(
      await renderableArticleBlocks('u', POST_ID, article(blocks), deps(0, false, undefined, 1)),
    ).toEqual(new Set([0]))
    expect(
      await renderableArticleBlocks('u', POST_ID, article(blocks), deps(0, false, undefined, 0)),
    ).toEqual(new Set())
    expect(await renderableArticleBlocks('u', POST_ID, article(blocks), deps(0, false))).toEqual(new Set())
  })

  test('forgets the remembered 404s of every block it finds drawable, and only those', async () => {
    const misses = createNegativeCache()
    const updated = new Date('2026-09-01T00:00:00Z')
    const keys = [0, 1, 2].flatMap((index) =>
      (['blockpng', 'blocksvg'] as const).map((kind) =>
        articleBlockCacheKey(kind, 'u', POST_ID, index, updated),
      ),
    )
    for (const key of keys) misses.add(key)
    const otherPost = articleBlockCacheKey(
      'blockpng',
      'u',
      '22222222-2222-4222-8222-222222222222',
      1,
      updated,
    )
    misses.add(otherPost)

    const blocks: ArticleContent['blocks'] = [{ markdown: 'p', type: 'prose' }, CHART, CORR]
    await renderableArticleBlocks('u', POST_ID, article(blocks), deps(5, false, misses))

    expect(keys.map((key) => misses.has(key))).toEqual([true, true, false, false, true, true])
    expect(misses.has(otherPost)).toBe(true)
  })

  test('keeps an impact block only when it has sessions to draw', async () => {
    const IMPACT = { ...WINDOW, activity: 'yoga', activity_type: 'activity_type', type: 'impact' } as const
    const blocks: ArticleContent['blocks'] = [IMPACT]
    expect(
      await renderableArticleBlocks('u', POST_ID, article(blocks), deps(0, false, undefined, null, 3)),
    ).toEqual(new Set([0]))
    expect(await renderableArticleBlocks('u', POST_ID, article(blocks), deps(0, false))).toEqual(new Set())
  })

  test('drops a block with an unbounded window without fetching any data', async () => {
    let fetched = false
    const spying: BlockImageDataDeps = {
      challengeRace: async () => null,
      chartSeries: async () => {
        fetched = true
        return [1, 2, 3]
      },
      correlationScatter: async () => null,
      impact: async () => {
        fetched = true
        return impactData()
      },
      misses: createNegativeCache(),
    }
    // No own window and no article default → unbounded → statically ineligible.
    const unbounded = { metric: 'heart_rate', type: 'chart' } as const
    expect(await renderableArticleBlocks('u', POST_ID, article([unbounded]), spying)).toEqual(new Set())
    expect(fetched).toBe(false)
  })
})
