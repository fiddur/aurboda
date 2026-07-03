import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

/**
 * Integration tests for the following store (the actors this user follows).
 */
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  countAcceptedFeedFollowing,
  getFeedFollowing,
  getFeedFollowingByActor,
  listAcceptedFeedFollowing,
  listFeedFollowing,
  markFeedFollowingAccepted,
  removeFeedFollowing,
  removeFeedFollowingByActor,
  upsertFeedFollowing,
} from './feed-following.ts'

const CONTAINER_TIMEOUT = 120_000

const alice = {
  actor_uri: 'https://mastodon.example/users/alice',
  avatar_url: 'https://mastodon.example/avatars/alice.png',
  display_name: 'Alice',
  handle: '@alice@mastodon.example',
  inbox_uri: 'https://mastodon.example/users/alice/inbox',
  shared_inbox_uri: 'https://mastodon.example/inbox',
}

const bob = {
  actor_uri: 'https://remote.example/users/bob',
  inbox_uri: 'https://remote.example/users/bob/inbox',
}

describe('Feed following integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('follows an actor (pending by default) and lists it', async () => {
    const user = getTestUser()
    const rec = await upsertFeedFollowing(user, alice)
    expect(rec.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(rec.actor_uri).toBe(alice.actor_uri)
    expect(rec.inbox_uri).toBe(alice.inbox_uri)
    expect(rec.shared_inbox_uri).toBe(alice.shared_inbox_uri)
    expect(rec.handle).toBe(alice.handle)
    expect(rec.display_name).toBe('Alice')
    expect(rec.avatar_url).toBe(alice.avatar_url)
    // A fresh follow is pending until the followee accepts.
    expect(rec.accepted).toBe(false)

    const following = await listFeedFollowing(user)
    expect(following.map((f) => f.actor_uri)).toEqual([alice.actor_uri])
  })

  test('optional presentation fields default to null', async () => {
    const user = getTestUser()
    const rec = await upsertFeedFollowing(user, bob)
    expect(rec.shared_inbox_uri).toBeNull()
    expect(rec.handle).toBeNull()
    expect(rec.display_name).toBeNull()
    expect(rec.avatar_url).toBeNull()
  })

  test('re-following the same actor upserts in place and preserves accepted', async () => {
    const user = getTestUser()
    const first = await upsertFeedFollowing(user, alice)
    await markFeedFollowingAccepted(user, alice.actor_uri)

    // Re-follow with a refreshed inbox + display name.
    const again = await upsertFeedFollowing(user, {
      ...alice,
      display_name: 'Alice (she/her)',
      inbox_uri: 'https://mastodon.example/users/alice/inbox2',
    })
    expect(again.id).toBe(first.id) // same row
    expect(again.inbox_uri).toBe('https://mastodon.example/users/alice/inbox2')
    expect(again.display_name).toBe('Alice (she/her)')
    // Re-following must NOT reset an already-accepted follow back to pending.
    expect(again.accepted).toBe(true)

    expect(await listFeedFollowing(user)).toHaveLength(1)
  })

  test('marks a follow accepted, and only accepted rows appear in the collection', async () => {
    const user = getTestUser()
    await upsertFeedFollowing(user, alice)
    await upsertFeedFollowing(user, bob)

    // Nothing accepted yet.
    expect(await listAcceptedFeedFollowing(user)).toEqual([])
    expect(await countAcceptedFeedFollowing(user)).toBe(0)

    expect(await markFeedFollowingAccepted(user, alice.actor_uri)).toBe(true)
    // Marking a non-followed actor accepted is a no-op.
    expect(await markFeedFollowingAccepted(user, 'https://nope.example/users/x')).toBe(false)

    const accepted = await listAcceptedFeedFollowing(user)
    expect(accepted.map((f) => f.actor_uri)).toEqual([alice.actor_uri])
    expect(await countAcceptedFeedFollowing(user)).toBe(1)
    // The owner-facing list still shows both (accepted + pending).
    expect(await listFeedFollowing(user)).toHaveLength(2)
  })

  test('fetches by id and by actor uri', async () => {
    const user = getTestUser()
    const rec = await upsertFeedFollowing(user, alice)
    expect((await getFeedFollowing(user, rec.id))?.actor_uri).toBe(alice.actor_uri)
    expect((await getFeedFollowingByActor(user, alice.actor_uri))?.id).toBe(rec.id)
    expect(await getFeedFollowing(user, '00000000-0000-0000-0000-000000000000')).toBeNull()
    expect(await getFeedFollowingByActor(user, 'https://nope.example/x')).toBeNull()
  })

  test('removes by id, returning the removed row for the Undo', async () => {
    const user = getTestUser()
    const rec = await upsertFeedFollowing(user, alice)
    const removed = await removeFeedFollowing(user, rec.id)
    expect(removed?.actor_uri).toBe(alice.actor_uri)
    expect(removed?.inbox_uri).toBe(alice.inbox_uri) // available to address the Undo
    expect(await getFeedFollowing(user, rec.id)).toBeNull()
    // Removing again returns null.
    expect(await removeFeedFollowing(user, rec.id)).toBeNull()
  })

  test('removes by actor uri (e.g. on a Reject)', async () => {
    const user = getTestUser()
    await upsertFeedFollowing(user, alice)
    expect(await removeFeedFollowingByActor(user, alice.actor_uri)).toBe(true)
    expect(await removeFeedFollowingByActor(user, alice.actor_uri)).toBe(false)
    expect(await listFeedFollowing(user)).toEqual([])
  })
})
