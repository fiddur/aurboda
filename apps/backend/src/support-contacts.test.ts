import { normalizeFediverseHandle, normalizeRedditUsername } from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

describe('normalizeFediverseHandle', () => {
  test.each([
    ['@fiddur@aurboda.net', 'fiddur@aurboda.net'],
    ['fiddur@aurboda.net', 'fiddur@aurboda.net'],
    ['  @Fiddur@Aurboda.NET ', 'Fiddur@aurboda.net'],
    ['first.last-1@social.example.org', 'first.last-1@social.example.org'],
    ['', ''],
    ['   ', ''],
  ])('%j → %j', (input, expected) => {
    expect(normalizeFediverseHandle(input)).toBe(expected)
  })

  test.each([
    'fiddur',
    '@fiddur',
    '@@fiddur@aurboda.net',
    'fiddur@',
    'a@b@aurboda.net',
    'https://aurboda.net/@fiddur',
    'fid dur@aurboda.net',
    'fiddur@aurboda.net.',
  ])('rejects %j', (input) => {
    expect(normalizeFediverseHandle(input)).toBeNull()
  })
})

describe('normalizeRedditUsername', () => {
  test.each([
    ['fiddur', 'fiddur'],
    ['u/fiddur', 'fiddur'],
    ['/u/fiddur', 'fiddur'],
    ['U/Fiddur_-1', 'Fiddur_-1'],
    ['https://www.reddit.com/user/fiddur', 'fiddur'],
    ['https://www.reddit.com/user/fiddur/', 'fiddur'],
    ['https://old.reddit.com/user/fiddur/', 'fiddur'],
    ['https://reddit.com/u/fiddur', 'fiddur'],
    ['reddit.com/user/fiddur', 'fiddur'],
    ['', ''],
  ])('%j → %j', (input, expected) => {
    expect(normalizeRedditUsername(input)).toBe(expected)
  })

  test.each([
    'ab',
    'a'.repeat(21),
    'u/has space',
    'fid.dur',
    'https://example.com/user/fiddur',
    'https://www.reddit.com/r/aurboda',
    'https://www.reddit.com/user/fiddur/comments',
  ])('rejects %j', (input) => {
    expect(normalizeRedditUsername(input)).toBeNull()
  })
})
