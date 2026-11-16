import { describe, expect, it } from 'vitest'

import {
  DEFAULT_TAG_ACTOR_HOST,
  isOnTagActorHost,
  readTagActorHost,
  tagActorHostOrDefault,
} from './tag-actor-host.ts'

describe('tagActorHostOrDefault', () => {
  it('falls back to tags.pub when unset or empty', () => {
    expect(tagActorHostOrDefault(null)).toBe(DEFAULT_TAG_ACTOR_HOST)
    expect(tagActorHostOrDefault(undefined)).toBe('tags.pub')
    expect(tagActorHostOrDefault('  ')).toBe('tags.pub')
  })

  it('keeps a configured host', () => {
    expect(tagActorHostOrDefault('tags.example')).toBe('tags.example')
  })
})

describe('readTagActorHost', () => {
  it('reads the server setting', async () => {
    const centralDb = { getServerSetting: async () => 'relay.example' } as never
    expect(await readTagActorHost(centralDb)).toBe('relay.example')
  })
})

describe('isOnTagActorHost', () => {
  it('matches an account on the host, ignoring case', () => {
    expect(isOnTagActorHost('https://tags.pub/user/aurboda', 'tags.pub')).toBe(true)
    expect(isOnTagActorHost('https://TAGS.PUB/user/x', 'tags.pub')).toBe(true)
    expect(isOnTagActorHost('https://tags.pub/user/x', ' TAGS.pub ')).toBe(true)
  })

  it('does not match other hosts', () => {
    expect(isOnTagActorHost('https://mastodon.example/users/a', 'tags.pub')).toBe(false)
    expect(isOnTagActorHost('https://tags.pub.evil.example/user/x', 'tags.pub')).toBe(false)
    expect(isOnTagActorHost('https://nottags.pub/user/x', 'tags.pub')).toBe(false)
  })

  it('is false for a non-URL', () => {
    expect(isOnTagActorHost('not a url', 'tags.pub')).toBe(false)
  })

  it('counts the port', () => {
    expect(isOnTagActorHost('http://localhost:3001/user/x', 'localhost:3001')).toBe(true)
    expect(isOnTagActorHost('http://localhost:3001/user/x', 'localhost')).toBe(false)
    expect(isOnTagActorHost('http://localhost/user/x', 'localhost:3001')).toBe(false)
  })
})
