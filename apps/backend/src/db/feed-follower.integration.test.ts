import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

/**
 * Integration tests for the remote-follower store.
 */
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { listFeedFollowers, removeFeedFollower, upsertFeedFollower } from './feed-follower.ts'

const CONTAINER_TIMEOUT = 120_000

const alice = {
  actor_uri: 'https://mastodon.example/users/alice',
  inbox_uri: 'https://mastodon.example/users/alice/inbox',
  shared_inbox_uri: 'https://mastodon.example/inbox',
}

describe('Feed followers integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('adds a follower and lists it', async () => {
    const user = getTestUser()
    const rec = await upsertFeedFollower(user, { ...alice, accepted: true })
    expect(rec.actor_uri).toBe(alice.actor_uri)
    expect(rec.inbox_uri).toBe(alice.inbox_uri)
    expect(rec.shared_inbox_uri).toBe(alice.shared_inbox_uri)
    expect(rec.accepted).toBe(true)

    const followers = await listFeedFollowers(user)
    expect(followers.map((f) => f.actor_uri)).toEqual([alice.actor_uri])
  })

  test('defaults accepted to false and shared_inbox to null', async () => {
    const user = getTestUser()
    const rec = await upsertFeedFollower(user, {
      actor_uri: 'https://remote.example/users/bob',
      inbox_uri: 'https://remote.example/users/bob/inbox',
    })
    expect(rec.accepted).toBe(false)
    expect(rec.shared_inbox_uri).toBeNull()
  })

  test('re-following the same actor updates in place (no duplicate)', async () => {
    const user = getTestUser()
    await upsertFeedFollower(user, { ...alice, accepted: false })
    const updated = await upsertFeedFollower(user, {
      ...alice,
      accepted: true,
      inbox_uri: 'https://mastodon.example/users/alice/inbox2',
    })
    expect(updated.accepted).toBe(true)
    expect(updated.inbox_uri).toBe('https://mastodon.example/users/alice/inbox2')

    const followers = await listFeedFollowers(user)
    expect(followers).toHaveLength(1)
  })

  test('removes a follower (e.g. on Undo Follow)', async () => {
    const user = getTestUser()
    await upsertFeedFollower(user, alice)
    expect(await removeFeedFollower(user, alice.actor_uri)).toBe(true)
    expect(await removeFeedFollower(user, alice.actor_uri)).toBe(false)
    expect(await listFeedFollowers(user)).toEqual([])
  })
})
