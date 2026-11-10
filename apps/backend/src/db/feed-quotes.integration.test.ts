import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  getFeedQuoteAuthorization,
  listFeedQuoteAuthorizations,
  upsertFeedQuoteAuthorization,
} from './feed-quotes.ts'
import { createFeedPost, deleteFeedPost } from './feed.ts'

const CONTAINER_TIMEOUT = 120_000
const ALICE = 'https://mastodon.example/users/alice'
const QUOTE = `${ALICE}/statuses/1`
const REQUEST = `${ALICE}/quote_requests/abc`

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
})
