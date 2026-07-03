import { describe, expect, test, vi } from 'vitest'

import type { FeedPostRecord } from '../db/index.ts'

import { createRenderCache, type ImageActivity, resolveImageWindow } from './feed-image-router.ts'

const POST_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ACTIVITY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const activity: ImageActivity = {
  end_time: new Date('2026-07-01T07:11:00Z'),
  start_time: new Date('2026-07-01T06:30:00Z'),
}

const makePost = (overrides: Partial<FeedPostRecord> = {}): FeedPostRecord => ({
  activity_id: ACTIVITY_ID,
  created_at: new Date('2026-07-01T08:00:00Z'),
  id: POST_ID,
  include_chart: true,
  include_map: true,
  included_metrics: [],
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

  test('null for a followers-only post', async () => {
    const post = makePost({ visibility: 'followers' })
    expect(await resolveImageWindow(deps(post), 'fiddur', POST_ID, 'include_chart')).toBeNull()
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
