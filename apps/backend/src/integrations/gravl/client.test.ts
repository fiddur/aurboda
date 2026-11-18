/**
 * Gravl client tests: credential resolution order, token refresh, PKCE state
 * sealing, and error mapping. HTTP and DB are injected through the deps
 * overrides, so nothing here touches the network or Postgres.
 */

import type { AxiosInstance } from 'axios'
import type { Request, Response } from 'express'

import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it, vi } from 'vitest'

import type { OAuthToken } from '../../db/types.ts'

vi.mock('../../db/index.ts', () => ({
  getOAuthToken: vi.fn(),
  initializeSchema: vi.fn(),
  schemaInitialized: vi.fn(),
  upsertOAuthToken: vi.fn(),
}))
vi.mock('../../services/settings.ts', () => ({ getSettings: vi.fn() }))

import { openState, sealState } from '../../services/oauth-state.ts'
import { GravlApiError, gravlClient, isGravlAuthFailure, isGravlRateLimit } from './client.ts'

const NOW = new Date('2026-09-03T10:00:00Z')
const credentials = { clientId: 'gci_test', clientSecret: 'gcs_secret' }

const axiosFailure = (status: number, data?: unknown, headers: Record<string, string> = {}) => {
  const error = new AxiosError('request failed')
  error.response = {
    config: { headers: new AxiosHeaders() },
    data,
    headers,
    status,
    statusText: 'x',
  }
  return error
}

const makeClient = (overrides: {
  configured?: boolean
  grant?: OAuthToken | null
  personal?: string | null
  http?: Partial<AxiosInstance>
}) => {
  const upsert = vi.fn()
  const auditWarn = vi.fn()
  const ensureUserSchema = vi.fn()
  const http = { get: vi.fn(), post: vi.fn(), ...overrides.http } as unknown as AxiosInstance
  const client = gravlClient(
    async () => (overrides.configured === false ? null : credentials),
    'https://api.example.test',
    {
      auditWarn,
      ensureUserSchema,
      getOAuthToken: async () => overrides.grant ?? null,
      getPersonalToken: async () => overrides.personal ?? null,
      http,
      now: () => NOW,
      upsertOAuthToken: upsert,
    },
  )
  return { auditWarn, client, ensureUserSchema, http, upsert }
}

const sealedFor = (user: string, iat = NOW.getTime()) =>
  sealState({ iat, user, verifier: 'the-verifier' }, 'gcs_secret')

const callback = async (client: ReturnType<typeof makeClient>['client'], query: Record<string, unknown>) => {
  const redirect = vi.fn()
  await client.authCb({ query } as unknown as Request, { redirect } as unknown as Response)
  return redirect.mock.calls[0]?.[0] as string
}

describe('getAccessToken', () => {
  it('prefers a live OAuth grant over a personal token', async () => {
    const { client, http } = makeClient({
      grant: { access_token: 'gat_live', expires_at: new Date('2026-09-03T15:00:00Z'), provider: 'gravl' },
      personal: 'gat_personal',
    })
    await expect(client.getAccessToken('alice')).resolves.toBe('gat_live')
    expect(http.post).not.toHaveBeenCalled()
  })

  it('refreshes a grant that is about to expire and stores the rotated refresh token', async () => {
    const post = vi.fn().mockResolvedValue({
      data: {
        access_token: 'gat_new',
        expires_in: 21600,
        refresh_token: 'grt_new',
        scope: 'workouts:read profile:read',
        token_type: 'Bearer',
      },
    })
    const { client, upsert } = makeClient({
      grant: {
        access_token: 'gat_old',
        expires_at: new Date('2026-09-03T10:01:00Z'),
        provider: 'gravl',
        refresh_token: 'grt_old',
      },
      http: { post },
    })

    await expect(client.getAccessToken('alice')).resolves.toBe('gat_new')

    const body = post.mock.calls[0][1] as URLSearchParams
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('grt_old')
    expect(body.get('client_secret')).toBe('gcs_secret')
    expect(upsert).toHaveBeenCalledWith('alice', {
      access_token: 'gat_new',
      expires_at: new Date('2026-09-03T16:00:00Z'),
      provider: 'gravl',
      refresh_token: 'grt_new',
      scopes: ['workouts:read', 'profile:read'],
    })
  })

  it('falls back to the personal token when the grant row was cleared by a disconnect', async () => {
    const { client } = makeClient({
      grant: { access_token: '', provider: 'gravl' },
      personal: 'gat_personal',
    })
    await expect(client.getAccessToken('alice')).resolves.toBe('gat_personal')
  })

  it('throws when neither a grant nor a personal token exists', async () => {
    const { client } = makeClient({})
    await expect(client.getAccessToken('alice')).rejects.toThrow(/not connected/)
  })

  it('reports the connection kind the same way it resolves tokens', async () => {
    const { client: both } = makeClient({
      grant: { access_token: 'gat', provider: 'gravl' },
      personal: 'gat_personal',
    })
    await expect(both.connectionKind('alice')).resolves.toBe('oauth')
    const { client: tokenOnly } = makeClient({ personal: 'gat_personal' })
    await expect(tokenOnly.connectionKind('alice')).resolves.toBe('token')
    const { client: none } = makeClient({})
    await expect(none.connectionKind('alice')).resolves.toBeNull()
  })
})

