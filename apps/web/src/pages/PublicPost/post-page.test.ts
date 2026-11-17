import { describe, expect, it } from 'vitest'

import { ownsPostPage } from './post-page'

describe('ownsPostPage', () => {
  it('is false signed out, even with a remembered user name', () => {
    expect(ownsPostPage({}, 'fredrik')).toBe(false)
    expect(ownsPostPage({ user: 'fredrik' }, 'fredrik')).toBe(false)
  })

  it('is false signed in as someone else', () => {
    expect(ownsPostPage({ token: 't', user: 'alice' }, 'fredrik')).toBe(false)
  })

  it('is true signed in as the author', () => {
    expect(ownsPostPage({ token: 't', user: 'fredrik' }, 'fredrik')).toBe(true)
  })
})
