import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { upsertFeedFollower } from './feed-follower.ts'
import { upsertFeedFollowing } from './feed-following.ts'
import {
  deleteFeedQuoteAuthorizationsByActor,
  deleteFeedQuoteAuthorizationsByQuote,
  deleteFeedQuoteAuthorizationsForPost,
  getFeedQuoteAuthorization,
  listFeedPostQuotes,
  listFeedQuoteAuthorizations,
  upsertFeedQuoteAuthorization,
} from './feed-quotes.ts'
import { upsertFeedPostReaction } from './feed-reactions.ts'
import { createFeedPost, deleteFeedPost, deleteFeedPostWithQuotes } from './feed.ts'

const CONTAINER_TIMEOUT = 120_000
const ALICE = 'https://mastodon.example/users/alice'
const QUOTE = `${ALICE}/statuses/1`
const REQUEST = `${ALICE}/quote_requests/abc`
const BOB = 'https://remote.example/users/bob'
const CAROL = 'https://elsewhere.example/users/carol'

const post = (user: string) =>
  createFeedPost(user, {
    activity_id: null,
    include_chart: false,
    include_map: false,
    included_metrics: [],
    series_metrics: [],
    visibility: 'public',
  })

describe('Feed quote authorization store integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('stores an approval and reads it back by id', async () => {
    const user = getTestUser()
    const created = await post(user)
    const row = await upsertFeedQuoteAuthorization(user, {
      actor_uri: ALICE,
      post_id: created.id,
      quote_uri: QUOTE,
      request_uri: REQUEST,
    })
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(row.created_at).toBeInstanceOf(Date)
    expect(await getFeedQuoteAuthorization(user, row.id)).toEqual(row)
  })

  test('an unknown id reads as null', async () => {
    expect(await getFeedQuoteAuthorization(getTestUser(), crypto.randomUUID())).toBeNull()
  })

  test('a redelivered request for the same quote returns the same row, keeping the first request_uri', async () => {
    const user = getTestUser()
    const created = await post(user)
    const input = { actor_uri: ALICE, post_id: created.id, quote_uri: QUOTE, request_uri: REQUEST }
    const first = await upsertFeedQuoteAuthorization(user, input)
    const second = await upsertFeedQuoteAuthorization(user, { ...input, request_uri: `${REQUEST}-2` })
    expect(second).toEqual(first)
    expect(await listFeedQuoteAuthorizations(user, created.id)).toHaveLength(1)
  })

  test('a re-request of the same quote by another actor cannot re-attribute the approval', async () => {
    const user = getTestUser()
    const created = await post(user)
    const input = { actor_uri: ALICE, post_id: created.id, quote_uri: QUOTE, request_uri: REQUEST }
    const first = await upsertFeedQuoteAuthorization(user, input)
    const other = 'https://mastodon.example/users/bob'
    const second = await upsertFeedQuoteAuthorization(user, {
      ...input,
      actor_uri: other,
      request_uri: `${other}/quote_requests/x`,
    })
    expect(second).toEqual(first)
    expect(await getFeedQuoteAuthorization(user, first.id)).toEqual(first)
  })

  test('lists only the given post’s approvals', async () => {
    const user = getTestUser()
    const a = await post(user)
    const b = await post(user)
    await upsertFeedQuoteAuthorization(user, {
      actor_uri: ALICE,
      post_id: a.id,
      quote_uri: QUOTE,
      request_uri: null,
    })
    await upsertFeedQuoteAuthorization(user, {
      actor_uri: ALICE,
      post_id: a.id,
      quote_uri: `${ALICE}/statuses/2`,
      request_uri: null,
    })
    await upsertFeedQuoteAuthorization(user, {
      actor_uri: ALICE,
      post_id: b.id,
      quote_uri: QUOTE,
      request_uri: null,
    })
    const onA = await listFeedQuoteAuthorizations(user, a.id)
    expect(onA.map((r) => r.quote_uri).sort()).toEqual([QUOTE, `${ALICE}/statuses/2`].sort())
    expect(await listFeedQuoteAuthorizations(user, b.id)).toHaveLength(1)
  })

  test('deleting a post drops its approvals in the same statement', async () => {
    const user = getTestUser()
    const created = await post(user)
    const row = await upsertFeedQuoteAuthorization(user, {
      actor_uri: ALICE,
      post_id: created.id,
      quote_uri: QUOTE,
      request_uri: null,
    })
    expect(await deleteFeedPost(user, created.id)).toBe(true)
    expect(await listFeedQuoteAuthorizations(user, created.id)).toHaveLength(0)
    expect(await getFeedQuoteAuthorization(user, row.id)).toBeNull()
  })

  test('deleting a post returns exactly the approvals the statement dropped', async () => {
    const user = getTestUser()
    const created = await post(user)
    const other = await post(user)
    const first = await upsertFeedQuoteAuthorization(user, {
      actor_uri: ALICE,
      post_id: created.id,
      quote_uri: QUOTE,
      request_uri: REQUEST,
    })
    const second = await upsertFeedQuoteAuthorization(user, {
      actor_uri: ALICE,
      post_id: created.id,
      quote_uri: `${ALICE}/statuses/2`,
      request_uri: null,
    })
    await upsertFeedQuoteAuthorization(user, {
      actor_uri: ALICE,
      post_id: other.id,
      quote_uri: QUOTE,
      request_uri: null,
    })
    const removed = await deleteFeedPostWithQuotes(user, created.id)
    expect(removed?.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [first, second].sort((a, b) => a.id.localeCompare(b.id)),
    )
    expect(await listFeedQuoteAuthorizations(user, other.id)).toHaveLength(1)
    expect(await deleteFeedPostWithQuotes(user, other.id)).toHaveLength(1)
    expect(await deleteFeedPostWithQuotes(user, created.id)).toBeNull()
  })

  test('deleting a post without approvals returns none, an unknown post null', async () => {
    const user = getTestUser()
    const created = await post(user)
    expect(await deleteFeedPostWithQuotes(user, created.id)).toEqual([])
    expect(await deleteFeedPostWithQuotes(user, crypto.randomUUID())).toBeNull()
    expect(await deleteFeedPostWithQuotes(user, 'not-a-uuid')).toBeNull()
  })

  test('revoking a post’s approvals removes and returns them, leaving other posts’ alone', async () => {
    const user = getTestUser()
    const a = await post(user)
    const b = await post(user)
    const first = await upsertFeedQuoteAuthorization(user, {
      actor_uri: ALICE,
      post_id: a.id,
      quote_uri: QUOTE,
      request_uri: null,
    })
    const second = await upsertFeedQuoteAuthorization(user, {
      actor_uri: ALICE,
      post_id: a.id,
      quote_uri: `${ALICE}/statuses/2`,
      request_uri: null,
    })
    await upsertFeedQuoteAuthorization(user, {
      actor_uri: ALICE,
      post_id: b.id,
      quote_uri: QUOTE,
      request_uri: null,
    })
    const removed = await deleteFeedQuoteAuthorizationsForPost(user, a.id)
    expect(removed.map((r) => r.id).sort()).toEqual([first.id, second.id].sort())
    expect(await listFeedQuoteAuthorizations(user, a.id)).toHaveLength(0)
    expect(await listFeedQuoteAuthorizations(user, b.id)).toHaveLength(1)
    expect(await deleteFeedQuoteAuthorizationsForPost(user, a.id)).toEqual([])
  })

  test('a deleted quoting Note drops its approval only when the Delete comes from its actor', async () => {
    const user = getTestUser()
    const created = await post(user)
    const row = await upsertFeedQuoteAuthorization(user, {
      actor_uri: ALICE,
      post_id: created.id,
      quote_uri: QUOTE,
      request_uri: null,
    })
    expect(
      await deleteFeedQuoteAuthorizationsByQuote(user, QUOTE, 'https://mastodon.example/users/bob'),
    ).toBe(0)
    expect(await getFeedQuoteAuthorization(user, row.id)).toEqual(row)
    expect(await deleteFeedQuoteAuthorizationsByQuote(user, QUOTE, ALICE)).toBe(1)
    expect(await getFeedQuoteAuthorization(user, row.id)).toBeNull()
    expect(await deleteFeedQuoteAuthorizationsByQuote(user, QUOTE, ALICE)).toBe(0)
  })

  test('a deleted actor’s approvals all go, other actors’ stay', async () => {
    const user = getTestUser()
    const created = await post(user)
    const bob = 'https://mastodon.example/users/bob'
    for (const [actor_uri, quote_uri] of [
      [ALICE, QUOTE],
      [ALICE, `${ALICE}/statuses/2`],
      [bob, `${bob}/statuses/1`],
    ]) {
      await upsertFeedQuoteAuthorization(user, {
        actor_uri,
        post_id: created.id,
        quote_uri,
        request_uri: null,
      })
    }
    expect(await deleteFeedQuoteAuthorizationsByActor(user, ALICE)).toBe(2)
    const left = await listFeedQuoteAuthorizations(user, created.id)
    expect(left.map((r) => r.actor_uri)).toEqual([bob])
  })

  describe('listFeedPostQuotes', () => {
    test('lists a post’s quotes newest first with the quoting post’s uri, capped by the limit', async () => {
      const user = getTestUser()
      const created = await post(user)
      const other = await post(user)
      await upsertFeedQuoteAuthorization(user, {
        actor_uri: ALICE,
        post_id: created.id,
        quote_uri: QUOTE,
        request_uri: null,
      })
      await upsertFeedQuoteAuthorization(user, {
        actor_uri: BOB,
        post_id: created.id,
        quote_uri: `${BOB}/statuses/2`,
        request_uri: null,
      })
      await upsertFeedQuoteAuthorization(user, {
        actor_uri: BOB,
        post_id: other.id,
        quote_uri: `${BOB}/statuses/3`,
        request_uri: null,
      })

      const rows = await listFeedPostQuotes(user, created.id, 100)
      expect(rows.map((r) => [r.actor_uri, r.quote_uri])).toEqual([
        [BOB, `${BOB}/statuses/2`],
        [ALICE, QUOTE],
      ])
      expect(rows[0].created_at).toBeInstanceOf(Date)
      expect(await listFeedPostQuotes(user, created.id, 1)).toHaveLength(1)
    })

    test('resolves the quoting actor’s presentation from the rows that cache it, at query time', async () => {
      const user = getTestUser()
      const created = await post(user)
      await upsertFeedFollower(user, {
        actor_uri: ALICE,
        avatar_url: 'https://mastodon.example/a.png',
        display_name: 'Alice',
        handle: '@alice@mastodon.example',
        inbox_uri: `${ALICE}/inbox`,
      })
      await upsertFeedFollowing(user, {
        actor_uri: BOB,
        display_name: 'Bob',
        handle: '@bob@remote.example',
        inbox_uri: `${BOB}/inbox`,
      })
      // A reaction row with no handle loses to one that has it.
      await upsertFeedPostReaction(user, { actor_uri: BOB, kind: 'like', post_id: created.id })
      for (const actor of [ALICE, BOB, CAROL]) {
        await upsertFeedQuoteAuthorization(user, {
          actor_uri: actor,
          post_id: created.id,
          quote_uri: `${actor}/statuses/9`,
          request_uri: null,
        })
      }

      const byActor = Object.fromEntries(
        (await listFeedPostQuotes(user, created.id, 100)).map((r) => [
          r.actor_uri,
          { avatar_url: r.avatar_url, display_name: r.display_name, handle: r.handle },
        ]),
      )
      expect(byActor[ALICE]).toEqual({
        avatar_url: 'https://mastodon.example/a.png',
        display_name: 'Alice',
        handle: '@alice@mastodon.example',
      })
      expect(byActor[BOB]).toEqual({ avatar_url: null, display_name: 'Bob', handle: '@bob@remote.example' })
      // An actor nothing caches still lists, with no presentation.
      expect(byActor[CAROL]).toEqual({ avatar_url: null, display_name: null, handle: null })

      await upsertFeedFollower(user, {
        actor_uri: ALICE,
        display_name: 'Alice Renamed',
        handle: '@alice@mastodon.example',
        inbox_uri: `${ALICE}/inbox`,
      })
      const renamed = (await listFeedPostQuotes(user, created.id, 100)).find((r) => r.actor_uri === ALICE)
      expect(renamed?.display_name).toBe('Alice Renamed')
    })
  })
})
