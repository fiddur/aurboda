import type { Federation } from '@fedify/fedify'

import { Person } from '@fedify/fedify/vocab'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { FeedFollowingRecord } from '../db/index.ts'

vi.mock('../db/index.ts', () => ({
  deleteTimelineEntriesByActor: vi.fn(async () => 0),
  getFeedFollowing: vi.fn(async () => null),
  getFeedFollowingByActor: vi.fn(async () => null),
  getFeedFollowingByTag: vi.fn(async () => null),
  removeFeedFollowing: vi.fn(async () => true),
  upsertFeedFollowing: vi.fn(),
}))

const db = vi.mocked(await import('../db/index.ts'))
const { followTag, unfollowTag } = await import('./following.ts')

const row = (over: Partial<FeedFollowingRecord>): FeedFollowingRecord => ({
  accepted: true,
  actor_uri: 'https://tags.pub/user/running',
  avatar_url: null,
  created_at: new Date('2026-11-10T09:00:00Z'),
  display_name: null,
  handle: '@running@tags.pub',
  id: '11111111-1111-4111-8111-111111111111',
  inbox_uri: 'https://tags.pub/user/running/inbox',
  notify_on_post: true,
  shared_inbox_uri: null,
  tag: 'running',
  ...over,
})

const uniqueViolation = () => Object.assign(new Error('duplicate key'), { code: '23505' })

const deps = () => {
  const sendActivity = vi.fn(async () => undefined)
  const federation = {
    createContext: () => ({
      getActorUri: (user: string) => new URL(`https://aurboda.example/users/${user}`),
      getDocumentLoader: async () => async () => ({ contextUrl: null, document: {}, documentUrl: '' }),
      lookupObject: async (handle: string) =>
        new Person({
          id: new URL(`https://tags.pub/user/${handle.split('@')[0]}`),
          inbox: new URL(`https://tags.pub/user/${handle.split('@')[0]}/inbox`),
        }),
      sendActivity,
    }),
  } as unknown as Federation<void>
  return {
    deps: { federation, origin: 'https://aurboda.example', tagActorHost: async () => 'tags.pub' },
    sendActivity,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  db.getFeedFollowingByActor.mockResolvedValue(null)
  db.getFeedFollowingByTag.mockResolvedValue(null)
  db.getFeedFollowing.mockResolvedValue(null)
})

describe('followTag conflicts', () => {
  test('stores the tag on the follow row and sends the Follow', async () => {
    db.upsertFeedFollowing.mockResolvedValue(row({}))
    const { deps: d, sendActivity } = deps()
    const result = await followTag(d, 'bob', '#Running')
    expect(result).toMatchObject({ ok: true, record: { tag: 'running' } })
    expect(db.upsertFeedFollowing).toHaveBeenCalledWith(
      'bob',
      expect.objectContaining({ actor_uri: 'https://tags.pub/user/running', tag: 'running' }),
    )
    expect(sendActivity).toHaveBeenCalledTimes(1)
  })

  test('409 when the tag is already followed through another actor (the host changed)', async () => {
    db.getFeedFollowingByTag.mockResolvedValue(
      row({ actor_uri: 'https://old.example/user/running', handle: '@running@old.example' }),
    )
    const result = await followTag(deps().deps, 'bob', 'running')
    expect(result).toEqual({
      error: 'You already follow #running through @running@old.example; unfollow it first.',
      ok: false,
      status: 409,
    })
    expect(db.upsertFeedFollowing).not.toHaveBeenCalled()
  })

  test('409 when the resolved actor is already followed as another tag (the host aliases them)', async () => {
    db.getFeedFollowingByActor.mockResolvedValue(row({ tag: 'run' }))
    const result = await followTag(deps().deps, 'bob', 'running')
    expect(result).toMatchObject({ ok: false, status: 409 })
    expect((result as { error: string }).error).toContain('#run')
    expect(db.upsertFeedFollowing).not.toHaveBeenCalled()
  })

  test('a unique violation from a concurrent follow of the same tag is a 409, not a 500', async () => {
    db.upsertFeedFollowing.mockRejectedValue(uniqueViolation())
    const result = await followTag(deps().deps, 'bob', 'running')
    expect(result).toMatchObject({ ok: false, status: 409 })
  })

  test('any other database error still propagates', async () => {
    db.upsertFeedFollowing.mockRejectedValue(new Error('connection lost'))
    await expect(followTag(deps().deps, 'bob', 'running')).rejects.toThrow('connection lost')
  })
})

describe('unfollowTag', () => {
  test('false for an invalid tag and for a tag that is not followed', async () => {
    const { deps: d, sendActivity } = deps()
    expect(await unfollowTag(d, 'bob', '#not valid')).toBe(false)
    expect(await unfollowTag(d, 'bob', 'running')).toBe(false)
    expect(db.getFeedFollowingByTag).toHaveBeenCalledWith('bob', 'running')
    expect(sendActivity).not.toHaveBeenCalled()
  })

  test('unfollows the tag actor by its row: Undo{Follow}, row removed, its boosts dropped', async () => {
    const existing = row({})
    db.getFeedFollowingByTag.mockResolvedValue(existing)
    db.getFeedFollowing.mockResolvedValue(existing)
    const { deps: d, sendActivity } = deps()
    expect(await unfollowTag(d, 'bob', '#Running')).toBe(true)
    expect(sendActivity).toHaveBeenCalledTimes(1)
    expect(db.removeFeedFollowing).toHaveBeenCalledWith('bob', existing.id)
    expect(db.deleteTimelineEntriesByActor).toHaveBeenCalledWith('bob', existing.actor_uri)
  })
})
