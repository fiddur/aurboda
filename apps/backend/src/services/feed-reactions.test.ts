import { Announce, Like, Undo } from '@fedify/fedify/vocab'
import { describe, expect, test } from 'vitest'

import type { FeedPostQuoteRecord, FeedPostReactionRecord, FeedReactionRecord } from '../db/index.ts'

import {
  buildReactionActivity,
  buildUndoReactionActivity,
  listPostReactions,
  MAX_POST_REACTIONS,
  type ReactionActorContext,
  reactionActivityId,
  serializeFeedPostQuote,
  serializeFeedPostReaction,
} from './feed-reactions.ts'

const ORIGIN = 'https://aurboda.example'
const AS_PUBLIC = 'https://www.w3.org/ns/activitystreams#Public'

const ctx: ReactionActorContext = {
  actorUri: new URL(`${ORIGIN}/users/freja`),
  followersUri: new URL(`${ORIGIN}/users/freja/followers`),
  origin: ORIGIN,
  user: 'freja',
}

const row = (over: Partial<FeedReactionRecord> = {}): FeedReactionRecord => ({
  actor_uri: 'https://mastodon.example/users/alice',
  created_at: new Date('2026-07-02T10:00:00Z'),
  id: '11111111-1111-1111-1111-111111111111',
  inbox_uri: 'https://mastodon.example/users/alice/inbox',
  kind: 'like',
  object_uri: 'https://mastodon.example/notes/1',
  shared_inbox_uri: 'https://mastodon.example/inbox',
  ...over,
})

describe('reactionActivityId', () => {
  test('mints a stable per-row id under the reacting user’s actor', () => {
    expect(reactionActivityId(ORIGIN, 'freja', 'like', 'abc').href).toBe(
      'https://aurboda.example/users/freja/likes/abc',
    )
    expect(reactionActivityId(ORIGIN, 'freja', 'announce', 'abc').href).toBe(
      'https://aurboda.example/users/freja/announces/abc',
    )
  })

  test('percent-encodes the username and tolerates a trailing slash on the origin', () => {
    expect(reactionActivityId('https://aurboda.example/', 'a b', 'like', 'x').href).toBe(
      'https://aurboda.example/users/a%20b/likes/x',
    )
  })
})

describe('buildReactionActivity', () => {
  test('a Like is addressed to nobody — it goes to the author’s inbox alone', async () => {
    const like = buildReactionActivity(ctx, row())
    expect(like).toBeInstanceOf(Like)
    expect(like.id?.href).toBe(
      'https://aurboda.example/users/freja/likes/11111111-1111-1111-1111-111111111111',
    )
    expect(like.actorId?.href).toBe(`${ORIGIN}/users/freja`)
    expect(like.objectId?.href).toBe('https://mastodon.example/notes/1')
    expect(like.toIds).toEqual([])
    expect(like.ccIds).toEqual([])
  })

  test('an Announce is public and cc’d to our followers AND the boosted author', () => {
    const announce = buildReactionActivity(ctx, row({ kind: 'announce' }))
    expect(announce).toBeInstanceOf(Announce)
    expect(announce.id?.href).toBe(
      'https://aurboda.example/users/freja/announces/11111111-1111-1111-1111-111111111111',
    )
    expect(announce.toIds.map((u) => u.href)).toEqual([AS_PUBLIC])
    expect(announce.ccIds.map((u) => u.href)).toEqual([
      `${ORIGIN}/users/freja/followers`,
      'https://mastodon.example/users/alice',
    ])
    // The boost time, so remote servers order the reblog correctly.
    expect(announce.published?.epochMilliseconds).toBe(new Date('2026-07-02T10:00:00Z').getTime())
  })
})

describe('buildUndoReactionActivity', () => {
  test('wraps the same activity at `#undo` of its id, mirroring its recipients', async () => {
    const undoLike = buildUndoReactionActivity(ctx, row())
    expect(undoLike).toBeInstanceOf(Undo)
    expect(undoLike.id?.href).toBe(
      'https://aurboda.example/users/freja/likes/11111111-1111-1111-1111-111111111111#undo',
    )
    expect(await undoLike.getObject()).toBeInstanceOf(Like)
    expect(undoLike.ccIds).toEqual([])

    const undoBoost = buildUndoReactionActivity(ctx, row({ kind: 'announce' }))
    expect(undoBoost.id?.href).toBe(
      'https://aurboda.example/users/freja/announces/11111111-1111-1111-1111-111111111111#undo',
    )
    expect(await undoBoost.getObject()).toBeInstanceOf(Announce)
    // A boost's retraction has to reach everyone the boost did.
    expect(undoBoost.toIds.map((u) => u.href)).toEqual([AS_PUBLIC])
    expect(undoBoost.ccIds.map((u) => u.href)).toEqual([
      `${ORIGIN}/users/freja/followers`,
      'https://mastodon.example/users/alice',
    ])
  })
})

