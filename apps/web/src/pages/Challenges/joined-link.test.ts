import { describe, expect, test } from 'vitest'

import { hostPageLink, joinedChallengeHref, joinedChallengePath } from './joined-link'

const id = '0b6f3c1e-8a4d-4f6e-9c2b-1d2e3f4a5b6c'

describe('joinedChallengeHref', () => {
  test('a challenge on this server links to its own page', () => {
    expect(joinedChallengeHref('https://aurboda.net/u/fiddur/july', id, 'https://aurboda.net')).toBe(
      'https://aurboda.net/u/fiddur/july',
    )
  })

  test('a challenge on another server links to the joined-challenge page here', () => {
    expect(joinedChallengeHref('https://other.example/u/anna/july', id, 'https://aurboda.net')).toBe(
      `/challenges/joined/${id}`,
    )
  })

  test('the same host on another port or scheme is another origin', () => {
    expect(joinedChallengeHref('http://aurboda.net/u/fiddur/july', id, 'https://aurboda.net')).toBe(
      `/challenges/joined/${id}`,
    )
    expect(joinedChallengeHref('https://aurboda.net:8443/u/fiddur/july', id, 'https://aurboda.net')).toBe(
      `/challenges/joined/${id}`,
    )
  })

  test('host case and a default port do not make another origin', () => {
    expect(joinedChallengeHref('https://Aurboda.NET:443/u/fiddur/july', id, 'https://aurboda.net')).toBe(
      'https://Aurboda.NET:443/u/fiddur/july',
    )
  })

  test('an unparsable challenge URL links to the joined-challenge page', () => {
    expect(joinedChallengeHref('javascript:alert(1)', id, 'https://aurboda.net')).toBe(
      `/challenges/joined/${id}`,
    )
    expect(joinedChallengeHref('not a url', id, 'https://aurboda.net')).toBe(`/challenges/joined/${id}`)
  })
})

describe('joinedChallengePath', () => {
  test('encodes the id', () => {
    expect(joinedChallengePath('a/b')).toBe('/challenges/joined/a%2Fb')
  })
})

describe('hostPageLink', () => {
  test('labels an http(s) page with its host', () => {
    expect(hostPageLink('https://other.example/u/anna/july')).toEqual({
      host: 'other.example',
      href: 'https://other.example/u/anna/july',
    })
  })

  test('nothing for a missing or non-http(s) URL', () => {
    expect(hostPageLink(undefined)).toBeNull()
    expect(hostPageLink('javascript:alert(1)')).toBeNull()
  })
})
