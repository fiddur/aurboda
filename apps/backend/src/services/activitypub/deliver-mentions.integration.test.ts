import { Update } from '@fedify/fedify/vocab'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import type { FeedDeliveryDeps } from './deliver.ts'

import { insertActivity } from '../../db/activities/index.ts'
import { createFeedPost } from '../../db/feed.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../../test/db-test-helper.ts'
import { resolveFeedActivity } from '../feed.ts'
import { deliverFeedUpdate } from './deliver.ts'
import { createFeedFederation } from './federation.ts'

const CONTAINER_TIMEOUT = 120_000
const ORIGIN = 'https://aurboda.example'
const ANNA = { actor_uri: 'https://example.social/users/anna', handle: '@anna@example.social' }
const BO = { actor_uri: 'https://other.example/users/bo', handle: '@bo@other.example' }

const fakeDeps = async () => {
  const ctx = await createFeedFederation(ORIGIN, `${ORIGIN}/api`).createContext(new URL(ORIGIN))
  const sendActivity = vi.fn().mockResolvedValue(undefined)
  const lookupObject = vi.fn(async (uri: URL) => ({ inbox_uri: `${uri.href}/inbox`, shared_inbox_uri: null }))
  Object.assign(ctx, { lookupObject, sendActivity })
  const deps: FeedDeliveryDeps = {
    apiBaseUrl: `${ORIGIN}/api`,
    federation: { createContext: async () => ctx } as unknown as FeedDeliveryDeps['federation'],
    origin: ORIGIN,
  }
  return { deps, sendActivity }
}

describe('an edit that removes a mention', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('sends the Update to the accounts it still mentions and to the ones it stopped mentioning', async () => {
    const user = getTestUser()
    const activityId = await insertActivity(user, {
      activity_type: 'walking',
      end_time: new Date('2026-07-01T07:11:00Z'),
      source: 'aurboda',
      start_time: new Date('2026-07-01T06:30:00Z'),
    })
    const post = await createFeedPost(user, {
      activity_id: activityId,
      include_chart: false,
      include_map: false,
      included_metrics: ['duration'],
      mentions: [BO],
      series_metrics: [],
      visibility: 'public',
    })
    const activity = await resolveFeedActivity(user, activityId)
    const { deps, sendActivity } = await fakeDeps()

    await deliverFeedUpdate(deps, user, post, activity!, [ANNA])

    const inboxes = sendActivity.mock.calls
      .filter(([, recipient, sent]) => recipient !== 'followers' && sent instanceof Update)
      .map(([, recipient]) => (recipient as { id: URL }).id.href)
      .sort()
    expect(inboxes).toEqual([ANNA.actor_uri, BO.actor_uri].sort())
  })
})
