import { describe, expect, it } from 'vitest'

import { postPermalinkPath } from './post-permalink'

const ID = '11111111-2222-4333-8444-555555555555'

describe('postPermalinkPath', () => {
  it('links a public post to its permalink page', () => {
    expect(postPermalinkPath('fredrik', { id: ID, visibility: 'public' })).toBe(`/u/fredrik/posts/${ID}`)
  })

  it('links an unlisted post too, since the permalink page resolves it', () => {
    expect(postPermalinkPath('fredrik', { id: ID, visibility: 'unlisted' })).toBe(`/u/fredrik/posts/${ID}`)
  })

  it('returns null for a followers-only post, which the public page would not show', () => {
    expect(postPermalinkPath('fredrik', { id: ID, visibility: 'followers' })).toBeNull()
  })

  it('encodes the username', () => {
    expect(postPermalinkPath('a b/c?', { id: ID, visibility: 'public' })).toBe(`/u/a%20b%2Fc%3F/posts/${ID}`)
  })
})
