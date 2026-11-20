import type { Request, Response } from 'express'

import axios from 'axios'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { getOAuthToken, initializeSchema, schemaInitialized, upsertOAuthToken } from '../../db/index.ts'
import {
  SIGNED_STATE_MAX_AGE_MS,
  signOAuthState,
  verifyOAuthState,
} from '../../services/signed-oauth-state.ts'
import { stravaClient, stravaResponseTransform } from './client.ts'

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
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://www.strava.com/oauth/token',
      {
        client_id: 'client-id',
        client_secret: 'client-secret',
        code: 'the-code',
        grant_type: 'authorization_code',
      },
      { transformResponse: stravaResponseTransform },
    )
    expect(upsertOAuthToken).toHaveBeenCalledWith('alice', {
      access_token: 'access',
      expires_at: new Date(1_795_000_000 * 1000),
      provider: 'strava',
      refresh_token: 'refresh',
      scopes: ['activity:read_all', 'profile:read_all', 'read'],
    })
    expect(onUserAuthenticated).toHaveBeenCalledWith('4242', 'alice')
  })

  test.each([
    [
      'prefers id_str over a rounded id',
      { id: 9007199254740992, id_str: '9007199254740993' },
      '9007199254740993',
    ],
    [
      'passes a losslessly parsed string id through exactly',
      { id: '9223372036854775807' },
      '9223372036854775807',
    ],
  ])('complete %s for the athlete mapping', async (_, athlete, expected) => {
    vi.mocked(schemaInitialized).mockResolvedValue(true)
    mockedAxios.post = vi.fn().mockResolvedValue({
      data: { access_token: 'access', athlete, expires_at: 1_795_000_000, refresh_token: 'refresh' },
    })

    expect(await authClient.complete('alice', 'the-code', stateFor('alice'))).toEqual({ ok: true })
    expect(onUserAuthenticated).toHaveBeenCalledWith(expected, 'alice')
  })

  test.each([
    ['no athlete', undefined],
    ['an athlete with no usable id', { id: 9007199254740992 }],
  ])('complete answers auth_failed for %s, storing no token', async (_, athlete) => {
    vi.mocked(schemaInitialized).mockResolvedValue(true)
    mockedAxios.post = vi.fn().mockResolvedValue({
      data: { access_token: 'access', athlete, expires_at: 1_795_000_000, refresh_token: 'refresh' },
    })

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
  })

  test('complete stores the token with no athlete when nothing links the athlete', async () => {
    vi.mocked(schemaInitialized).mockResolvedValue(true)
    mockedAxios.post = vi.fn().mockResolvedValue({
      data: { access_token: 'access', expires_at: 1_795_000_000, refresh_token: 'refresh' },
    })
    const unlinked = stravaClient(
      async () => ({ clientId: 'client-id', clientSecret: 'client-secret' }),
      'https://example.com/api',
      { auditWarn, now: () => now },
    )

    expect(await unlinked.complete('alice', 'the-code', stateFor('alice'))).toEqual({ ok: true })
    expect(upsertOAuthToken).toHaveBeenCalledWith(
      'alice',
      expect.objectContaining({ access_token: 'access' }),
    )
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

describe('stravaResponseTransform', () => {
  test('keeps an id above 2^53 exact', () => {
    expect(stravaResponseTransform('{"id":9007199254740993,"athlete":{"id":42}}')).toEqual({
      athlete: { id: 42 },
      id: '9007199254740993',
    })
  })

  test('returns a body that is not JSON as it is', () => {
    expect(stravaResponseTransform('<html>Bad Gateway</html>')).toBe('<html>Bad Gateway</html>')
  })

  test('passes an empty string and non-strings through', () => {
    expect(stravaResponseTransform('')).toBe('')
    const parsed = { id: 1 }
    expect(stravaResponseTransform(parsed)).toBe(parsed)
  })
})

describe('stravaClient requests', () => {
  const client = stravaClient(
    async () => ({ clientId: 'client-id', clientSecret: 'client-secret' }),
    'https://example.com/api',
  )

  beforeEach(() => {
    vi.clearAllMocks()
    mockedAxios.get = vi.fn().mockResolvedValue({ data: {}, headers: {} })
  })

  test('getActivity parses the response losslessly and puts the exact id in the path', async () => {
    await client.getActivity('token', '9007199254740993')

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://www.strava.com/api/v3/activities/9007199254740993',
      expect.objectContaining({ transformResponse: stravaResponseTransform }),
    )
  })

  test('listActivities parses the response losslessly', async () => {
    await client.listActivities('token', {})

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://www.strava.com/api/v3/athlete/activities?per_page=200',
      expect.objectContaining({ transformResponse: stravaResponseTransform }),
    )
  })

  test('the token refresh parses the response losslessly', async () => {
    vi.mocked(getOAuthToken).mockResolvedValue({
      access_token: 'old',
      expires_at: new Date('2000-01-01T00:00:00Z'),
      provider: 'strava',
      refresh_token: 'refresh',
    } as Awaited<ReturnType<typeof getOAuthToken>>)
    mockedAxios.post = vi.fn().mockResolvedValue({
      data: { access_token: 'new', expires_at: 1_795_000_000, refresh_token: 'refresh2' },
    })

    expect(await client.getAccessToken('alice')).toBe('new')
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://www.strava.com/oauth/token',
      expect.objectContaining({ grant_type: 'refresh_token' }),
      { transformResponse: stravaResponseTransform },
    )
  })
})
