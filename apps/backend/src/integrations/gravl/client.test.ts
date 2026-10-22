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

import {
  createPkcePair,
  GravlApiError,
  gravlClient,
  isGravlAuthFailure,
  isGravlRateLimit,
  openState,
  sealState,
} from './client.ts'

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
  const http = { get: vi.fn(), post: vi.fn(), ...overrides.http } as unknown as AxiosInstance
  const client = gravlClient(
    async () => (overrides.configured === false ? null : credentials),
    'https://api.example.test',
    {
      ensureUserSchema: vi.fn(),
      getOAuthToken: async () => overrides.grant ?? null,
      getPersonalToken: async () => overrides.personal ?? null,
      http,
      now: () => NOW,
      upsertOAuthToken: upsert,
    },
  )
  return { client, http, upsert }
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

describe('PKCE state', () => {
  it('produces an S256 challenge for a fresh verifier', () => {
    const { challenge, verifier } = createPkcePair()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(challenge).not.toBe(verifier)
  })

  it('round-trips user + verifier through a sealed state', () => {
    const sealed = sealState({ iat: NOW.getTime(), user: 'alice', verifier: 'v' }, 'gcs_secret')
    expect(openState(sealed, 'gcs_secret', NOW)).toEqual({ iat: NOW.getTime(), user: 'alice', verifier: 'v' })
  })

  it('rejects a state sealed under a different secret, a tampered one, and an expired one', () => {
    const sealed = sealState({ iat: NOW.getTime(), user: 'alice', verifier: 'v' }, 'gcs_secret')
    expect(openState(sealed, 'gcs_other', NOW)).toBeNull()
    // Flip a character in the middle: every bit of it is payload, so the sealed
    // bytes always change (the trailing characters carry padding bits and can
    // decode to the same bytes — a tamper there was a 1-in-256 no-op).
    const tampered = `${sealed.slice(0, 20)}${sealed[20] === 'A' ? 'B' : 'A'}${sealed.slice(21)}`
    expect(openState(tampered, 'gcs_secret', NOW)).toBeNull()
    expect(openState(sealed, 'gcs_secret', new Date(NOW.getTime() + 11 * 60 * 1000))).toBeNull()
    expect(openState('not-a-state', 'gcs_secret', NOW)).toBeNull()
  })

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

  it('exchanges the code with the verifier from the state on callback', async () => {
    const post = vi.fn().mockResolvedValue({
      data: { access_token: 'gat_1', expires_in: 21600, refresh_token: 'grt_1', scope: 'workouts:read' },
    })
    const { client, upsert } = makeClient({ http: { post } })
    const state = sealState({ iat: NOW.getTime(), user: 'alice', verifier: 'the-verifier' }, 'gcs_secret')
    const redirect = vi.fn()
    await client.authCb(
      { query: { code: 'gac_1', state } } as unknown as Request,
      { redirect } as unknown as Response,
    )
    const body = post.mock.calls[0][1] as URLSearchParams
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('gac_1')
    expect(body.get('code_verifier')).toBe('the-verifier')
    expect(body.get('redirect_uri')).toBe('https://api.example.test/auth/gravlcb')
    expect(upsert).toHaveBeenCalledWith(
      'alice',
      expect.objectContaining({ access_token: 'gat_1', provider: 'gravl' }),
    )
    expect(redirect).toHaveBeenCalledWith('/data-sources/gravl?connected=true')
  })

  it('bounces an invalid state without touching the token endpoint', async () => {
    const { client, http } = makeClient({})
    const redirect = vi.fn()
    await client.authCb(
      { query: { code: 'gac_1', state: 'garbage' } } as unknown as Request,
      { redirect } as unknown as Response,
    )
    expect(http.post).not.toHaveBeenCalled()
    expect(redirect).toHaveBeenCalledWith('/data-sources/gravl?error=invalid_state')
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
