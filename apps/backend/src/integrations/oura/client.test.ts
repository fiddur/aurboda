import type { Request, Response } from 'express'

import axios from 'axios'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import {
  deleteOAuthToken,
  getOAuthToken,
  initializeSchema,
  schemaInitialized,
  upsertOAuthToken,
} from '../../db/index.ts'
import {
  SIGNED_STATE_MAX_AGE_MS,
  signOAuthState,
  verifyOAuthState,
} from '../../services/signed-oauth-state.ts'
import { ouraClient } from './client.ts'

vi.mock('axios')
vi.mock('../../db/index.ts', () => ({
  deleteOAuthToken: vi.fn(),
  getOAuthToken: vi.fn(),
  initializeSchema: vi.fn(),
  schemaInitialized: vi.fn(),
  upsertOAuthToken: vi.fn(),
}))

const mockedAxios = vi.mocked(axios)

const client = ouraClient(
  async () => ({ clientId: 'client-id', clientSecret: 'client-secret' }),
  'https://example.com/api',
)

describe('ouraClient.disconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockedAxios.post = vi.fn().mockResolvedValue({ data: {} })
    vi.mocked(deleteOAuthToken).mockResolvedValue(true)
  })

  test('revokes the access token at Oura and deletes the stored grant', async () => {
    vi.mocked(getOAuthToken).mockResolvedValue({ access_token: 'live-token', provider: 'oura' })

    await client.disconnect('alice')

    expect(mockedAxios.post).toHaveBeenCalledWith('https://api.ouraring.com/oauth/revoke', undefined, {
      params: { access_token: 'live-token' },
    })
    expect(deleteOAuthToken).toHaveBeenCalledWith('alice', 'oura')
  })

  test('still deletes the stored grant when the revoke fails', async () => {
    vi.mocked(getOAuthToken).mockResolvedValue({ access_token: 'dead-token', provider: 'oura' })
    mockedAxios.post = vi
      .fn()
      .mockRejectedValue(new Error('403 from https://api.ouraring.com/oauth/revoke?access_token=dead-token'))

    await expect(client.disconnect('alice')).resolves.toBeUndefined()

    expect(deleteOAuthToken).toHaveBeenCalledWith('alice', 'oura')
    expect(console.warn).toHaveBeenCalledWith(
      expect.not.stringContaining('dead-token'),
      expect.not.stringContaining('dead-token'),
    )
  })

  test('does nothing when the user has no Oura grant', async () => {
    vi.mocked(getOAuthToken).mockResolvedValue(null)

    await expect(client.disconnect('alice')).resolves.toBeUndefined()

    expect(mockedAxios.post).not.toHaveBeenCalled()
    expect(deleteOAuthToken).not.toHaveBeenCalled()
  })
})

describe('ouraClient.getTags', () => {
  const ouraTag = (overrides: {
    custom_name?: string | null
    id: string
    tag_type_code?: string | null
  }) => ({
    comment: null,
    custom_name: null,
    end_time: '2026-01-02T10:00:00+00:00',
    start_time: '2026-01-02T09:00:00+00:00',
    tag_type_code: null,
    ...overrides,
  })

  const getTags = async (tags: ReturnType<typeof ouraTag>[], mappings?: Record<string, string>) => {
    mockedAxios.get = vi.fn().mockResolvedValue({ data: { data: tags } })
    return client.getTags(
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-01-03T00:00:00Z'),
      'token',
      mappings,
    )
  }

  test('names the tag by mapping, custom name, code or unknown, and marks only a bare code', async () => {
    const tags = await getTags(
      [
        ouraTag({ id: 'mapped', tag_type_code: 'tag_generic_beer' }),
        ouraTag({ custom_name: 'Late dinner', id: 'custom', tag_type_code: 'tag_sleep_latemeal' }),
        ouraTag({ id: 'bare', tag_type_code: 'tag_sleep_sauna' }),
        ouraTag({ id: 'neither' }),
      ],
      { tag_generic_beer: 'Beer' },
    )

    const byId = Object.fromEntries(tags.map((tag) => [tag.external_id, tag]))
    expect(byId.mapped).toMatchObject({ tag: 'Beer', tag_key: 'tag_generic_beer' })
    expect(byId.mapped).not.toHaveProperty('tag_from_code')
    expect(byId.custom).toMatchObject({ tag: 'Late dinner', tag_key: 'tag_sleep_latemeal' })
    expect(byId.custom).not.toHaveProperty('tag_from_code')
    expect(byId.bare).toMatchObject({
      tag: 'tag_sleep_sauna',
      tag_from_code: true,
      tag_key: 'tag_sleep_sauna',
    })
    expect(byId.neither).toMatchObject({ tag: 'unknown' })
    expect(byId.neither).not.toHaveProperty('tag_from_code')
  })
})