describe('OAuth round trip', () => {
  it('builds an authorize URL carrying PKCE, scopes and the sealed state', async () => {
    const { client } = makeClient({})
    const json = vi.fn()
    await client.getAuthorizeUrl(
      { user: 'alice' } as unknown as Request,
      { json, status: vi.fn().mockReturnThis() } as unknown as Response,
    )
    const url = new URL((json.mock.calls[0][0] as { url: string }).url)
    expect(url.origin + url.pathname).toBe('https://api.gravl.ai/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe('gci_test')
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.example.test/auth/gravlcb')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('scope')).toContain('workouts:read')
    const state = openState(url.searchParams.get('state')!, 'gcs_secret', NOW)
    expect(state?.user).toBe('alice')
  })

  it('refuses to start OAuth when the server has no Gravl credentials', async () => {
    const { client } = makeClient({ configured: false })
    const status = vi.fn().mockReturnThis()
    const json = vi.fn()
    await client.getAuthorizeUrl(
      { user: 'alice' } as unknown as Request,
      { json, status } as unknown as Response,
    )
    expect(status).toHaveBeenCalledWith(400)
    expect(json.mock.calls[0][0]).toMatchObject({ success: false })
  })

  it('hands the code and state to the page on callback, with no token request and no write', async () => {
    const { client, ensureUserSchema, http, upsert } = makeClient({})
    const state = sealedFor('alice')
    const target = new URL(await callback(client, { code: 'gac_1', state }), 'https://web.example.test')
    expect(target.pathname).toBe('/data-sources/gravl')
    expect(target.searchParams.get('gravl_code')).toBe('gac_1')
    expect(target.searchParams.get('gravl_state')).toBe(state)
    expect(http.post).not.toHaveBeenCalled()
    expect(ensureUserSchema).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })

  it('bounces an invalid or expired state without touching the token endpoint', async () => {
    const { client, http } = makeClient({})
    expect(await callback(client, { code: 'gac_1', state: 'garbage' })).toBe(
      '/data-sources/gravl?error=invalid_state',
    )
    expect(
      await callback(client, { code: 'gac_1', state: sealedFor('alice', NOW.getTime() - 11 * 60_000) }),
    ).toBe('/data-sources/gravl?error=invalid_state')
    expect(http.post).not.toHaveBeenCalled()
  })

  it('answers auth_failed for a repeated code or state, and not_configured without credentials', async () => {
    const { client, http } = makeClient({})
    const state = sealedFor('alice')
    expect(await callback(client, { code: ['gac_1', 'gac_2'], state })).toBe(
      '/data-sources/gravl?error=auth_failed',
    )
    expect(await callback(client, { code: 'gac_1', state: [state, state] })).toBe(
      '/data-sources/gravl?error=auth_failed',
    )
    expect(http.post).not.toHaveBeenCalled()
    const { client: unconfigured } = makeClient({ configured: false })
    expect(await callback(unconfigured, { code: 'gac_1', state })).toBe(
      '/data-sources/gravl?error=not_configured',
    )
  })
})

describe('complete', () => {
  it('exchanges the code with the verifier from the state and stores the grant', async () => {
    const post = vi.fn().mockResolvedValue({
      data: { access_token: 'gat_1', expires_in: 21600, refresh_token: 'grt_1', scope: 'workouts:read' },
    })
    const { client, ensureUserSchema, upsert } = makeClient({ http: { post } })
    expect(await client.complete('alice', 'gac_1', sealedFor('alice'))).toEqual({ ok: true })
    const body = post.mock.calls[0][1] as URLSearchParams
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('gac_1')
    expect(body.get('code_verifier')).toBe('the-verifier')
    expect(body.get('redirect_uri')).toBe('https://api.example.test/auth/gravlcb')
    expect(ensureUserSchema).toHaveBeenCalledWith('alice')
    expect(upsert).toHaveBeenCalledWith('alice', {
      access_token: 'gat_1',
      expires_at: new Date('2026-09-03T16:00:00Z'),
      provider: 'gravl',
      refresh_token: 'grt_1',
      scopes: ['workouts:read'],
    })
  })

  it('refuses a sign-in started by another account before any request', async () => {
    const { auditWarn, client, ensureUserSchema, http, upsert } = makeClient({})
    expect(await client.complete('alice', 'gac_1', sealedFor('bob'))).toEqual({
      ok: false,
      reason: 'wrong_user',
    })
    expect(http.post).not.toHaveBeenCalled()
    expect(ensureUserSchema).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
    expect(auditWarn.mock.calls).toEqual([
      ['alice', 'auth', 'Gravl sign-in started by another account was refused'],
    ])
  })

  it('answers invalid_state for an expired or tampered state, and not_configured without credentials', async () => {
    const { client, http } = makeClient({})
    expect(await client.complete('alice', 'gac_1', sealedFor('alice', NOW.getTime() - 11 * 60_000))).toEqual({
      ok: false,
      reason: 'invalid_state',
    })
    expect(await client.complete('alice', 'gac_1', 'garbage')).toEqual({ ok: false, reason: 'invalid_state' })
    expect(http.post).not.toHaveBeenCalled()
    const { client: unconfigured } = makeClient({ configured: false })
    expect(await unconfigured.complete('alice', 'gac_1', sealedFor('alice'))).toEqual({
      ok: false,
      reason: 'not_configured',
    })
  })

  it('answers auth_failed when the exchange fails, storing nothing and auditing no secret', async () => {
    const post = vi.fn().mockRejectedValue(axiosFailure(400, { title: 'invalid_grant', detail: 'gac_1' }))
    const { auditWarn, client, upsert } = makeClient({ http: { post } })
    expect(await client.complete('alice', 'gac_1', sealedFor('alice'))).toEqual({
      ok: false,
      reason: 'auth_failed',
    })
    expect(upsert).not.toHaveBeenCalled()
    expect(auditWarn).toHaveBeenCalledWith(
      'alice',
      'auth',
      'Gravl OAuth connection failed',
      expect.anything(),
    )
    const audited = JSON.stringify(auditWarn.mock.calls)
    expect(audited).not.toContain('gac_1')
    expect(audited).not.toContain('gcs_secret')
  })
})

describe('API calls', () => {
  it('sends pagination and date filters with Gravl’s parameter names and caps the page size', async () => {
    const get = vi.fn().mockResolvedValue({ data: { items: [], totalPages: 0 } })
    const { client } = makeClient({ http: { get } })
    await client.listWorkouts('gat', {
      endDate: new Date('2026-09-03T00:00:00Z'),
      page: 2,
      pageSize: 500,
      startDate: new Date('2026-08-01T00:00:00Z'),
    })
    expect(get).toHaveBeenCalledWith('https://api.gravl.ai/api/v1/workouts', {
      headers: { Authorization: 'Bearer gat' },
      params: {
        EndDate: '2026-09-03T00:00:00.000Z',
        Page: '2',
        PageSize: '100',
        StartDate: '2026-08-01T00:00:00.000Z',
      },
    })
  })

  it('maps problem+json failures to GravlApiError with the Retry-After', async () => {
    const get = vi
      .fn()
      .mockRejectedValueOnce(
        axiosFailure(429, { detail: 'slow down', title: 'Rate limited' }, { 'retry-after': '90' }),
      )
      .mockRejectedValueOnce(axiosFailure(401, { title: 'Unauthorized' }))
    const { client } = makeClient({ http: { get } })

    const throttled = await client.getWorkout('gat', 'w1').catch((e: unknown) => e)
    expect(throttled).toBeInstanceOf(GravlApiError)
    expect(isGravlRateLimit(throttled)).toBe(true)
    expect((throttled as GravlApiError).retryAfterSeconds).toBe(90)
    expect((throttled as GravlApiError).message).toContain('Rate limited: slow down')

    const unauthorized = await client.getWorkout('gat', 'w1').catch((e: unknown) => e)
    expect(isGravlAuthFailure(unauthorized)).toBe(true)
  })

  it('revokes the refresh token on disconnect and clears the local grant even if revocation fails', async () => {
    const post = vi.fn().mockRejectedValue(new Error('network'))
    const { client, upsert } = makeClient({
      grant: { access_token: 'gat', provider: 'gravl', refresh_token: 'grt' },
      http: { post },
    })
    await client.disconnect('alice')
    expect((post.mock.calls[0][1] as URLSearchParams).get('token')).toBe('grt')
    expect(upsert).toHaveBeenCalledWith('alice', { access_token: '', provider: 'gravl' })
  })
})
