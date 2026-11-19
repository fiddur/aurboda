import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import type { FeedDeliver } from '../routes/feed-router.ts'
import type { McpServer } from './helpers.ts'

import { getFeedFollowingByTag, upsertFeedFollowing } from '../db/feed-following.ts'
import { listFeedQuoteAuthorizations, upsertFeedQuoteAuthorization } from '../db/feed-quotes.ts'
import { upsertFeedPostReaction } from '../db/feed-reactions.ts'
import { createFeedPost } from '../db/feed.ts'
import { insertSensitivityFlag } from '../db/sensitivities.ts'
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
  const deliver = { createdArticle: vi.fn(), deleted: vi.fn() } as unknown as FeedDeliver
  registerFeedTools(server, user, { deliver })
  const tool = (name: string) => {
    const handler = tools.get(name)
    if (handler == null) throw new Error(`no ${name}`)
    return handler
  }
  return {
    createArticleDraft: tool('create_article_draft'),
    deleteFeedPost: tool('delete_feed_post'),
    deliver,
    getFeedPost: tool('get_feed_post'),
    listFeed: tool('list_feed'),
    listFeedPostReactions: tool('list_feed_post_reactions'),
    publishArticleDraft: tool('publish_article_draft'),
    setFollowedTagNotify: tool('set_followed_tag_notify'),
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

  test('list_feed_post_reactions and list_feed leave a hashtag account’s boost out', async () => {
    const user = getTestUser()
    const post = await createFeedPost(user, {
      activity_id: null,
      include_chart: false,
      include_map: false,
      included_metrics: [],
      series_metrics: [],
      visibility: 'public',
    })
    await upsertFeedPostReaction(user, {
      actor_uri: 'https://tags.pub/user/running',
      kind: 'announce',
      post_id: post.id,
    })
    await upsertFeedPostReaction(user, { actor_uri: ALICE, kind: 'announce', post_id: post.id })
    const { listFeed, listFeedPostReactions } = setup(user)

    const reactions = JSON.parse((await listFeedPostReactions({ id: post.id })).content[0].text)
    expect(reactions.map((r: { actor_uri: string }) => r.actor_uri)).toEqual([ALICE])
    const page = JSON.parse((await listFeed({ limit: 10 })).content[0].text)
    expect(page.posts.map((p: { boost_count: number }) => p.boost_count)).toEqual([1])
  })
})

describe('get_feed_post', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('returns a followers-only post as list_feed lists it; an unknown id is an error', async () => {
    const user = getTestUser()
    const post = await createFeedPost(user, {
      activity_id: null,
      include_chart: false,
      include_map: false,
      included_metrics: [],
      series_metrics: [],
      visibility: 'followers',
    })
    await upsertFeedPostReaction(user, { actor_uri: ALICE, kind: 'like', post_id: post.id })
    const { getFeedPost, listFeed } = setup(user)

    const got = JSON.parse((await getFeedPost({ id: post.id })).content[0].text)
    expect(got).toMatchObject({ id: post.id, like_count: 1, visibility: 'followers' })
    const page = JSON.parse((await listFeed({ limit: 10 })).content[0].text)
    expect(got).toEqual(page.posts[0])
    expect((await getFeedPost({ id: '00000000-0000-4000-8000-000000000000' })).content[0].text).toBe(
      'Feed post not found',
    )
  })
})

describe('set_followed_tag_notify', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('turns a followed tag’s bell off by the tag, and an unfollowed tag is an error', async () => {
    const user = getTestUser()
    await upsertFeedFollowing(user, {
      actor_uri: 'https://tags.pub/user/running',
      inbox_uri: 'https://tags.pub/user/running/inbox',
      tag: 'running',
    })
    const { setFollowedTagNotify } = setup(user)

    const result = await setFollowedTagNotify({ notify_on_post: false, tag: '#Running' })

    expect(JSON.parse(result.content[0].text)).toMatchObject({ notify_on_post: false, tag: 'running' })
    expect((await getFeedFollowingByTag(user, 'running'))?.notify_on_post).toBe(false)
    expect((await setFollowedTagNotify({ notify_on_post: true, tag: 'cycling' })).content[0].text).toBe(
      'Not following that tag',
    )
  })
})

describe('article warnings', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('a draft and its published article warn about a meal sensitivity impact', async () => {
    const user = getTestUser()
    const flag = await insertSensitivityFlag(user, { name: 'dairy' })
    const { createArticleDraft, publishArticleDraft } = setup(user)
    const warnings = [
      {
        block: 0,
        message:
          'Readers see your meal sensitivity "dairy" by name, and how your HRV, heart rate and stress moved around the meals that carried it.',
      },
    ]

    const draft = JSON.parse(
      (
        await createArticleDraft({
          article: {
            blocks: [{ activity: flag.id, activity_type: 'meal_sensitivity', type: 'impact' }],
            default_end: '2026-07-07T00:00:00.000Z',
            default_start: '2026-07-01T00:00:00.000Z',
            title: 'Dairy',
          },
          visibility: 'public',
        })
      ).content[0].text,
    )
    expect(draft.warnings).toEqual(warnings)

    const published = JSON.parse((await publishArticleDraft({ id: draft.id })).content[0].text)
    expect(published.kind).toBe('article')
    expect(published.warnings).toEqual(warnings)
  })

  test('a draft without a sensitivity has no warnings', async () => {
    const { createArticleDraft } = setup(getTestUser())
    const draft = JSON.parse((await createArticleDraft({ visibility: 'public' })).content[0].text)
    expect(draft).not.toHaveProperty('warnings')
  })
})
