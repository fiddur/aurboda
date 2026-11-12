import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import type { FeedDeliver } from '../routes/feed-router.ts'
import type { McpServer } from './helpers.ts'

import { listFeedQuoteAuthorizations, upsertFeedQuoteAuthorization } from '../db/feed-quotes.ts'
import { upsertFeedPostReaction } from '../db/feed-reactions.ts'
import { createFeedPost } from '../db/feed.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { registerFeedTools } from './feed-tools.ts'

const CONTAINER_TIMEOUT = 120_000
const ALICE = 'https://mastodon.example/users/alice'

type ToolHandler = (params: Record<string, unknown>) => Promise<{ content: { text: string }[] }>

const setup = (user: string) => {
  const tools = new Map<string, ToolHandler>()
  const server = {
    tool: (name: string, _desc: string, _shape: unknown, handler: ToolHandler) => {
      tools.set(name, handler)
    },
  } as unknown as McpServer
  const deliver = { deleted: vi.fn() } as unknown as FeedDeliver
  registerFeedTools(server, user, { deliver })
  const tool = (name: string) => {
    const handler = tools.get(name)
    if (handler == null) throw new Error(`no ${name}`)
    return handler
  }
  return {
    deleteFeedPost: tool('delete_feed_post'),
    deliver,
    listFeedPostReactions: tool('list_feed_post_reactions'),
  }
}

describe('delete_feed_post', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('hands the post’s quote stamps, as the delete removed them, to the Delete fan-out', async () => {
    const user = getTestUser()
    const post = await createFeedPost(user, {
      activity_id: null,
      include_chart: false,
      include_map: false,
      included_metrics: [],
      series_metrics: [],
      visibility: 'public',
    })
    const stamp = await upsertFeedQuoteAuthorization(user, {
      actor_uri: ALICE,
      post_id: post.id,
      quote_uri: `${ALICE}/statuses/1`,
      request_uri: null,
    })
    const { deleteFeedPost, deliver } = setup(user)

    const result = await deleteFeedPost({ id: post.id })

    expect(JSON.parse(result.content[0].text)).toEqual({ deleted: true, id: post.id })
    expect(deliver.deleted).toHaveBeenCalledWith(user, expect.objectContaining({ id: post.id }), [stamp])
    expect(await listFeedQuoteAuthorizations(user, post.id)).toEqual([])
  })
})

describe('list_feed_post_reactions', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('lists an approved quote as kind `quote` alongside likes, like the REST route', async () => {
    const user = getTestUser()
    const post = await createFeedPost(user, {
      activity_id: null,
      include_chart: false,
      include_map: false,
      included_metrics: [],
      series_metrics: [],
      visibility: 'public',
    })
    await upsertFeedPostReaction(user, { actor_uri: ALICE, kind: 'like', post_id: post.id })
    await upsertFeedQuoteAuthorization(user, {
      actor_uri: ALICE,
      post_id: post.id,
      quote_uri: `${ALICE}/statuses/1`,
      request_uri: null,
    })
    const { listFeedPostReactions } = setup(user)

    const reactions = JSON.parse((await listFeedPostReactions({ id: post.id })).content[0].text)

    expect(reactions.map((r: { kind: string; url?: string }) => [r.kind, r.url])).toEqual([
      ['quote', `${ALICE}/statuses/1`],
      ['like', undefined],
    ])
  })
})
