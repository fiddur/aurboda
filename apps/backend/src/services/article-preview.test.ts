import type { ArticleDraftContent, PreviewArticleBody } from '@aurboda/api-spec'

import { previewArticleBodySchema } from '@aurboda/api-spec'
import { describe, expect, test, vi } from 'vitest'

import type { ArticlePreviewDeps } from './article-preview.ts'

import { createArticlePreviewer, previewableArticle, previewArticle } from './article-preview.ts'

const WINDOW = { default_end: '2026-07-07T00:00:00.000Z', default_start: '2026-07-01T00:00:00.000Z' }
const POINTS: [Date, number][] = [
  [new Date('2026-07-01T00:00:00Z'), 60],
  [new Date('2026-07-02T00:00:00Z'), 62],
]

const chart = { caption: 'Resting HR', metric: 'heart_rate', type: 'chart' } as const

const deps = (overrides: Partial<ArticlePreviewDeps> = {}): ArticlePreviewDeps => ({
  chartDeps: {
    getArticleChartSeries: vi.fn(async () => POINTS),
    getArticleImpact: vi.fn(),
    getChallengeRaceByUrl: vi.fn(async () => null),
    getCorrelationScatter: vi.fn(async () => null),
  },
  checkContent: async (content) => ({ article: content, ok: true }),
  now: () => Date.parse('2026-07-10T12:00:00Z'),
  postTags: async (_user, content) => ['coffee', ...(content.title.includes('#yoga') ? ['yoga'] : [])],
  webHost: 'https://aurboda.example',
  ...overrides,
})

const body = (article: ArticleDraftContent, extra: Partial<PreviewArticleBody> = {}): PreviewArticleBody =>
  previewArticleBodySchema.parse({ article, ...extra })

describe('previewableArticle', () => {
  test('keeps complete blocks only, with their original indices, and titles a blank draft', () => {
    const { article, indices } = previewableArticle({
      ...WINDOW,
      blocks: [
        { markdown: 'Coffee first', type: 'prose' },
        { type: 'chart' },
        chart,
        { outcome: { kind: 'metric', metric: 'hrv' }, type: 'correlation' },
        {
          outcome: { kind: 'metric', metric: 'hrv' },
          trigger: { kind: 'activity', pattern: '' },
          type: 'correlation',
        },
        { challenge_url: 'https://ex.example/not-a-challenge', type: 'challenge' },
        { challenge_url: 'https://ex.example/u/alice/running-may/', type: 'challenge' },
        { activity_type: 'activity_type', type: 'impact' },
        { ...chart, end: '2026-06-01T00:00:00.000Z' },
      ],
      title: '  ',
    })
    expect(indices).toEqual([0, 2, 6])
    expect(article.title).toBe('Untitled')
    expect(article.blocks.map((b) => b.type)).toEqual(['prose', 'chart', 'challenge'])
    expect(article.blocks[2]).toMatchObject({ challenge_url: 'https://ex.example/u/alice/running-may' })
  })

  test('drops a windowed block without any window', () => {
    expect(previewableArticle({ blocks: [chart], title: 'Yoga' }).indices).toEqual([])
  })
})

