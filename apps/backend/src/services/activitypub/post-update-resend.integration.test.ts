import { Update } from '@fedify/fedify/vocab'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import type { FeedDeliveryDeps } from './deliver.ts'

import { insertActivity } from '../../db/activities/index.ts'
import { createArticlePost, createFeedPost, deleteFeedPost, listPublicFeedPosts } from '../../db/feed.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../../test/db-test-helper.ts'
import { createFeedFederation } from './federation.ts'
import { createPostUpdateResender, deliverPostUpdate } from './post-update-resend.ts'

const CONTAINER_TIMEOUT = 120_000
const ORIGIN = 'https://aurboda.example'

const fakeDeps = async () => {
  const ctx = await createFeedFederation(ORIGIN, `${ORIGIN}/api`).createContext(new URL(ORIGIN))
  const sendActivity = vi.fn().mockResolvedValue(undefined)
  Object.assign(ctx, { sendActivity })
  const deps: FeedDeliveryDeps = {
    apiBaseUrl: `${ORIGIN}/api`,
    federation: { createContext: async () => ctx } as unknown as FeedDeliveryDeps['federation'],
    origin: ORIGIN,
  }
  return { deps, sendActivity }
}

const activityPost = async (user: string, visibility: 'public' | 'unlisted' | 'followers') => {
  const activityId = await insertActivity(user, {
    activity_type: 'exercise',
    end_time: new Date('2026-07-01T07:11:00Z'),
    source: 'garmin',
    start_time: new Date('2026-07-01T06:30:00Z'),
    title: 'Morning run',
  })
  return createFeedPost(user, {
    activity_id: activityId,
    include_chart: false,
    include_map: false,
    included_metrics: ['duration'],
    series_metrics: [],
    visibility,
  })
}

describe('re-sending post Updates', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('sends one Update per public or unlisted post, skipping followers-only and deleted ones', async () => {
    const user = getTestUser()
    const pub = await activityPost(user, 'public')
    const unlisted = await activityPost(user, 'unlisted')
    await activityPost(user, 'followers')
    const deleted = await activityPost(user, 'public')
    await deleteFeedPost(user, deleted.id)
    const article = await createArticlePost(user, {
      article: { blocks: [{ markdown: 'Hello', type: 'prose' }], title: 'Hi' },
      visibility: 'public',
    })
    const { deps, sendActivity } = await fakeDeps()

    const run = await createPostUpdateResender({
      deliver: (u, post) => deliverPostUpdate(deps, u, post),
      listPosts: listPublicFeedPosts,
      listUsers: async () => [user],
    }).start()
    expect(run?.posts).toBe(3)
    await run?.done

    const updates = sendActivity.mock.calls
      .filter(([, recipient]) => recipient === 'followers')
      .map(([, , activity]) => activity as Update)
    expect(updates.every((u) => u instanceof Update)).toBe(true)
    const noteIds = updates.map((u) => u.objectId?.href).sort()
    expect(noteIds).toEqual(
      [pub.id, unlisted.id, article.id].map((id) => `${ORIGIN}/users/${user}/feed/${id}`).sort(),
    )
  })
})
