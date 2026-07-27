import type { ArticleContent } from '@aurboda/api-spec'

import { describe, expect, test, vi } from 'vitest'

import type { FeedPostRecord } from '../db/index.ts'

import {
  createRenderCache,
  type ImageActivity,
  resolveArticleBlock,
  resolveImageWindow,
} from './feed-image-router.ts'

const POST_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ACTIVITY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const activity: ImageActivity = {
  end_time: new Date('2026-07-01T07:11:00Z'),
  start_time: new Date('2026-07-01T06:30:00Z'),
}

const makePost = (overrides: Partial<FeedPostRecord> = {}): FeedPostRecord => ({
  activity_id: ACTIVITY_ID,
  article: null,
  created_at: new Date('2026-07-01T08:00:00Z'),
  id: POST_ID,
  image_token: 'secret-token',
  include_chart: true,
  include_map: true,
  included_metrics: [],
  kind: 'activity',
  series_metrics: [],
  updated_at: new Date('2026-07-01T08:00:00Z'),
  visibility: 'public',
  ...overrides,
})

const deps = (post: FeedPostRecord | null, act: ImageActivity | null = activity) => ({
  getActivity: async () => act,
  getPost: async () => post,
})

describe('resolveImageWindow', () => {
  test('resolves the activity window for an eligible public opted-in post', async () => {
    expect(await resolveImageWindow(deps(makePost()), 'fiddur', POST_ID, 'include_chart')).toEqual(activity)
  })

  test('null for an invalid username or non-UUID post id (no DB hit)', async () => {
    expect(await resolveImageWindow(deps(makePost()), 'Bad..Name', POST_ID, 'include_chart')).toBeNull()
    expect(await resolveImageWindow(deps(makePost()), 'fiddur', 'not-a-uuid', 'include_chart')).toBeNull()
  })

  test('null when the post is missing', async () => {
    expect(await resolveImageWindow(deps(null), 'fiddur', POST_ID, 'include_chart')).toBeNull()
  })

  test('null for a followers-only post without a token', async () => {
    const post = makePost({ image_token: 'secret-token', visibility: 'followers' })
    expect(await resolveImageWindow(deps(post), 'fiddur', POST_ID, 'include_chart')).toBeNull()
  })

  test('null for a followers-only post with the wrong token', async () => {
    const post = makePost({ image_token: 'secret-token', visibility: 'followers' })
    expect(await resolveImageWindow(deps(post), 'fiddur', POST_ID, 'include_chart', 'wrong')).toBeNull()
    // A prefix of the real token must not pass (length-checked constant-time compare).
    expect(await resolveImageWindow(deps(post), 'fiddur', POST_ID, 'include_chart', 'secret')).toBeNull()
  })

  test('resolves a followers-only post when the capability token matches (#893)', async () => {
    const post = makePost({ image_token: 'secret-token', visibility: 'followers' })
    expect(await resolveImageWindow(deps(post), 'fiddur', POST_ID, 'include_chart', 'secret-token')).toEqual(
      activity,
    )
  })

  test('a token is ignored for a public post (already unauthenticated)', async () => {
    expect(
      await resolveImageWindow(deps(makePost()), 'fiddur', POST_ID, 'include_chart', 'anything'),
    ).toEqual(activity)
  })

  test('null when the requested attachment was not opted into', async () => {
    const post = makePost({ include_chart: false })
    expect(await resolveImageWindow(deps(post), 'fiddur', POST_ID, 'include_chart')).toBeNull()
    // ...but the map flag is still on for the same post.
    expect(await resolveImageWindow(deps(post), 'fiddur', POST_ID, 'include_map')).toEqual(activity)
  })

  test('null when the post has no linked activity', async () => {
    expect(
      await resolveImageWindow(deps(makePost({ activity_id: null })), 'fiddur', POST_ID, 'include_chart'),
    ).toBeNull()
  })

  test('null for an open-ended activity (no bounded window)', async () => {
    const openEnded = { start_time: activity.start_time }
    expect(await resolveImageWindow(deps(makePost(), openEnded), 'fiddur', POST_ID, 'include_map')).toBeNull()
  })
})

const WINDOW = { end: '2026-07-02T00:00:00Z', start: '2026-07-01T00:00:00Z' }

const article = (blocks: ArticleContent['blocks'], extra: Partial<ArticleContent> = {}): ArticleContent => ({
  blocks,
  title: 'My analysis',
  ...extra,
})

const articlePost = (content: ArticleContent, overrides: Partial<FeedPostRecord> = {}): FeedPostRecord =>
  makePost({ activity_id: null, article: content, kind: 'article', ...overrides })

