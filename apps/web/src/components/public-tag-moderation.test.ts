import { describe, expect, test } from 'vitest'

import { blockKindLabel, moderationOptions, removedByModeration } from './public-tag-moderation'

const bob = { actor_uri: 'https://Social.Peer.example/users/bob', handle: '@bob@social.peer.example' }

describe('moderationOptions', () => {
  test('hide, block the author by handle and block the domain by host', () => {
    expect(moderationOptions(bob, 'aurboda.example').map((o) => [o.label, o.action])).toEqual([
      ['Hide post', { kind: 'hide' }],
      ['Block @bob@social.peer.example', { kind: 'actor', value: bob.actor_uri }],
      ['Block social.peer.example', { kind: 'domain', value: 'social.peer.example' }],
    ])
  })

  test('names the author by actor URI without a handle', () => {
    expect(moderationOptions({ ...bob, handle: null }, 'aurboda.example')[1].label).toBe(
      `Block ${bob.actor_uri}`,
    )
  })

  test('offers no domain block for this server’s own posts', () => {
    const own = { actor_uri: 'https://aurboda.example/users/alice', handle: '@alice@aurboda.example' }
    expect(moderationOptions(own, 'Aurboda.example').map((o) => o.action.kind)).toEqual(['hide', 'actor'])
  })
})

describe('removedByModeration', () => {
  const posts = [
    { actor_uri: 'https://peer.example/users/bob', id: 'a' },
    { actor_uri: 'https://peer.example/users/bob', id: 'b' },
    { actor_uri: 'https://m.peer.example/users/eve', id: 'c' },
    { actor_uri: 'https://other.example/users/x', id: 'd' },
  ]
  const kept = (postId: string, action: Parameters<typeof removedByModeration>[2]) =>
    posts.filter((post) => !removedByModeration(post, postId, action)).map((post) => post.id)

  test('hide removes that post only', () => {
    expect(kept('a', { kind: 'hide' })).toEqual(['b', 'c', 'd'])
  })

  test('an author block removes every post by that actor', () => {
    expect(kept('a', { kind: 'actor', value: 'https://peer.example/users/bob' })).toEqual(['c', 'd'])
  })

  test('a domain block removes the host and its subdomains', () => {
    expect(kept('a', { kind: 'domain', value: 'peer.example' })).toEqual(['d'])
  })
})

describe('blockKindLabel', () => {
  test('names the kinds', () => {
    expect(blockKindLabel('actor')).toBe('Author')
    expect(blockKindLabel('domain')).toBe('Domain')
  })
})
