import { describe, expect, test } from 'vitest'

import {
  formatHandlesInput,
  formatUsernamesInput,
  listsAuthors,
  officialFeedOfPage,
  officialFeedSummary,
  parseHandlesInput,
  parseUsernamesInput,
} from './official-feed'

describe('parseUsernamesInput', () => {
  test('splits on spaces and commas, drops a leading @ and duplicates', () => {
    expect(parseUsernamesInput(' fiddur, @alice  bob,fiddur ')).toEqual(['fiddur', 'alice', 'bob'])
    expect(parseUsernamesInput('  ')).toEqual([])
  })

  test('round-trips through formatUsernamesInput', () => {
    expect(parseUsernamesInput(formatUsernamesInput(['fiddur', 'alice']))).toEqual(['fiddur', 'alice'])
  })
})

describe('parseHandlesInput', () => {
  test('splits on spaces and commas, dropping duplicates', () => {
    expect(parseHandlesInput(' @fiddur@aurboda.net, bob@peer.example @fiddur@aurboda.net ')).toEqual([
      '@fiddur@aurboda.net',
      'bob@peer.example',
    ])
    expect(parseHandlesInput('')).toEqual([])
  })

  test('formats stored handles with a leading @, parsing back to the same handles', () => {
    expect(formatHandlesInput(['fiddur@aurboda.net', 'bob@peer.example'])).toBe(
      '@fiddur@aurboda.net, @bob@peer.example',
    )
  })
})

describe('officialFeedSummary', () => {
  test('names the users, the remote authors and, when set, the tags', () => {
    expect(officialFeedSummary({ remote_authors: [], tags: [], users: ['fiddur'] })).toBe(
      'Posts from @fiddur',
    )
    expect(officialFeedSummary({ remote_authors: [], tags: ['aurboda'], users: ['fiddur', 'alice'] })).toBe(
      'Posts from @fiddur and @alice tagged #aurboda',
    )
    expect(officialFeedSummary({ remote_authors: [], tags: ['x', 'y'], users: ['a', 'b', 'c'] })).toBe(
      'Posts from @a, @b and @c tagged #x or #y',
    )
  })

  test('names remote authors by their full handle', () => {
    expect(
      officialFeedSummary({ remote_authors: ['fiddur@aurboda.net'], tags: ['aurbodablog'], users: [] }),
    ).toBe('Posts from @fiddur@aurboda.net tagged #aurbodablog')
    expect(
      officialFeedSummary({ remote_authors: ['bob@peer.example'], tags: ['qs'], users: ['alice'] }),
    ).toBe('Posts from @alice and @bob@peer.example tagged #qs')
  })
})

describe('officialFeedOfPage and listsAuthors', () => {
  test('reads what a page lists, nothing before it loads', () => {
    expect(officialFeedOfPage(undefined)).toEqual({ remote_authors: [], tags: [], users: [] })
    const page = { posts: [], remote_authors: ['bob@peer.example'], success: true, tags: ['qs'], users: [] }
    expect(officialFeedOfPage(page)).toEqual({
      remote_authors: ['bob@peer.example'],
      tags: ['qs'],
      users: [],
    })
  })

  test('lists authors with local users or remote authors', () => {
    expect(listsAuthors({ remote_authors: [], users: [] })).toBe(false)
    expect(listsAuthors({ remote_authors: [], users: ['alice'] })).toBe(true)
    expect(listsAuthors({ remote_authors: ['bob@peer.example'], users: [] })).toBe(true)
  })
})
