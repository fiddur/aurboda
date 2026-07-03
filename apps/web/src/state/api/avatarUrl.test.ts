import { describe, expect, test } from 'vitest'

import { buildAvatarUrl } from './avatarUrl'

describe('buildAvatarUrl', () => {
  test('resolves against the page origin when the API URL is same-origin (prod)', () => {
    expect(buildAvatarUrl('fiddur', '/api', 'https://aurboda.net')).toBe(
      'https://aurboda.net/u/fiddur/avatar.png',
    )
  })

  test('resolves against the backend origin when the API URL is absolute (dev)', () => {
    expect(buildAvatarUrl('fiddur', 'http://localhost:3000/api', 'http://localhost:5173')).toBe(
      'http://localhost:3000/u/fiddur/avatar.png',
    )
  })

  test('encodes the username', () => {
    expect(buildAvatarUrl('a b', '/api', 'https://aurboda.net')).toBe(
      'https://aurboda.net/u/a%20b/avatar.png',
    )
  })
})
