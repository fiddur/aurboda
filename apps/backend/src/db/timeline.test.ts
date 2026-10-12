import { describe, expect, test } from 'vitest'

import { escapeLike } from './timeline.ts'

describe('escapeLike', () => {
  test('escapes LIKE’s own wildcards so a prefix stays literal', () => {
    // Without this, `foo_bar` matches `fooxbar`: `_` is LIKE's single-character
    // wildcard, and a username may contain one.
    expect(escapeLike('foo_bar')).toBe('foo\\_bar')
    expect(escapeLike('50%')).toBe('50\\%')
    expect(escapeLike('back\\slash')).toBe('back\\\\slash')
  })

  test('leaves a plain prefix untouched', () => {
    expect(escapeLike('https://aurboda.example/users/freja/feed/')).toBe(
      'https://aurboda.example/users/freja/feed/',
    )
  })
})
