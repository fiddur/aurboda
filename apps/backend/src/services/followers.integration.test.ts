import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import type { FollowDeps } from './following.ts'

/**
 * Integration tests for the follower-approval service against a real per-user
 * database. Outbound Accept/Reject delivery targets a non-resolving `.example`
 * inbox, so the POST fails fast and is swallowed (best-effort) — we assert the
 * local DB effects, which must take hold regardless of delivery.
 */
import { getFeedFollowerById, upsertFeedFollower } from '../db/feed-follower.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { createFeedFederation } from './activitypub/federation.ts'
import { approveFollower, rejectFollower } from './followers.ts'

const CONTAINER_TIMEOUT = 120_000
const ORIGIN = 'https://aurboda.example'

const deps: FollowDeps = { federation: createFeedFederation(ORIGIN, `${ORIGIN}/api`), origin: ORIGIN }

const pending = {
  actor_uri: 'https://mastodon.example/users/alice',
  follow_activity_uri: 'https://mastodon.example/users/alice/follows/1',
  inbox_uri: 'https://mastodon.example/users/alice/inbox',
}

describe('Follower approval service integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('approving a pending follower marks it accepted', async () => {
    const user = getTestUser()
    const rec = await upsertFeedFollower(user, { ...pending, accepted: false })

    const approved = await approveFollower(deps, user, rec.id)
    expect(approved?.accepted).toBe(true)
    expect((await getFeedFollowerById(user, rec.id))?.accepted).toBe(true)
  })

  test('approving an unknown follower returns null and changes nothing', async () => {
    const user = getTestUser()
    expect(await approveFollower(deps, user, '00000000-0000-0000-0000-000000000000')).toBeNull()
  })

  test('rejecting a follower removes it', async () => {
    const user = getTestUser()
    const rec = await upsertFeedFollower(user, { ...pending, accepted: false })

    expect(await rejectFollower(deps, user, rec.id)).toBe(true)
    expect(await getFeedFollowerById(user, rec.id)).toBeNull()
  })

  test('rejecting an unknown follower returns false', async () => {
    const user = getTestUser()
    expect(await rejectFollower(deps, user, '00000000-0000-0000-0000-000000000000')).toBe(false)
  })
})
