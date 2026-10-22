import { describe, expect, test } from 'vitest'

import type { FeedFollowerRecord } from '../db/index.ts'

import { reconstructFollow, serializeFollower } from './followers.ts'

const record: FeedFollowerRecord = {
  accepted: false,
  actor_uri: 'https://mastodon.example/users/alice',
  avatar_url: 'https://mastodon.example/avatars/alice.png',
  created_at: new Date('2026-07-04T10:00:00Z'),
  display_name: 'Alice',
  follow_activity_uri: 'https://mastodon.example/users/alice/follows/1',
  handle: '@alice@mastodon.example',
  id: '11111111-1111-1111-1111-111111111111',
  inbox_uri: 'https://mastodon.example/users/alice/inbox',
  shared_inbox_uri: 'https://mastodon.example/inbox',
}

describe('serializeFollower', () => {
  test('exposes presentation + acceptance, and never the internal inbox URIs', () => {
    const dto = serializeFollower(record)
    expect(dto).toEqual({
      accepted: false,
      actor_uri: 'https://mastodon.example/users/alice',
      avatar_url: 'https://mastodon.example/avatars/alice.png',
      created_at: '2026-07-04T10:00:00.000Z',
      display_name: 'Alice',
      handle: '@alice@mastodon.example',
      id: '11111111-1111-1111-1111-111111111111',
    })
    // Internal delivery details + the raw Follow id must not leak to the owner surface.
    expect(dto).not.toHaveProperty('inbox_uri')
    expect(dto).not.toHaveProperty('shared_inbox_uri')
    expect(dto).not.toHaveProperty('follow_activity_uri')
  })
})

describe('reconstructFollow', () => {
  const ourActor = new URL('https://aurboda.net/users/bob')

  test('rebuilds the Follow with the follower as actor, us as object, echoing the original id', () => {
    const follow = reconstructFollow(record.actor_uri, ourActor, record.follow_activity_uri)
    expect(follow.actorId?.href).toBe('https://mastodon.example/users/alice')
    expect(follow.objectId?.href).toBe('https://aurboda.net/users/bob')
    expect(follow.id?.href).toBe('https://mastodon.example/users/alice/follows/1')
  })

  test('omits the id when the original Follow id was not cached (legacy row)', () => {
    const follow = reconstructFollow(record.actor_uri, ourActor, null)
    expect(follow.id).toBeNull()
    expect(follow.actorId?.href).toBe('https://mastodon.example/users/alice')
    expect(follow.objectId?.href).toBe('https://aurboda.net/users/bob')
  })
})
