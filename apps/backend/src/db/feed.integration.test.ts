import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

/**
 * Integration tests for feed-post CRUD and the series-authorization window
 * lookup that guards the public `/series` endpoint.
 */
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { deleteActivity, insertActivity } from './activities/index.ts'
import {
  countPublicFeedPosts,
  createFeedPost,
  deleteFeedPost,
  type FeedPostInput,
  findCoveringSharedSeriesWindow,
  getFeedPostById,
  getFeedTombstone,
  listFeedPosts,
  listPublicFeedPosts,
  listPublicFeedPostsPage,
  updateFeedPost,
} from './feed.ts'

const CONTAINER_TIMEOUT = 120_000

const ACTIVITY_START = new Date('2026-07-01T06:30:00Z')
const ACTIVITY_END = new Date('2026-07-01T07:11:00Z')

const insertExercise = (user: string): Promise<string> =>
  insertActivity(user, {
    activity_type: 'exercise',
    end_time: ACTIVITY_END,
    source: 'garmin',
    start_time: ACTIVITY_START,
    title: 'Morning run',
  })

const postInput = (overrides: Partial<FeedPostInput> = {}): FeedPostInput => ({
  activity_id: null,
  include_chart: false,
  include_map: false,
  included_metrics: ['duration', 'distance', 'heart_rate_avg'],
  series_metrics: [],
  visibility: 'public',
  ...overrides,
})