describe('resolveArticleBlock', () => {
  const chart = article([{ end: WINDOW.end, metric: 'heart_rate', start: WINDOW.start, type: 'chart' }])
  const correlation = article([
    {
      end: WINDOW.end,
      outcome: { kind: 'metric', metric: 'sleep_score' },
      start: WINDOW.start,
      trigger: { kind: 'metric', metric: 'steps' },
      type: 'correlation',
    },
  ])

  test('resolves a chart block to its metric and window', async () => {
    const block = await resolveArticleBlock(deps(articlePost(chart)), 'fiddur', POST_ID, 0)
    expect(block).toMatchObject({
      end: new Date(WINDOW.end),
      metric: 'heart_rate',
      start: new Date(WINDOW.start),
      type: 'chart',
    })
  })

  test('resolves a correlation block with its selectors', async () => {
    const block = await resolveArticleBlock(deps(articlePost(correlation)), 'fiddur', POST_ID, 0)
    expect(block).toMatchObject({
      outcome: { kind: 'metric', metric: 'sleep_score' },
      trigger: { kind: 'metric', metric: 'steps' },
      type: 'correlation',
    })
  })

  test('inherits the article default window when the block omits its own', async () => {
    const content = article([{ metric: 'heart_rate', type: 'chart' }], {
      default_end: WINDOW.end,
      default_start: WINDOW.start,
    })
    const block = await resolveArticleBlock(deps(articlePost(content)), 'fiddur', POST_ID, 0)
    expect(block).toMatchObject({ end: new Date(WINDOW.end), start: new Date(WINDOW.start), type: 'chart' })
  })

  test('carries the post updated_at (so an edit busts the image cache)', async () => {
    const updated_at = new Date('2026-07-05T09:00:00Z')
    const block = await resolveArticleBlock(deps(articlePost(chart, { updated_at })), 'fiddur', POST_ID, 0)
    expect(block?.updatedAt).toEqual(updated_at)
  })

  test('null for a prose block, an out-of-range, negative, or non-integer index', async () => {
    const content = article([{ markdown: '# hi', type: 'prose' }, ...chart.blocks])
    expect(await resolveArticleBlock(deps(articlePost(content)), 'fiddur', POST_ID, 0)).toBeNull() // prose
    expect(await resolveArticleBlock(deps(articlePost(content)), 'fiddur', POST_ID, 5)).toBeNull() // out of range
    expect(await resolveArticleBlock(deps(articlePost(content)), 'fiddur', POST_ID, -1)).toBeNull()
    expect(await resolveArticleBlock(deps(articlePost(content)), 'fiddur', POST_ID, 1.5)).toBeNull()
    expect(await resolveArticleBlock(deps(articlePost(content)), 'fiddur', POST_ID, Number.NaN)).toBeNull()
  })

  test('null for a non-article post', async () => {
    expect(await resolveArticleBlock(deps(makePost()), 'fiddur', POST_ID, 0)).toBeNull()
  })

  test('gated on visibility only — no include_chart flag needed for an article', async () => {
    // A public article block resolves even with include_chart off (articles have
    // no opt-in flag; visibility is the whole boundary, #943).
    const post = articlePost(chart, { include_chart: false })
    expect(await resolveArticleBlock(deps(post), 'fiddur', POST_ID, 0)).not.toBeNull()
  })

  test('followers-only: null without a token, resolves with the matching token, null with a wrong one', async () => {
    const post = articlePost(chart, { image_token: 'secret-token', visibility: 'followers' })
    expect(await resolveArticleBlock(deps(post), 'fiddur', POST_ID, 0)).toBeNull()
    expect(await resolveArticleBlock(deps(post), 'fiddur', POST_ID, 0, 'wrong')).toBeNull()
    expect(await resolveArticleBlock(deps(post), 'fiddur', POST_ID, 0, 'secret-token')).not.toBeNull()
  })

  test('null when a block resolves to an unbounded or non-increasing window', async () => {
    const noWindow = article([{ metric: 'heart_rate', type: 'chart' }]) // no block window, no article default
    expect(await resolveArticleBlock(deps(articlePost(noWindow)), 'fiddur', POST_ID, 0)).toBeNull()
    const reversed = article([{ end: WINDOW.start, metric: 'heart_rate', start: WINDOW.end, type: 'chart' }])
    expect(await resolveArticleBlock(deps(articlePost(reversed)), 'fiddur', POST_ID, 0)).toBeNull()
  })

  test('null for an invalid username or non-UUID post id (no DB hit)', async () => {
    expect(await resolveArticleBlock(deps(articlePost(chart)), 'Bad..Name', POST_ID, 0)).toBeNull()
    expect(await resolveArticleBlock(deps(articlePost(chart)), 'fiddur', 'not-a-uuid', 0)).toBeNull()
  })
})

describe('createRenderCache', () => {
  const png = (s: string) => Buffer.from(s)

  test('renders once per key, then serves the cached buffer', async () => {
    const cached = createRenderCache()
    const produce = vi.fn(async () => png('a'))
    expect(await cached('k', produce)).toEqual(png('a'))
    expect(await cached('k', produce)).toEqual(png('a'))
    expect(produce).toHaveBeenCalledTimes(1)
  })

  test('de-duplicates concurrent misses into a single render', async () => {
    const cached = createRenderCache()
    const produce = vi.fn(async () => png('b'))
    const [a, b] = await Promise.all([cached('k', produce), cached('k', produce)])
    expect(a).toEqual(png('b'))
    expect(b).toEqual(png('b'))
    expect(produce).toHaveBeenCalledTimes(1)
  })

  test('renders separately per key', async () => {
    const cached = createRenderCache()
    const produce = vi.fn(async (): Promise<Buffer | null> => png('x'))
    await cached('k1', produce)
    await cached('k2', produce)
    expect(produce).toHaveBeenCalledTimes(2)
  })

  test('does not cache a null (no-data) result', async () => {
    const cached = createRenderCache()
    const produce = vi.fn(async (): Promise<Buffer | null> => null)
    expect(await cached('k', produce)).toBeNull()
    expect(await cached('k', produce)).toBeNull()
    expect(produce).toHaveBeenCalledTimes(2)
  })

  test('evicts the oldest entry past the bound', async () => {
    const cached = createRenderCache(1)
    const produce = vi.fn(async (): Promise<Buffer | null> => png('v'))
    await cached('k1', produce) // cached
    await cached('k2', produce) // evicts k1
    await cached('k1', produce) // re-renders (was evicted)
    expect(produce).toHaveBeenCalledTimes(3)
  })
})
