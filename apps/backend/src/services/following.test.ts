import type { Federation } from '@fedify/fedify'

import { Endpoints, Image, Person } from '@fedify/fedify/vocab'
import { describe, expect, test, vi } from 'vitest'

import type { FeedFollowingRecord } from '../db/index.ts'

import {
  actorToFollowingInput,
  followActor,
  followTag,
  serializeFollowedTag,
  serializeFollowing,
  withTimeout,
} from './following.ts'

describe('actorToFollowingInput', () => {
  test('extracts uri, inbox, shared inbox, handle, name, and avatar from a full actor', async () => {
    const actor = new Person({
      endpoints: new Endpoints({ sharedInbox: new URL('https://mastodon.example/inbox') }),
      icon: new Image({ url: new URL('https://mastodon.example/avatars/alice.png') }),
      id: new URL('https://mastodon.example/users/alice'),
      inbox: new URL('https://mastodon.example/users/alice/inbox'),
      name: 'Alice',
      preferredUsername: 'alice',
    })

    const input = await actorToFollowingInput(actor)
    expect(input).toEqual({
      actor_uri: 'https://mastodon.example/users/alice',
      avatar_url: 'https://mastodon.example/avatars/alice.png',
      display_name: 'Alice',
      handle: '@alice@mastodon.example',
      inbox_uri: 'https://mastodon.example/users/alice/inbox',
      shared_inbox_uri: 'https://mastodon.example/inbox',
    })
  })

  test('returns null when the actor has no inbox (not followable)', async () => {
    const actor = new Person({ id: new URL('https://mastodon.example/users/nobody') })
    expect(await actorToFollowingInput(actor)).toBeNull()
  })

  test('leaves handle/name/avatar/shared-inbox null when absent', async () => {
    const actor = new Person({
      id: new URL('https://remote.example/users/bob'),
      inbox: new URL('https://remote.example/users/bob/inbox'),
    })
    const input = await actorToFollowingInput(actor)
    expect(input).toEqual({
      actor_uri: 'https://remote.example/users/bob',
      avatar_url: null,
      display_name: null,
      handle: null,
      inbox_uri: 'https://remote.example/users/bob/inbox',
      shared_inbox_uri: null,
    })
  })
})

describe('serializeFollowing', () => {
  test('exposes presentation + acceptance, and never the internal inbox URIs', () => {
    const record: FeedFollowingRecord = {
      accepted: false,
      actor_uri: 'https://mastodon.example/users/alice',
      avatar_url: 'https://mastodon.example/avatars/alice.png',
      created_at: new Date('2026-07-03T10:00:00Z'),
      display_name: 'Alice',
      handle: '@alice@mastodon.example',
      id: '11111111-1111-1111-1111-111111111111',
      inbox_uri: 'https://mastodon.example/users/alice/inbox',
      notify_on_post: false,
      shared_inbox_uri: 'https://mastodon.example/inbox',
      tag: null,
    }

    const dto = serializeFollowing(record)
    expect(dto).toEqual({
      accepted: false,
      actor_uri: 'https://mastodon.example/users/alice',
      avatar_url: 'https://mastodon.example/avatars/alice.png',
      created_at: '2026-07-03T10:00:00.000Z',
      display_name: 'Alice',
      handle: '@alice@mastodon.example',
      id: '11111111-1111-1111-1111-111111111111',
      notify_on_post: false,
    })
    // Internal delivery details must not leak to the owner-facing surface.
    expect(dto).not.toHaveProperty('inbox_uri')
    expect(dto).not.toHaveProperty('shared_inbox_uri')
  })
})

describe('withTimeout', () => {
  test('resolves with the value when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve('icon'), 1000)).resolves.toBe('icon')
  })

  test('rejects when the promise does not settle within the timeout', async () => {
    // A never-settling promise (like a hung icon deref) must not hang the follow.
    await expect(withTimeout(new Promise(() => {}), 20)).rejects.toThrow('timeout')
  })
})

describe('followActor', () => {
  test('resolves the handle with a fetch signed as the following user (authorized fetch)', async () => {
    const signedLoader = async () => ({ contextUrl: null, document: {}, documentUrl: '' })
    const getDocumentLoader = vi.fn(async () => signedLoader)
    const lookupObject = vi.fn(async () => null)
    const federation = {
      createContext: () => ({ getDocumentLoader, lookupObject }),
    } as unknown as Federation<void>

    const result = await followActor(
      { federation, origin: 'https://aurboda.example', tagActorHost: async () => 'tags.pub' },
      'bob',
      '@Gargron@mastodon.social',
    )

    expect(result.ok).toBe(false)
    expect(getDocumentLoader).toHaveBeenCalledWith({ identifier: 'bob' })
    expect(lookupObject).toHaveBeenCalledWith('@Gargron@mastodon.social', { documentLoader: signedLoader })
  })
})

describe('actorToFollowingInput with a tag', () => {
  test('carries the followed tag', async () => {
    const actor = new Person({
      id: new URL('https://tags.pub/user/running'),
      inbox: new URL('https://tags.pub/user/running/inbox'),
    })
    expect((await actorToFollowingInput(actor, 'running'))?.tag).toBe('running')
    expect(await actorToFollowingInput(actor)).not.toHaveProperty('tag')
  })
})

describe('followTag', () => {
  const fakeFederation = () => {
    const signedLoader = async () => ({ contextUrl: null, document: {}, documentUrl: '' })
    const lookupObject = vi.fn(async () => null)
    const federation = {
      createContext: () => ({ getDocumentLoader: async () => signedLoader, lookupObject }),
    } as unknown as Federation<void>
    return { federation, lookupObject }
  }

  test('follows the tag actor <tag>@<host>, normalising the tag', async () => {
    const { federation, lookupObject } = fakeFederation()
    const result = await followTag(
      { federation, origin: 'https://aurboda.example', tagActorHost: async () => 'tags.example' },
      'bob',
      '#Running',
    )
    expect(lookupObject).toHaveBeenCalledWith('running@tags.example', expect.anything())
    expect(result).toMatchObject({ ok: false, status: 404 })
  })

  test('rejects an invalid hashtag without resolving anything', async () => {
    const { federation, lookupObject } = fakeFederation()
    const result = await followTag(
      { federation, origin: 'https://aurboda.example', tagActorHost: async () => 'tags.pub' },
      'bob',
      '#not valid',
    )
    expect(result).toEqual({ error: 'Not a valid hashtag.', ok: false, status: 400 })
    expect(lookupObject).not.toHaveBeenCalled()
  })
})

describe('serializeFollowedTag', () => {
  const record: FeedFollowingRecord = {
    accepted: true,
    actor_uri: 'https://tags.pub/user/running',
    avatar_url: null,
    created_at: new Date('2026-07-03T10:00:00Z'),
    display_name: '#running',
    handle: '@running@tags.pub',
    id: '22222222-2222-2222-2222-222222222222',
    inbox_uri: 'https://tags.pub/user/running/inbox',
    notify_on_post: false,
    shared_inbox_uri: null,
    tag: 'running',
  }

  test('is the following DTO plus the tag', () => {
    expect(serializeFollowedTag(record)).toEqual({ ...serializeFollowing(record), tag: 'running' })
  })

  test('null for a follow of a person', () => {
    expect(serializeFollowedTag({ ...record, tag: null })).toBeNull()
  })
})