describe('Feed posts integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('creates a post and round-trips by id', async () => {
    const user = getTestUser()
    const activityId = await insertExercise(user)
    const created = await createFeedPost(
      user,
      postInput({ activity_id: activityId, series_metrics: ['heart_rate'] }),
    )

    expect(created.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(created.activity_id).toBe(activityId)
    expect(created.included_metrics).toEqual(['duration', 'distance', 'heart_rate_avg'])
    expect(created.series_metrics).toEqual(['heart_rate'])
    expect(created.visibility).toBe('public')

    const fetched = await getFeedPostById(user, created.id)
    expect(fetched?.id).toBe(created.id)
    expect(await getFeedPostById(user, '00000000-0000-0000-0000-000000000000')).toBeNull()
  })

  test('assigns an unguessable image_token that round-trips (#893)', async () => {
    const user = getTestUser()
    const created = await createFeedPost(user, postInput())
    // Non-empty and unguessable (a UUID by default).
    expect(created.image_token).toMatch(/^[0-9a-f-]{36}$/)
    // Distinct per post, and stable on re-read.
    const other = await createFeedPost(user, postInput())
    expect(other.image_token).not.toBe(created.image_token)
    expect((await getFeedPostById(user, created.id))?.image_token).toBe(created.image_token)
  })

  test('lists posts newest-first', async () => {
    const user = getTestUser()
    const first = await createFeedPost(user, postInput())
    const second = await createFeedPost(user, postInput())
    const posts = await listFeedPosts(user)
    expect(posts.map((p) => p.id)).toEqual([second.id, first.id])
  })

  test('updates selected fields and leaves others intact', async () => {
    const user = getTestUser()
    const created = await createFeedPost(user, postInput({ series_metrics: ['heart_rate'] }))

    const updated = await updateFeedPost(user, created.id, {
      series_metrics: ['heart_rate', 'stress_level'],
      visibility: 'unlisted',
    })
    expect(updated?.series_metrics).toEqual(['heart_rate', 'stress_level'])
    expect(updated?.visibility).toBe('unlisted')
    expect(updated?.included_metrics).toEqual(created.included_metrics)

    // Empty patch is a no-op that still returns the current record.
    const noop = await updateFeedPost(user, created.id, {})
    expect(noop?.id).toBe(created.id)
    expect(await updateFeedPost(user, '00000000-0000-0000-0000-000000000000', {})).toBeNull()
  })

  test('deletes a post', async () => {
    const user = getTestUser()
    const created = await createFeedPost(user, postInput())
    expect(await deleteFeedPost(user, created.id)).toBe(true)
    expect(await deleteFeedPost(user, created.id)).toBe(false)
    expect(await getFeedPostById(user, created.id)).toBeNull()
  })

  describe('tombstones on delete', () => {
    test('records a tombstone for a deleted public post', async () => {
      const user = getTestUser()
      const created = await createFeedPost(user, postInput({ visibility: 'public' }))
      expect(await getFeedTombstone(user, created.id)).toBeNull()

      await deleteFeedPost(user, created.id)
      const tomb = await getFeedTombstone(user, created.id)
      expect(tomb).not.toBeNull()
      expect(tomb?.deleted_at).toBeInstanceOf(Date)
    })

    test('records a tombstone for a deleted unlisted post', async () => {
      const user = getTestUser()
      const created = await createFeedPost(user, postInput({ visibility: 'unlisted' }))
      await deleteFeedPost(user, created.id)
      expect(await getFeedTombstone(user, created.id)).not.toBeNull()
    })

    test('does NOT tombstone a deleted followers-only post (its id never resolved publicly)', async () => {
      const user = getTestUser()
      const created = await createFeedPost(user, postInput({ visibility: 'followers' }))
      await deleteFeedPost(user, created.id)
      expect(await getFeedTombstone(user, created.id)).toBeNull()
    })

    test('has no tombstone for a live (never-deleted) post', async () => {
      const user = getTestUser()
      const created = await createFeedPost(user, postInput({ visibility: 'public' }))
      expect(await getFeedTombstone(user, created.id)).toBeNull()
    })
  })

  describe('public outbox listing', () => {
    test('lists public and unlisted posts newest-first, excluding followers-only', async () => {
      const user = getTestUser()
      const pub = await createFeedPost(user, postInput({ visibility: 'public' }))
      const unlisted = await createFeedPost(user, postInput({ visibility: 'unlisted' }))
      await createFeedPost(user, postInput({ visibility: 'followers' }))

      const posts = await listPublicFeedPosts(user)
      expect(posts.map((p) => p.id)).toEqual([unlisted.id, pub.id])
      expect(await countPublicFeedPosts(user)).toBe(2)
    })

    test('are empty when the user has only followers-only posts', async () => {
      const user = getTestUser()
      await createFeedPost(user, postInput({ visibility: 'followers' }))
      expect(await listPublicFeedPosts(user)).toEqual([])
      expect(await countPublicFeedPosts(user)).toBe(0)
    })

    test('listPublicFeedPostsPage returns newest-first pages by limit/offset', async () => {
      const user = getTestUser()
      const a = await createFeedPost(user, postInput())
      const b = await createFeedPost(user, postInput())
      const c = await createFeedPost(user, postInput())
      // Newest-first: c, b, a
      expect((await listPublicFeedPostsPage(user, 2, 0)).map((p) => p.id)).toEqual([c.id, b.id])
      expect((await listPublicFeedPostsPage(user, 2, 2)).map((p) => p.id)).toEqual([a.id])
      expect(await listPublicFeedPostsPage(user, 2, 4)).toEqual([])
    })
  })

  describe('findCoveringSharedSeriesWindow', () => {
    const within = { end: new Date('2026-07-01T07:00:00Z'), start: new Date('2026-07-01T06:40:00Z') }

    test('resolves when a public post shares the series and the activity covers the range', async () => {
      const user = getTestUser()
      const activityId = await insertExercise(user)
      await createFeedPost(user, postInput({ activity_id: activityId, series_metrics: ['heart_rate'] }))

      const window = await findCoveringSharedSeriesWindow(user, 'heart_rate', within.start, within.end)
      expect(window?.start_time.toISOString()).toBe(ACTIVITY_START.toISOString())
      expect(window?.end_time.toISOString()).toBe(ACTIVITY_END.toISOString())
    })

    test('resolves for an unlisted post', async () => {
      const user = getTestUser()
      const activityId = await insertExercise(user)
      await createFeedPost(
        user,
        postInput({ activity_id: activityId, series_metrics: ['heart_rate'], visibility: 'unlisted' }),
      )
      expect(
        await findCoveringSharedSeriesWindow(user, 'heart_rate', within.start, within.end),
      ).not.toBeNull()
    })

    test('does NOT resolve a metric that was only shared as a scalar (not a series)', async () => {
      const user = getTestUser()
      const activityId = await insertExercise(user)
      await createFeedPost(
        user,
        postInput({ activity_id: activityId, included_metrics: ['heart_rate'], series_metrics: [] }),
      )
      expect(await findCoveringSharedSeriesWindow(user, 'heart_rate', within.start, within.end)).toBeNull()
    })

    test('does NOT resolve for a followers-only post', async () => {
      const user = getTestUser()
      const activityId = await insertExercise(user)
      await createFeedPost(
        user,
        postInput({ activity_id: activityId, series_metrics: ['heart_rate'], visibility: 'followers' }),
      )
      expect(await findCoveringSharedSeriesWindow(user, 'heart_rate', within.start, within.end)).toBeNull()
    })

    test('does NOT resolve a window that extends outside the activity', async () => {
      const user = getTestUser()
      const activityId = await insertExercise(user)
      await createFeedPost(user, postInput({ activity_id: activityId, series_metrics: ['heart_rate'] }))

      // Ends after the activity ends.
      const outside = { end: new Date('2026-07-01T08:00:00Z'), start: within.start }
      expect(await findCoveringSharedSeriesWindow(user, 'heart_rate', outside.start, outside.end)).toBeNull()
    })

    test('does NOT resolve a different metric', async () => {
      const user = getTestUser()
      const activityId = await insertExercise(user)
      await createFeedPost(user, postInput({ activity_id: activityId, series_metrics: ['heart_rate'] }))
      expect(await findCoveringSharedSeriesWindow(user, 'stress_level', within.start, within.end)).toBeNull()
    })

    test('does NOT resolve once the activity is soft-deleted', async () => {
      const user = getTestUser()
      const activityId = await insertExercise(user)
      await createFeedPost(user, postInput({ activity_id: activityId, series_metrics: ['heart_rate'] }))
      await deleteActivity(user, activityId)
      expect(await findCoveringSharedSeriesWindow(user, 'heart_rate', within.start, within.end)).toBeNull()
    })
  })
})
