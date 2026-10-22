import { describe, expect, it } from 'vitest'

import { actorProfileLink, localProfilePath } from './profile-link'

describe('localProfilePath', () => {
  const HOST = 'aurboda.net'

  it('maps a local actor URI to its /u/:username path', () => {
    expect(localProfilePath('https://aurboda.net/users/fredrik', HOST)).toBe('/u/fredrik')
    // A trailing slash is tolerated.
    expect(localProfilePath('https://aurboda.net/users/fredrik/', HOST)).toBe('/u/fredrik')
  })

  it('returns null for a remote actor on another instance', () => {
    expect(localProfilePath('https://mastodon.social/users/alice', HOST)).toBeNull()
  })

  it('returns null for a local URL that is not an actor path', () => {
    expect(localProfilePath('https://aurboda.net/@fredrik', HOST)).toBeNull()
    expect(localProfilePath('https://aurboda.net/users/fredrik/statuses/1', HOST)).toBeNull()
  })

  it('returns null for a malformed URI', () => {
    expect(localProfilePath('not a url', HOST)).toBeNull()
  })
})

describe('actorProfileLink', () => {
  const HOST = 'aurboda.net'

  it('links a local actor to its /u/:username page, not external', () => {
    expect(actorProfileLink('https://aurboda.net/users/fredrik', HOST)).toEqual({
      external: false,
      href: '/u/fredrik',
    })
  })

  it('links a remote actor to its own URL, flagged external', () => {
    expect(actorProfileLink('https://mastodon.social/users/alice', HOST)).toEqual({
      external: true,
      href: 'https://mastodon.social/users/alice',
    })
  })

  it('returns null for a non-http(s) or malformed actor URI', () => {
    expect(actorProfileLink('mailto:alice@mastodon.social', HOST)).toBeNull()
    expect(actorProfileLink('not a url', HOST)).toBeNull()
  })
})