describe('ouraClient OAuth state', () => {
  const now = new Date('2026-11-17T12:00:00Z')
  const onUserAuthenticated = vi.fn()
  const auditWarn = vi.fn()
  const authClient = ouraClient(
    async () => ({ clientId: 'client-id', clientSecret: 'client-secret' }),
    'https://example.com/api',
    { auditWarn, now: () => now, onUserAuthenticated },
  )
  const unconfigured = ouraClient(
    async () => {
      throw new Error('Oura not configured')
    },
    'https://example.com/api',
    { auditWarn, now: () => now, onUserAuthenticated },
  )

  const fakeRes = () => {
    const res = {
      end: vi.fn(),
      json: vi.fn(),
      redirect: vi.fn(),
      status: vi.fn(),
      statusCode: 200,
    }
    res.status.mockReturnValue(res)
    res.json.mockReturnValue(res)
    return res
  }

  const callback = async (query: Record<string, unknown>, target = authClient) => {
    const res = fakeRes()
    await target.authCb({ query } as unknown as Request, res as unknown as Response)
    return res.redirect.mock.calls[0]?.[0] as string
  }

  const stateFor = (user: string, at = now) => signOAuthState({ provider: 'oura', user }, 'client-secret', at)

  const expectNothingTouched = () => {
    expect(schemaInitialized).not.toHaveBeenCalled()
    expect(initializeSchema).not.toHaveBeenCalled()
    expect(mockedAxios.post).not.toHaveBeenCalled()
    expect(mockedAxios.get).not.toHaveBeenCalled()
    expect(upsertOAuthToken).not.toHaveBeenCalled()
    expect(onUserAuthenticated).not.toHaveBeenCalled()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockedAxios.post = vi.fn().mockResolvedValue({
      data: { access_token: 'access', expires_in: 3600, refresh_token: 'refresh', scope: 'daily heartrate' },
    })
    mockedAxios.get = vi.fn().mockResolvedValue({ data: { id: 'oura-user-1' } })
  })

  test('getAuthorizeUrl sends a state that verifies to the requesting user', async () => {
    const res = fakeRes()
    await authClient.getAuthorizeUrl({ user: 'alice' } as unknown as Request, res as unknown as Response)

    const { url } = res.json.mock.calls[0][0] as { url: string }
    const state = new URL(url).searchParams.get('state') ?? ''
    expect(verifyOAuthState(state, { provider: 'oura' }, 'client-secret', now)).toBe('alice')
  })

  test('getAuthorizeUrl answers 401 without a user', async () => {
    const res = fakeRes()
    await authClient.getAuthorizeUrl({} as unknown as Request, res as unknown as Response)

    expect(res.status).toHaveBeenCalledWith(401)
  })

  test('authCb hands the code and state to the page, with no token request and no write', async () => {
    const state = stateFor('alice')
    const target = new URL(await callback({ code: 'the-code', state }), 'https://web.example.test')

    expect(target.pathname).toBe('/data-sources/oura')
    expect(target.searchParams.get('oura_code')).toBe('the-code')
    expect(target.searchParams.get('oura_state')).toBe(state)
    expectNothingTouched()
  })

  test.each([
    ['a bare username', 'alice'],
    ['another secret', signOAuthState({ provider: 'oura', user: 'alice' }, 'other-secret', now)],
    ['an expired state', stateFor('alice', new Date(now.getTime() - SIGNED_STATE_MAX_AGE_MS - 1))],
    ['a Strava state', signOAuthState({ provider: 'strava', user: 'alice' }, 'client-secret', now)],
  ])('authCb rejects %s as invalid_state and touches nothing', async (_, state) => {
    expect(await callback({ code: 'the-code', state })).toBe('/data-sources/oura?error=invalid_state')
    expectNothingTouched()
  })

  test.each([
    ['a missing code', { state: stateFor('alice') }],
    ['a missing state', { code: 'the-code' }],
    ['a repeated code', { code: ['the-code', 'other'], state: stateFor('alice') }],
    ['a repeated state', { code: 'the-code', state: [stateFor('alice'), stateFor('alice')] }],
    ['an error parameter', { error: 'access_denied' }],
  ])('authCb rejects %s as auth_failed and touches nothing', async (_, query) => {
    expect(await callback(query)).toBe('/data-sources/oura?error=auth_failed')
    expectNothingTouched()
  })

  test('authCb answers not_configured without server credentials', async () => {
    expect(await callback({ code: 'the-code', state: stateFor('alice') }, unconfigured)).toBe(
      '/data-sources/oura?error=not_configured',
    )
  })

  test('complete refuses a sign-in started by another account before any request', async () => {
    expect(await authClient.complete('alice', 'the-code', stateFor('bob'))).toEqual({
      ok: false,
      reason: 'wrong_user',
    })
    expectNothingTouched()
    expect(auditWarn.mock.calls).toEqual([
      ['alice', 'auth', 'Oura sign-in started by another account was refused'],
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

  test('complete stores the token and the Oura user mapping for the signed-in user', async () => {
    vi.mocked(schemaInitialized).mockResolvedValue(false)

    expect(await authClient.complete('alice', 'the-code', stateFor('alice'))).toEqual({ ok: true })

    expect(initializeSchema).toHaveBeenCalledWith('alice')
    expect(mockedAxios.post).toHaveBeenCalledTimes(1)
    const tokenUrl = new URL(vi.mocked(mockedAxios.post).mock.calls[0][0] as string)
    expect(tokenUrl.origin + tokenUrl.pathname).toBe('https://cloud.ouraring.com/oauth/token')
    expect(tokenUrl.searchParams.get('code')).toBe('the-code')
    expect(tokenUrl.searchParams.get('redirect_uri')).toBe('https://example.com/api/auth/ouracb')
    expect(upsertOAuthToken).toHaveBeenCalledWith('alice', {
      access_token: 'access',
      expires_at: new Date('2026-11-17T13:00:00Z'),
      provider: 'oura',
      refresh_token: 'refresh',
      scopes: ['daily', 'heartrate'],
    })
    expect(onUserAuthenticated).toHaveBeenCalledWith('oura-user-1', 'alice')
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
    expect(auditWarn).toHaveBeenCalledWith('alice', 'auth', 'Oura OAuth connection failed', expect.anything())
    const audited = JSON.stringify(auditWarn.mock.calls)
    expect(audited).not.toContain('the-code')
    expect(audited).not.toContain('client-secret')
  })
})
