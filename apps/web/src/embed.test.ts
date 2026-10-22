import { describe, expect, test } from 'vitest'

import { computeEmbedded, parseNativeAuth } from './embed'

describe('computeEmbedded', () => {
  test('true when the embed query flag is set', () => {
    expect(computeEmbedded('?embed=1', null)).toBe(true)
    expect(computeEmbedded('?foo=bar&embed=1', null)).toBe(true)
  })

  test('true when a previously-detected flag is stored', () => {
    expect(computeEmbedded('', '1')).toBe(true)
    expect(computeEmbedded('?other=x', '1')).toBe(true)
  })

  test('false for a normal browser session', () => {
    expect(computeEmbedded('', null)).toBe(false)
    expect(computeEmbedded('?embed=0', null)).toBe(false)
    expect(computeEmbedded('?embed=true', null)).toBe(false)
  })
})

describe('parseNativeAuth', () => {
  test('parses a full auth payload', () => {
    expect(parseNativeAuth('{"user":"fiddur","token":"abc","is_admin":true}')).toEqual({
      is_admin: true,
      token: 'abc',
      user: 'fiddur',
    })
  })

  test('tolerates a missing is_admin / user', () => {
    expect(parseNativeAuth('{"token":"abc"}')).toEqual({
      is_admin: undefined,
      token: 'abc',
      user: undefined,
    })
  })

  test('returns null without a usable token', () => {
    expect(parseNativeAuth('{"user":"fiddur"}')).toBeNull()
    expect(parseNativeAuth('{"token":""}')).toBeNull()
    expect(parseNativeAuth('{"token":123}')).toBeNull()
  })

  test('returns null for missing or malformed input', () => {
    expect(parseNativeAuth(null)).toBeNull()
    expect(parseNativeAuth(undefined)).toBeNull()
    expect(parseNativeAuth('')).toBeNull()
    expect(parseNativeAuth('not json')).toBeNull()
    expect(parseNativeAuth('[]')).toBeNull()
    expect(parseNativeAuth('"string"')).toBeNull()
  })
})
