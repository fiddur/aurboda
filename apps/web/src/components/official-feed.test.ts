import { describe, expect, test } from 'vitest'

import { formatUsernamesInput, officialFeedSummary, parseUsernamesInput } from './official-feed'

describe('parseUsernamesInput', () => {
  test('splits on spaces and commas, drops a leading @ and duplicates', () => {
    expect(parseUsernamesInput(' fiddur, @alice  bob,fiddur ')).toEqual(['fiddur', 'alice', 'bob'])
    expect(parseUsernamesInput('  ')).toEqual([])
  })

  test('round-trips through formatUsernamesInput', () => {
    expect(parseUsernamesInput(formatUsernamesInput(['fiddur', 'alice']))).toEqual(['fiddur', 'alice'])
  })
})

describe('officialFeedSummary', () => {
  test('names the users and, when set, the tags', () => {
    expect(officialFeedSummary(['fiddur'], [])).toBe('Posts from @fiddur')
    expect(officialFeedSummary(['fiddur', 'alice'], ['aurboda'])).toBe(
      'Posts from @fiddur and @alice tagged #aurboda',
    )
    expect(officialFeedSummary(['a', 'b', 'c'], ['x', 'y'])).toBe('Posts from @a, @b and @c tagged #x or #y')
  })
})
