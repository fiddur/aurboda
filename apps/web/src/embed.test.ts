import { describe, expect, test } from 'vitest'

import { computeEmbedded, computePlayStoreBuild, parseNativeAuth } from './embed'

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

describe('computePlayStoreBuild', () => {
  test('true when the Google Play app sets the store flag', () => {
    expect(computePlayStoreBuild('?embed=1&store=play', null)).toBe(true)
    expect(computePlayStoreBuild('?store=play', null)).toBe(true)
  })

  test('true when a previously-detected flag is stored', () => {
    expect(computePlayStoreBuild('', 'play')).toBe(true)
    expect(computePlayStoreBuild('?embed=1', 'play')).toBe(true)
  })

  test('false for the GitHub and F-Droid apps and for a normal browser', () => {
    expect(computePlayStoreBuild('?embed=1', null)).toBe(false)
    expect(computePlayStoreBuild('', null)).toBe(false)
    expect(computePlayStoreBuild('?store=fdroid', null)).toBe(false)
    expect(computePlayStoreBuild('?store=Play', null)).toBe(false)
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
