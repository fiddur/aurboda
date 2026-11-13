import { describe, expect, it } from 'vitest'

import {
  connectionUpdate,
  sameOrigin,
  syncResultMessage,
  tokenWillBeRemoved,
} from './homeAssistantConnection'

const stored = { tokenSet: true, url: 'https://ha.example.org' }

describe('sameOrigin', () => {
  it('ignores path and trailing slash', () => {
    expect(sameOrigin('https://ha.example.org', 'https://ha.example.org/')).toBe(true)
    expect(sameOrigin('https://ha.example.org', 'https://ha.example.org/sub')).toBe(true)
  })

  it('tells scheme, host and port apart', () => {
    expect(sameOrigin('https://ha.example.org', 'http://ha.example.org')).toBe(false)
    expect(sameOrigin('https://ha.example.org', 'https://other.example.org')).toBe(false)
    expect(sameOrigin('https://ha.example.org', 'https://ha.example.org:8123')).toBe(false)
  })

  it('is false when either side is missing or not a URL', () => {
    expect(sameOrigin(null, 'https://ha.example.org')).toBe(false)
    expect(sameOrigin('https://ha.example.org', null)).toBe(false)
    expect(sameOrigin('not a url', 'not a url')).toBe(false)
  })
})

describe('tokenWillBeRemoved', () => {
  it('warns when the origin changes and no new token is entered', () => {
    expect(tokenWillBeRemoved(stored, { token: '', url: 'https://other.example.org' })).toBe(true)
  })

  it('does not warn for the same origin', () => {
    expect(tokenWillBeRemoved(stored, { token: '', url: 'https://ha.example.org/' })).toBe(false)
  })

  it('does not warn when a new token comes with the URL', () => {
    expect(tokenWillBeRemoved(stored, { token: 'abc', url: 'https://other.example.org' })).toBe(false)
  })

  it('does not warn when no token is stored', () => {
    expect(tokenWillBeRemoved({ ...stored, tokenSet: false }, { token: '', url: 'https://x.org' })).toBe(
      false,
    )
  })

  it('does not warn while the field is not a URL yet', () => {
    expect(tokenWillBeRemoved(stored, { token: '', url: 'https://' })).toBe(false)
    expect(tokenWillBeRemoved(stored, { token: '', url: '' })).toBe(false)
  })
})

describe('connectionUpdate', () => {
  const none = { tokenSet: false, url: null }

  it('refuses a token before any URL', () => {
    expect(connectionUpdate(none, { token: 'abc', url: '' })).toEqual({ error: 'Enter the URL first' })
  })

  it('refuses to empty a stored URL', () => {
    expect(connectionUpdate(stored, { token: '', url: ' ' })).toHaveProperty('error')
  })

  it('sends URL and token together on first setup', () => {
    expect(connectionUpdate(none, { token: ' abc ', url: ' https://ha.example.org ' })).toEqual({
      update: { home_assistant_token: 'abc', home_assistant_url: 'https://ha.example.org' },
    })
  })

  it('sends only the token when the URL is unchanged', () => {
    expect(connectionUpdate(stored, { token: 'new', url: 'https://ha.example.org' })).toEqual({
      update: { home_assistant_token: 'new' },
    })
  })

  it('sends only the URL when no token is entered', () => {
    expect(connectionUpdate(stored, { token: '', url: 'https://other.example.org' })).toEqual({
      update: { home_assistant_url: 'https://other.example.org' },
    })
  })

  it('sends nothing when nothing changed', () => {
    expect(connectionUpdate(stored, { token: '', url: 'https://ha.example.org' })).toEqual({ update: {} })
  })
})

describe('syncResultMessage', () => {
  const result = {
    locations_fetched: 5,
    locations_inserted: 3,
    locations_superseded: 0,
    status: 'success' as const,
  }

  it('counts new points', () => {
    expect(syncResultMessage(result)).toBe('3 new location points')
    expect(syncResultMessage({ ...result, locations_inserted: 1 })).toBe('1 new location point')
  })

  it('mentions superseded points only when there are some', () => {
    expect(syncResultMessage({ ...result, locations_superseded: 2 })).toBe(
      '3 new location points, 2 superseded by activity GPS tracks',
    )
  })

  it('shows the error of a failed sync', () => {
    expect(
      syncResultMessage({ ...result, error: 'Home Assistant rejected the access token', status: 'error' }),
    ).toBe('Home Assistant rejected the access token')
  })
})