describe('previewArticle', () => {
  test('previews an incomplete draft: complete blocks only, with what keeps it from publishing', async () => {
    const preview = await previewArticle(
      'alice',
      body({ ...WINDOW, blocks: [{ type: 'chart' }, chart], title: '' }),
      deps(),
    )
    expect(preview.publish_error).toBe('Give the article a title before publishing.')
    expect(preview.name).toBe('Untitled')
    expect(preview.content).toContain('<p><strong>Untitled</strong></p>')
    expect(preview.attachments).toEqual([
      {
        block_index: 1,
        figure: 1,
        height: expect.any(Number),
        media_type: 'image/png',
        name: 'Figure 1: Resting HR',
        shown_in_mastodon: true,
        width: expect.any(Number),
      },
    ])
  })

  test('a publishable draft has no publish error; a failing lookup check is reported', async () => {
    const article = { ...WINDOW, blocks: [chart], title: 'Coffee' }
    expect((await previewArticle('alice', body(article), deps())).publish_error).toBeNull()
    const failing = deps({
      checkContent: async () => ({ error: 'Block 1: challenge not found.', ok: false }),
    })
    expect((await previewArticle('alice', body(article), failing)).publish_error).toBe(
      'Block 1: challenge not found.',
    )
  })

  test('links the tags and moves the trailing ones into the hashtag bar', async () => {
    const preview = await previewArticle(
      'alice',
      body({ blocks: [{ markdown: 'Morning #yoga', type: 'prose' }], title: 'Stretch #yoga' }),
      deps(),
    )
    expect(preview.tags).toEqual(['coffee', 'yoga'])
    expect(preview.content).toContain('class="mention hashtag"')
    expect(preview.content).toMatch(/<p><a [^>]*>#<span>coffee<\/span><\/a><\/p>$/)
    expect(preview.mastodon.content).not.toContain('#<span>coffee</span>')
    expect(preview.mastodon.content).toContain('#<span>yoga</span>')
    expect(preview.mastodon.content).toContain('rel="nofollow noopener"')
    expect(preview.mastodon.hashtag_bar).toEqual(['coffee'])
    expect(preview.mastodon.attachment_limit).toBe(4)
  })

  test('without a web host the tags stay plain text and all go in the bar', async () => {
    const preview = await previewArticle(
      'alice',
      body({ blocks: [], title: 'Stretch #yoga' }),
      deps({ webHost: undefined }),
    )
    expect(preview.content).not.toContain('<a ')
    expect(preview.mastodon.hashtag_bar).toEqual(['coffee', 'yoga'])
  })

  test('draws block figures only with include_images, titled like the Note', async () => {
    const article = { ...WINDOW, blocks: [chart], title: 'Coffee' }
    const without = await previewArticle('alice', body(article), deps())
    expect(without.attachments[0]).not.toHaveProperty('image_svg')
    const preview = await previewArticle('alice', body(article, { include_images: true }), deps())
    const svg = preview.attachments[0].image_svg
    expect(svg).toMatch(/^<svg /)
    expect(svg).toContain('Figure 1')
    expect(svg).toContain('Resting HR')
    expect(preview.notes).toEqual([])
  })

  test('a block with no data to draw has a null image and a note', async () => {
    const empty = deps()
    empty.chartDeps.getArticleChartSeries = async () => []
    const preview = await previewArticle(
      'alice',
      body({ ...WINDOW, blocks: [chart], title: 'Coffee' }, { include_images: true }),
      empty,
    )
    expect(preview.attachments[0].image_svg).toBeNull()
    expect(preview.notes).toEqual(['Figure 1 has no data to draw yet, so its image will be missing.'])
  })

  test('past four figures: not shown in Mastodon, linked in the text, and noted', async () => {
    const preview = await previewArticle(
      'alice',
      body(
        { ...WINDOW, blocks: Array.from({ length: 6 }, () => chart), title: 'Coffee' },
        { include_images: true },
      ),
      deps(),
    )
    expect(preview.attachments.map((a) => a.shown_in_mastodon)).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
    ])
    expect(preview.attachments[4]).not.toHaveProperty('image_svg')
    expect(preview.attachments[4]).not.toHaveProperty('url')
    expect(preview.content).toContain('<a href="#figure-5">Figure 5</a>')
    expect(preview.mastodon.content).toContain('<em>Figure 5: Resting HR</em>')
    expect(preview.mastodon.hashtag_bar).toEqual(['coffee'])
    expect(preview.notes).toEqual([
      'Mastodon shows the first 4 images. Figures 5 to 6 are linked in the text instead.',
    ])
  })

  test('one hidden figure, the crop note for two or three, and a prose image keeps its URL', async () => {
    const five = await previewArticle(
      'alice',
      body({ ...WINDOW, blocks: Array.from({ length: 5 }, () => chart), title: 'Coffee' }),
      deps(),
    )
    expect(five.notes).toEqual(['Mastodon shows the first 4 images. Figure 5 is linked in the text instead.'])
    const two = await previewArticle(
      'alice',
      body({
        ...WINDOW,
        blocks: [chart, { markdown: '![Cup](https://ex.example/cup.png)', type: 'prose' }],
        title: 'Coffee',
      }),
      deps(),
    )
    expect(two.attachments[1]).toEqual({
      figure: 2,
      media_type: 'image/png',
      name: 'Figure 2: Cup',
      shown_in_mastodon: true,
      url: 'https://ex.example/cup.png',
    })
    expect(two.notes).toEqual([
      'Mastodon crops images in a grid of two or three. The full image opens when clicked.',
    ])
  })

  test('followers-only with a block figure notes the private token', async () => {
    const preview = await previewArticle(
      'alice',
      body({ ...WINDOW, blocks: [chart], title: 'Coffee' }, { visibility: 'followers' }),
      deps(),
    )
    expect(preview.notes).toEqual([
      'Followers-only: the image links carry a private token that only your followers receive.',
    ])
  })

  test('a previewer draws each figure once while only the prose changes', async () => {
    const d = deps()
    const preview = createArticlePreviewer(d)
    const article = (prose: string) => ({
      ...WINDOW,
      blocks: [{ markdown: prose, type: 'prose' as const }, chart],
      title: 'Coffee',
    })
    await preview('alice', body(article('Morning'), { include_images: true }))
    await preview('alice', body(article('Morning run'), { include_images: true }))
    expect(d.chartDeps.getArticleChartSeries).toHaveBeenCalledTimes(1)
  })
})
