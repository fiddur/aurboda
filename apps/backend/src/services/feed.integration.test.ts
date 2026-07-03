import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

/**
 * Integration tests for the shared feed service: resolving a stored feed post's
 * activity to its *merged span* (the window the detail view + share dialog show),
 * and serialising an enriched feed post. Backed by a real DB so the merge
 * (`resolveActivityWindow` → `getOverlappingActivities`) actually runs.
 */
import { deleteActivity, insertActivity } from '../db/activities/index.ts'
import { createFeedPost, type FeedPostInput } from '../db/feed.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { expandFeedActivityWindow, resolveFeedActivity, serializeFeedPost } from './feed.ts'

const CONTAINER_TIMEOUT = 120_000

// Two overlapping same-type activities merge into one 08:00–09:00 span; the
// anchor's own window is only 08:00–08:40.
const ANCHOR_START = new Date('2026-07-01T08:00:00Z')
const ANCHOR_END = new Date('2026-07-01T08:40:00Z')
const OTHER_START = new Date('2026-07-01T08:20:00Z')
const MERGED_END = new Date('2026-07-01T09:00:00Z')

const insertAnchor = (user: string): Promise<string> =>
  insertActivity(user, {
    activity_type: 'exercise',
    end_time: ANCHOR_END,
    source: 'garmin',
    start_time: ANCHOR_START,
    title: 'Merged run',
  })

const insertOverlap = (user: string): Promise<string> =>
  insertActivity(user, {
    activity_type: 'exercise',
    end_time: MERGED_END,
    source: 'strava',
    start_time: OTHER_START,
    title: 'Second half',
  })

const postInput = (activityId: string | null, overrides: Partial<FeedPostInput> = {}): FeedPostInput => ({
  activity_id: activityId,
  include_chart: false,
  include_map: false,
  included_metrics: ['duration'],
  series_metrics: [],
  visibility: 'public',
  ...overrides,
})

describe('feed service', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  describe('resolveFeedActivity', () => {
    test('expands a merged anchor to the full merged span (#881)', async () => {
      const user = getTestUser()
      const anchorId = await insertAnchor(user)
      await insertOverlap(user)

      const resolved = await resolveFeedActivity(user, anchorId)
      expect(resolved?.start_time.toISOString()).toBe(ANCHOR_START.toISOString())
      expect(resolved?.end_time?.toISOString()).toBe(MERGED_END.toISOString())
      expect(resolved?.title).toBe('Merged run')
      expect(resolved?.activity_type).toBe('exercise')
    })

    test('passes a lone (non-overlapping) activity through with its own window', async () => {
      const user = getTestUser()
      const anchorId = await insertAnchor(user) // no overlapping activity

      const resolved = await resolveFeedActivity(user, anchorId)
      expect(resolved?.start_time.toISOString()).toBe(ANCHOR_START.toISOString())
      expect(resolved?.end_time?.toISOString()).toBe(ANCHOR_END.toISOString())
    })

    test('returns null for a missing/deleted activity', async () => {
      const user = getTestUser()
      const anchorId = await insertAnchor(user)
      await deleteActivity(user, anchorId)
      expect(await resolveFeedActivity(user, anchorId)).toBeNull()
      expect(await resolveFeedActivity(user, '00000000-0000-0000-0000-000000000000')).toBeNull()
    })
  })

  describe('expandFeedActivityWindow', () => {
    test('expands an in-hand activity to its merged span', async () => {
      const user = getTestUser()
      const anchorId = await insertAnchor(user)
      await insertOverlap(user)

      // Simulate the share path (activity already loaded for its 404 check).
      const anchor = {
        activity_type: 'exercise' as const,
        end_time: ANCHOR_END,
        id: anchorId,
        source: 'garmin' as const,
        start_time: ANCHOR_START,
        title: 'Merged run',
      }
      const resolved = await expandFeedActivityWindow(user, anchor)
      expect(resolved.end_time?.toISOString()).toBe(MERGED_END.toISOString())
    })
  })

  describe('serializeFeedPost', () => {
    test('enriches a post with the activity title, type, and merged window (#891)', async () => {
      const user = getTestUser()
      const anchorId = await insertAnchor(user)
      await insertOverlap(user)
      const post = await createFeedPost(user, postInput(anchorId))

      const dto = await serializeFeedPost(user, post)
      expect(dto.activity_id).toBe(anchorId)
      expect(dto.activity_title).toBe('Merged run')
      expect(dto.activity_type).toBe('exercise')
      expect(dto.activity_start_time).toBe(ANCHOR_START.toISOString())
      expect(dto.activity_end_time).toBe(MERGED_END.toISOString())
      // Base fields still present.
      expect(dto.included_metrics).toEqual(['duration'])
      expect(dto.visibility).toBe('public')
    })

    test('omits activity fields for a non-activity post', async () => {
      const user = getTestUser()
      const post = await createFeedPost(user, postInput(null))
      const dto = await serializeFeedPost(user, post)
      expect(dto.activity_id).toBeNull()
      expect(dto.activity_title).toBeUndefined()
      expect(dto.activity_start_time).toBeUndefined()
    })

    test('omits activity fields when the shared activity was deleted', async () => {
      const user = getTestUser()
      const anchorId = await insertAnchor(user)
      const post = await createFeedPost(user, postInput(anchorId))
      await deleteActivity(user, anchorId)

      const dto = await serializeFeedPost(user, post)
      expect(dto.activity_id).toBe(anchorId)
      expect(dto.activity_title).toBeUndefined()
      expect(dto.activity_start_time).toBeUndefined()
    })
  })
})
