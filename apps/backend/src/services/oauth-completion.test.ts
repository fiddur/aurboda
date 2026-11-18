import { describe, expect, it, vi } from 'vitest'

import { handOverOAuthCallback } from './oauth-completion.ts'

const accept = async () => null

describe('handOverOAuthCallback', () => {
  it('hands the code and state to the provider page under its own parameter names', async () => {
    const target = await handOverOAuthCallback({ code: 'fake-code&x=1', state: 'fake-state' }, 'oura', accept)
    const url = new URL(target, 'https://web.example.test')
    expect(url.pathname).toBe('/data-sources/oura')
    expect([...url.searchParams.keys()]).toEqual(['oura_code', 'oura_state'])
    expect(url.searchParams.get('oura_code')).toBe('fake-code&x=1')
    expect(url.searchParams.get('oura_state')).toBe('fake-state')
  })

  it.each([
    ['a missing code', { state: 'fake-state' }],
    ['a missing state', { code: 'fake-code' }],
    ['an error parameter', { code: 'fake-code', error: 'access_denied', state: 'fake-state' }],
    ['a repeated code', { code: ['fake-code', 'other'], state: 'fake-state' }],
    ['a repeated state', { code: 'fake-code', state: ['fake-state', 'other'] }],
    ['an empty code', { code: '', state: 'fake-state' }],
    ['no query at all', undefined],
  ])('answers auth_failed for %s without checking the state', async (_, query) => {
    const checkState = vi.fn(accept)
    expect(await handOverOAuthCallback(query, 'strava', checkState)).toBe(
      '/data-sources/strava?error=auth_failed',
    )
    expect(checkState).not.toHaveBeenCalled()
  })

  it('answers the refusal the state check gives', async () => {
    const query = { code: 'fake-code', state: 'fake-state' }
    expect(await handOverOAuthCallback(query, 'gravl', async () => 'invalid_state')).toBe(
      '/data-sources/gravl?error=invalid_state',
    )
    expect(await handOverOAuthCallback(query, 'gravl', async () => 'not_configured')).toBe(
      '/data-sources/gravl?error=not_configured',
    )
  })
})