describe('serializeFeedPostReaction', () => {
  test('maps a stored inbound reaction to the DTO with an ISO timestamp', () => {
    const record: FeedPostReactionRecord = {
      activity_uri: 'https://mastodon.example/users/bob#likes/7',
      actor_uri: 'https://mastodon.example/users/bob',
      avatar_url: 'https://mastodon.example/avatars/bob.png',
      created_at: new Date('2026-07-03T09:00:00Z'),
      display_name: 'Bob',
      handle: '@bob@mastodon.example',
      kind: 'like',
      post_id: '22222222-2222-2222-2222-222222222222',
    }
    const dto = serializeFeedPostReaction(record)
    expect(dto).toEqual({
      actor_uri: 'https://mastodon.example/users/bob',
      avatar_url: 'https://mastodon.example/avatars/bob.png',
      created_at: '2026-07-03T09:00:00.000Z',
      display_name: 'Bob',
      handle: '@bob@mastodon.example',
      kind: 'like',
    })
    // Internal bookkeeping (which post, which remote activity) stays server-side.
    expect(dto).not.toHaveProperty('post_id')
    expect(dto).not.toHaveProperty('activity_uri')
  })
})

const inbound = (over: Partial<FeedPostReactionRecord> = {}): FeedPostReactionRecord => ({
  activity_uri: null,
  actor_uri: 'https://mastodon.example/users/bob',
  avatar_url: null,
  created_at: new Date('2026-07-03T09:00:00Z'),
  display_name: null,
  handle: null,
  kind: 'like',
  post_id: '22222222-2222-2222-2222-222222222222',
  ...over,
})

const quote = (over: Partial<FeedPostQuoteRecord> = {}): FeedPostQuoteRecord => ({
  actor_uri: 'https://remote.example/users/carol',
  avatar_url: 'https://remote.example/carol.png',
  created_at: new Date('2026-07-04T09:00:00Z'),
  display_name: 'Carol',
  handle: '@carol@remote.example',
  quote_uri: 'https://remote.example/users/carol/statuses/5',
  ...over,
})

describe('serializeFeedPostQuote', () => {
  test('maps an approved quote to a `quote` reaction carrying the quoting post as `url`', () => {
    expect(serializeFeedPostQuote(quote())).toEqual({
      actor_uri: 'https://remote.example/users/carol',
      avatar_url: 'https://remote.example/carol.png',
      created_at: '2026-07-04T09:00:00.000Z',
      display_name: 'Carol',
      handle: '@carol@remote.example',
      kind: 'quote',
      url: 'https://remote.example/users/carol/statuses/5',
    })
  })
})

describe('listPostReactions', () => {
  test('merges likes, boosts and quotes newest first', async () => {
    const result = await listPostReactions('freja', 'post-1', {
      listQuotes: async () => [quote({ created_at: new Date('2026-07-03T12:00:00Z') })],
      listReactions: async () => [
        inbound({ created_at: new Date('2026-07-04T00:00:00Z'), kind: 'announce' }),
        inbound({ created_at: new Date('2026-07-03T00:00:00Z') }),
      ],
    })
    expect(result.map((r) => [r.kind, r.created_at])).toEqual([
      ['announce', '2026-07-04T00:00:00.000Z'],
      ['quote', '2026-07-03T12:00:00.000Z'],
      ['like', '2026-07-03T00:00:00.000Z'],
    ])
  })

  test('asks each source for the cap and keeps only the newest across both', async () => {
    const limits: number[] = []
    const at = (i: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, i))
    const result = await listPostReactions('freja', 'post-1', {
      listQuotes: async (_user, _post, limit) => {
        limits.push(limit)
        return Array.from({ length: limit }, (_, i) => quote({ created_at: at(2 * i) }))
      },
      listReactions: async (_user, _post, limit) => {
        limits.push(limit)
        return Array.from({ length: limit }, (_, i) => inbound({ created_at: at(2 * i + 1) }))
      },
    })
    expect(limits).toEqual([MAX_POST_REACTIONS, MAX_POST_REACTIONS])
    expect(result).toHaveLength(MAX_POST_REACTIONS)
    expect(result[0].created_at).toBe(at(2 * MAX_POST_REACTIONS - 1).toISOString())
  })
})
