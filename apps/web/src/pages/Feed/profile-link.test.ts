import { describe, expect, it } from 'vitest'

import { localProfilePath } from './profile-link'

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
