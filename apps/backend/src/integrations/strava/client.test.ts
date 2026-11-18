import type { Request, Response } from 'express'

import axios from 'axios'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { getOAuthToken, initializeSchema, schemaInitialized, upsertOAuthToken } from '../../db/index.ts'
import {
  SIGNED_STATE_MAX_AGE_MS,
  signOAuthState,
  verifyOAuthState,
} from '../../services/signed-oauth-state.ts'
import { stravaClient } from './client.ts'

vi.mock('axios')
vi.mock('../../db/index.ts', () => ({
  getOAuthToken: vi.fn(),
  initializeSchema: vi.fn(),
  schemaInitialized: vi.fn(),
  upsertOAuthToken: vi.fn(),
}))

const mockedAxios = vi.mocked(axios)

describe('stravaClient OAuth state', () => {
  const now = new Date('2026-11-17T12:00:00Z')
  const onUserAuthenticated = vi.fn()
  const auditWarn = vi.fn()
  const authClient = stravaClient(
    async () => ({ clientId: 'client-id', clientSecret: 'client-secret' }),
    'https://example.com/api',
    { auditWarn, now: () => now, onUserAuthenticated },
  )
  const unconfigured = stravaClient(
    async () => {
      throw new Error('Strava not configured')
    },
    'https://example.com/api',
    { auditWarn, now: () => now, onUserAuthenticated },
  )

  const fakeRes = () => {
    const res = { json: vi.fn(), redirect: vi.fn(), status: vi.fn() }
    res.status.mockReturnValue(res)
    res.json.mockReturnValue(res)
    return res
  }

  const callback = async (query: Record<string, unknown>, client = authClient) => {
    const res = fakeRes()
    await client.authCb({ query } as unknown as Request, res as unknown as Response)
    return res.redirect.mock.calls[0]?.[0] as string
  }

  const stateFor = (user: string, at = now) =>
    signOAuthState({ provider: 'strava', user }, 'client-secret', at)

  const expectNothingTouched = () => {
    expect(schemaInitialized).not.toHaveBeenCalled()
    expect(initializeSchema).not.toHaveBeenCalled()
    expect(mockedAxios.post).not.toHaveBeenCalled()
    expect(upsertOAuthToken).not.toHaveBeenCalled()
    expect(onUserAuthenticated).not.toHaveBeenCalled()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockedAxios.post = vi.fn().mockResolvedValue({
      data: {
        access_token: 'access',
        athlete: { id: 4242 },
        expires_at: 1_795_000_000,
        refresh_token: 'refresh',
      },
    })
    vi.mocked(getOAuthToken).mockResolvedValue(null)
  })

  test('getAuthorizeUrl sends a state signed at the injected time for the requesting user', async () => {
    const res = fakeRes()
    await authClient.getAuthorizeUrl({ user: 'alice' } as unknown as Request, res as unknown as Response)

    const { url } = res.json.mock.calls[0][0] as { url: string }
    const state = new URL(url).searchParams.get('state') ?? ''
    expect(verifyOAuthState(state, { provider: 'strava' }, 'client-secret', now)).toBe('alice')
    expect(
      verifyOAuthState(
        state,
        { provider: 'strava' },
        'client-secret',
        new Date(now.getTime() + SIGNED_STATE_MAX_AGE_MS + 1),
      ),
    ).toBeNull()
  })

  test('getAuthorizeUrl answers 401 without a user', async () => {
    const res = fakeRes()
    await authClient.getAuthorizeUrl({} as unknown as Request, res as unknown as Response)

    expect(res.status).toHaveBeenCalledWith(401)
  })

  test('authCb hands the code and state to the page, with no token request and no write', async () => {
    const state = stateFor('alice')
    const target = new URL(await callback({ code: 'the-code', state }), 'https://web.example.test')

    expect(target.pathname).toBe('/data-sources/strava')
    expect(target.searchParams.get('strava_code')).toBe('the-code')
    expect(target.searchParams.get('strava_state')).toBe(state)
    expectNothingTouched()
  })

  test.each([
    ['a bare username', 'alice'],
    ['another secret', signOAuthState({ provider: 'strava', user: 'alice' }, 'other-secret', now)],
    ['an expired state', stateFor('alice', new Date(now.getTime() - SIGNED_STATE_MAX_AGE_MS - 1))],
    ['an Oura state', signOAuthState({ provider: 'oura', user: 'alice' }, 'client-secret', now)],
  ])('authCb rejects %s as invalid_state and touches nothing', async (_, state) => {
    expect(await callback({ code: 'the-code', state })).toBe('/data-sources/strava?error=invalid_state')
    expectNothingTouched()
  })

  test.each([
    ['a missing code', { state: stateFor('alice') }],
    ['a missing state', { code: 'the-code' }],
    ['a repeated code', { code: ['the-code', 'other'], state: stateFor('alice') }],
    ['a repeated state', { code: 'the-code', state: [stateFor('alice'), stateFor('alice')] }],
    ['an error parameter', { error: 'access_denied' }],
  ])('authCb rejects %s as auth_failed and touches nothing', async (_, query) => {
    expect(await callback(query)).toBe('/data-sources/strava?error=auth_failed')
    expectNothingTouched()
  })

  test('authCb answers not_configured without server credentials', async () => {
    expect(await callback({ code: 'the-code', state: stateFor('alice') }, unconfigured)).toBe(
      '/data-sources/strava?error=not_configured',
    )
  })

  test('complete refuses a sign-in started by another account before any request', async () => {
    expect(await authClient.complete('alice', 'the-code', stateFor('bob'))).toEqual({
      ok: false,
      reason: 'wrong_user',
    })
    expectNothingTouched()
    expect(auditWarn.mock.calls).toEqual([
      ['alice', 'auth', 'Strava sign-in started by another account was refused'],
    ])
  })

  test('complete answers invalid_state for an expired or tampered state', async () => {
    const expired = stateFor('alice', new Date(now.getTime() - SIGNED_STATE_MAX_AGE_MS - 1))
    expect(await authClient.complete('alice', 'the-code', expired)).toEqual({
      ok: false,
      reason: 'invalid_state',
    })
    expect(await authClient.complete('alice', 'the-code', `${stateFor('alice')}x`)).toEqual({
      ok: false,
      reason: 'invalid_state',
    })
    expectNothingTouched()
  })

  test('complete answers not_configured without server credentials', async () => {
    expect(await unconfigured.complete('alice', 'the-code', stateFor('alice'))).toEqual({
      ok: false,
      reason: 'not_configured',
    })
    expectNothingTouched()
  })

  test('complete stores the token and the athlete mapping for the signed-in user', async () => {
    vi.mocked(schemaInitialized).mockResolvedValue(false)

    expect(await authClient.complete('alice', 'the-code', stateFor('alice'))).toEqual({ ok: true })

    expect(initializeSchema).toHaveBeenCalledWith('alice')
    expect(mockedAxios.post).toHaveBeenCalledWith('https://www.strava.com/oauth/token', {
      client_id: 'client-id',
      client_secret: 'client-secret',
      code: 'the-code',
      grant_type: 'authorization_code',
    })
    expect(upsertOAuthToken).toHaveBeenCalledWith('alice', {
      access_token: 'access',
      expires_at: new Date(1_795_000_000 * 1000),
      provider: 'strava',
      refresh_token: 'refresh',
      scopes: ['activity:read_all', 'profile:read_all', 'read'],
    })
    expect(onUserAuthenticated).toHaveBeenCalledWith(4242, 'alice')
  })

  test('complete answers auth_failed when the exchange fails, storing nothing and auditing no secret', async () => {
    vi.mocked(schemaInitialized).mockResolvedValue(true)
    mockedAxios.post = vi.fn().mockRejectedValue(new Error('400 for the-code with client-secret'))

    expect(await authClient.complete('alice', 'the-code', stateFor('alice'))).toEqual({
      ok: false,
      reason: 'auth_failed',
    })

    expect(upsertOAuthToken).not.toHaveBeenCalled()
    expect(onUserAuthenticated).not.toHaveBeenCalled()
    expect(auditWarn).toHaveBeenCalledWith(
      'alice',
      'auth',
      'Strava OAuth connection failed',
      expect.anything(),
    )
    const audited = JSON.stringify(auditWarn.mock.calls)
    expect(audited).not.toContain('the-code')
    expect(audited).not.toContain('client-secret')
  })
})
