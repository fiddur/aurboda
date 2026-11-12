import { describe, expect, test } from 'vitest'

import { confirmedJoinTarget, hostProfileUrl, joinPagePath, parseJoinQuery, safeHttpUrl } from './join-query'

describe('parseJoinQuery', () => {
  test('joins on load unless confirm=1 asks for a click first', () => {
    const url = 'https://peer.example/u/alice/abc'
    expect(parseJoinQuery({ challenge: url })).toEqual({
      challengeUrl: url,
      confirm: false,
      safeChallengeUrl: url,
    })
    expect(parseJoinQuery({ challenge: url, confirm: '1' }).confirm).toBe(true)
    expect(parseJoinQuery({ challenge: url, confirm: 'yes' }).confirm).toBe(false)
  })

  test('no challenge is an empty URL', () => {
    expect(parseJoinQuery({})).toEqual({ challengeUrl: '', confirm: false, safeChallengeUrl: null })
  })

  test('never offers a non-http(s) challenge as a link', () => {
    expect(parseJoinQuery({ challenge: 'javascript:alert(1)' }).safeChallengeUrl).toBeNull()
  })
})

describe('safeHttpUrl', () => {
  test('keeps http(s) only', () => {
    expect(safeHttpUrl('https://peer.example/u/alice')).toBe('https://peer.example/u/alice')
    expect(safeHttpUrl('http://localhost:8080/u/alice')).toBe('http://localhost:8080/u/alice')
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull()
    expect(safeHttpUrl('/u/alice')).toBeNull()
  })
})

describe('joinPagePath', () => {
  test('round-trips through parseJoinQuery, confirm included', () => {
    const url = 'https://peer.example/u/alice/abc?embed=1&x=y'
    const path = joinPagePath(url, true)
    expect(path).toBe(
      '/challenges/join?challenge=https%3A%2F%2Fpeer.example%2Fu%2Falice%2Fabc%3Fembed%3D1%26x%3Dy&confirm=1',
    )
    const query = Object.fromEntries(new URL(path, 'https://home.example').searchParams)
    expect(parseJoinQuery(query)).toMatchObject({ challengeUrl: url, confirm: true })
    expect(joinPagePath(url, false)).not.toContain('confirm')
  })
})

describe('confirmedJoinTarget', () => {
  test("stays on this instance: the challenge's page when hosted here, else /challenges", () => {
    expect(confirmedJoinTarget('https://home.example/u/alice/abc', 'https://home.example')).toBe(
      '/u/alice/abc',
    )
    expect(confirmedJoinTarget('https://peer.example/u/alice/abc', 'https://home.example')).toBe(
      '/challenges',
    )
    expect(confirmedJoinTarget('https://home.example.evil/u/alice/abc', 'https://home.example')).toBe(
      '/challenges',
    )
    expect(confirmedJoinTarget('https://home.example/nope', 'https://home.example')).toBe('/challenges')
  })
})

describe('hostProfileUrl', () => {
  test('names the host the link itself names', () => {
    expect(hostProfileUrl('https://peer.example/u/alice/abc')).toBe('https://peer.example/u/alice')
    expect(hostProfileUrl('https://peer.example/sub/u/alice/abc')).toBe('https://peer.example/sub/u/alice')
    expect(hostProfileUrl('javascript:x/u/alice/abc')).toBeNull()
    expect(hostProfileUrl('https://peer.example/alice')).toBeNull()
  })
})
