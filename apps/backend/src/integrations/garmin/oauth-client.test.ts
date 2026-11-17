import type { AxiosInstance } from 'axios'
import type { Request, Response } from 'express'

import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it, vi } from 'vitest'

import type { OAuthToken } from '../../db/types.ts'

import { openState, sealState } from '../../services/oauth-state.ts'
import {
  GARMIN_OAUTH_PROVIDER,
  GARMIN_PUSH_PROVIDER,
  garminOAuthClient,
  GarminOAuthNotConnectedError,
  GarminOAuthRefusedError,
  garminOAuthStatusFromToken,
  parseGarminPermissions,
} from './oauth-client.ts'

const NOW = new Date('2026-11-10T10:00:00Z')
const SECRET = 'fake-client-secret'
const credentials = { clientId: 'fake-client-id', clientSecret: SECRET }
const GARMIN_USER_ID = '0123456789abcdef0123456789abcdef'

const axiosFailure = (status: number, data?: unknown) => {
  const error = new AxiosError('request failed')
  error.response = { config: { headers: new AxiosHeaders() }, data, headers: {}, status, statusText: 'x' }
  return error
}

const tokenAnswer = (overrides: Record<string, unknown> = {}) => ({
  data: {
    access_token: 'fake-access-new',
    expires_in: 86400,
    jti: 'fake-jti',
    refresh_token: 'fake-refresh-new',
    refresh_token_expires_in: 7775998,
    scope: 'PARTNER_WRITE PARTNER_READ',
    token_type: 'bearer',
    ...overrides,
  },
})

const getAnswering = (answers: { userId?: () => unknown; permissions?: () => unknown }) =>
  vi.fn(async (url: string) => {
    if (url.endsWith('/user/id')) {
      return { data: answers.userId ? await answers.userId() : { userId: GARMIN_USER_ID } }
    }
    if (url.endsWith('/user/permissions')) {
      return {
        data: answers.permissions ? await answers.permissions() : ['HEALTH_EXPORT', 'ACTIVITY_EXPORT'],
      }
    }
    throw new Error(`unexpected GET ${url}`)
  }) as unknown as AxiosInstance['get']

const makeClient = (
  options: {
    configured?: boolean
    grant?: OAuthToken | null
    previousOwner?: string | null
    mappedGarminUserId?: string | null
    mappingFails?: boolean
    http?: Partial<AxiosInstance>
    now?: Date
  } = {},
) => {
  const upsertOAuthToken = vi.fn()
  const deleteOAuthToken = vi.fn(async () => true)
  const markOAuthTokenRefused = vi.fn()
  const resetSyncState = vi.fn(async () => {})
  const clock = { now: options.now ?? NOW }
  const upsertGarminUserMapping = vi.fn(async () => {
    if (options.mappingFails) throw new Error('central db down')
    return options.previousOwner ?? null
  })
  const getGarminUserIdByUsername = vi.fn(async () => options.mappedGarminUserId ?? null)
  const deleteGarminUserMappingByUsername = vi.fn(async () => true)
  const auditInfo = vi.fn(async () => {})
  const auditWarn = vi.fn(async () => {})
  const http = {
    delete: vi.fn().mockResolvedValue({ data: '' }),
    get: getAnswering({}),
    post: vi.fn().mockResolvedValue(tokenAnswer()),
    ...options.http,
  } as unknown as AxiosInstance
  const client = garminOAuthClient(
    async () => (options.configured === false ? null : credentials),
    'https://api.example.test',
    {
      auditInfo,
      auditWarn,
      deleteGarminUserMappingByUsername,
      deleteOAuthToken,
      ensureUserSchema: vi.fn(),
      getGarminUserIdByUsername,
      getOAuthToken: async () => options.grant ?? null,
      http,
      markOAuthTokenRefused,
      now: () => clock.now,
      resetSyncState,
      upsertGarminUserMapping,
      upsertOAuthToken,
    },
  )
  return {
    auditInfo,
    auditWarn,
    client,
    clock,
    deleteGarminUserMappingByUsername,
    deleteOAuthToken,
    http,
    markOAuthTokenRefused,
    resetSyncState,
    upsertGarminUserMapping,
    upsertOAuthToken,
  }
}

const callback = async (client: ReturnType<typeof makeClient>['client'], query: Record<string, string>) => {
  const redirect = vi.fn()
  await client.authCb({ query } as unknown as Request, { redirect } as unknown as Response)
  return redirect.mock.calls[0]?.[0] as string
}

const sealedFor = (user: string, secret = SECRET, iat = NOW.getTime()) =>
  sealState({ iat, user, verifier: 'fake-verifier' }, secret)

const everythingSaid = (mocks: ReturnType<typeof vi.fn>[]) =>
  JSON.stringify(mocks.flatMap((m) => m.mock.calls))

const liveGrant: OAuthToken = {
  access_token: 'fake-access-live',
  expires_at: new Date('2026-11-10T12:00:00Z'),
  provider: GARMIN_OAUTH_PROVIDER,
  refresh_token: 'fake-refresh-old',
  scopes: ['HEALTH_EXPORT'],
}

const dueGrant: OAuthToken = { ...liveGrant, expires_at: new Date('2026-11-10T10:05:00Z') }

describe('getAuthorizeUrl', () => {
  it('builds the Garmin consent URL with PKCE and a sealed state, without a scope', async () => {
    const { client } = makeClient()
    const json = vi.fn()
    await client.getAuthorizeUrl(
      { user: 'alice' } as unknown as Request,
      { json, status: vi.fn().mockReturnThis() } as unknown as Response,
    )
    const answer = json.mock.calls[0][0] as { success: boolean; url: string }
    expect(answer.success).toBe(true)
    const url = new URL(answer.url)
    expect(url.origin + url.pathname).toBe('https://connect.garmin.com/oauth2Confirm')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('fake-client-id')
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.example.test/auth/garmincb')
    expect(url.searchParams.has('scope')).toBe(false)
    expect(openState(url.searchParams.get('state')!, SECRET, NOW)?.user).toBe('alice')
  })

  it('answers 401 without a user and 400 without server credentials', async () => {
    const status = vi.fn().mockReturnThis()
    const json = vi.fn()
    await makeClient().client.getAuthorizeUrl({} as Request, { json, status } as unknown as Response)
    expect(status).toHaveBeenLastCalledWith(401)

    await makeClient({ configured: false }).client.getAuthorizeUrl(
      { user: 'alice' } as unknown as Request,
      { json, status } as unknown as Response,
    )
    expect(status).toHaveBeenLastCalledWith(400)
    expect(json).toHaveBeenLastCalledWith(expect.objectContaining({ success: false }))
  })
})

describe('authCb', () => {
  it('exchanges the code, stores the grant with the permissions and maps the Garmin user', async () => {
    const { auditInfo, client, http, upsertGarminUserMapping, upsertOAuthToken } = makeClient()
    const target = await callback(client, { code: 'fake-code', state: sealedFor('alice') })

    const [url, body] = (http.post as ReturnType<typeof vi.fn>).mock.calls[0] as [string, URLSearchParams]
    expect(url).toBe('https://connectapi.garmin.com/di-oauth2-service/oauth/token')
    expect(Object.fromEntries(body)).toEqual({
      client_id: 'fake-client-id',
      client_secret: SECRET,
      code: 'fake-code',
      code_verifier: 'fake-verifier',
      grant_type: 'authorization_code',
      redirect_uri: 'https://api.example.test/auth/garmincb',
    })
    expect(http.get).toHaveBeenCalledWith('https://apis.garmin.com/wellness-api/rest/user/id', {
      headers: { Authorization: 'Bearer fake-access-new' },
    })
    expect(upsertOAuthToken).toHaveBeenCalledWith('alice', {
      access_token: 'fake-access-new',
      expires_at: new Date('2026-11-11T10:00:00Z'),
      provider: GARMIN_OAUTH_PROVIDER,
      refresh_token: 'fake-refresh-new',
      scopes: ['HEALTH_EXPORT', 'ACTIVITY_EXPORT'],
    })
    expect(upsertGarminUserMapping).toHaveBeenCalledWith(GARMIN_USER_ID, 'alice')
    expect(auditInfo).toHaveBeenCalledWith('alice', 'auth', 'Garmin connected through OAuth', {
      permissions: ['HEALTH_EXPORT', 'ACTIVITY_EXPORT'],
    })
    expect(target).toBe('/data-sources/garmin?connected=oauth')
    expect(everythingSaid([auditInfo])).not.toContain(GARMIN_USER_ID)
  })

  it('answers auth_failed without a code or state, or with an error parameter', async () => {
    const { client, http } = makeClient()
    expect(await callback(client, { state: sealedFor('alice') })).toBe(
      '/data-sources/garmin?error=auth_failed',
    )
    expect(await callback(client, { code: 'fake-code' })).toBe('/data-sources/garmin?error=auth_failed')
    expect(
      await callback(client, { code: 'fake-code', error: 'access_denied', state: sealedFor('alice') }),
    ).toBe('/data-sources/garmin?error=auth_failed')
    expect(http.post).not.toHaveBeenCalled()
  })

  it('answers not_configured without server credentials', async () => {
    const { client } = makeClient({ configured: false })
    expect(await callback(client, { code: 'fake-code', state: sealedFor('alice') })).toBe(
      '/data-sources/garmin?error=not_configured',
    )
  })

  it('answers invalid_state for a state sealed for another secret or older than ten minutes', async () => {
    const { client, http } = makeClient()
    expect(
      await callback(client, { code: 'fake-code', state: sealedFor('alice', 'another-fake-secret') }),
    ).toBe('/data-sources/garmin?error=invalid_state')
    expect(
      await callback(client, {
        code: 'fake-code',
        state: sealedFor('alice', SECRET, NOW.getTime() - 11 * 60_000),
      }),
    ).toBe('/data-sources/garmin?error=invalid_state')
    expect(http.post).not.toHaveBeenCalled()
  })

  it('stores nothing when the exchange fails, and audits no secret', async () => {
    const post = vi
      .fn()
      .mockRejectedValue(
        axiosFailure(400, { error: 'invalid_grant', error_description: `bad code fake-code for ${SECRET}` }),
      )
    const { auditWarn, client, upsertOAuthToken } = makeClient({ http: { post } })
    expect(await callback(client, { code: 'fake-code', state: sealedFor('alice') })).toBe(
      '/data-sources/garmin?error=auth_failed',
    )
    expect(upsertOAuthToken).not.toHaveBeenCalled()
    const said = everythingSaid([auditWarn])
    expect(said).toContain('invalid_grant')
    expect(said).not.toContain(SECRET)
    expect(said).not.toContain('fake-code')
  })

  it('stores nothing when the user id call fails', async () => {
    const get = getAnswering({
      userId: () => {
        throw axiosFailure(500)
      },
    })
    const { client, upsertGarminUserMapping, upsertOAuthToken } = makeClient({ http: { get } })
    expect(await callback(client, { code: 'fake-code', state: sealedFor('alice') })).toBe(
      '/data-sources/garmin?error=auth_failed',
    )
    expect(upsertOAuthToken).not.toHaveBeenCalled()
    expect(upsertGarminUserMapping).not.toHaveBeenCalled()
  })

  it('stores nothing when Garmin answers no user id', async () => {
    const get = getAnswering({ userId: () => ({}) })
    const { client, upsertOAuthToken } = makeClient({ http: { get } })
    expect(await callback(client, { code: 'fake-code', state: sealedFor('alice') })).toBe(
      '/data-sources/garmin?error=auth_failed',
    )
    expect(upsertOAuthToken).not.toHaveBeenCalled()
  })

  it('stores the grant with no permissions when the permissions call fails', async () => {
    const get = getAnswering({
      permissions: () => {
        throw axiosFailure(503)
      },
    })
    const { client, upsertOAuthToken } = makeClient({ http: { get } })
    expect(await callback(client, { code: 'fake-code', state: sealedFor('alice') })).toBe(
      '/data-sources/garmin?connected=oauth',
    )
    expect(upsertOAuthToken).toHaveBeenCalledWith('alice', expect.objectContaining({ scopes: [] }))
  })

  it('clears the previous owner’s grant when the Garmin account moves to this user', async () => {
    const { auditWarn, client, deleteOAuthToken, http } = makeClient({ previousOwner: 'bob' })
    expect(await callback(client, { code: 'fake-code', state: sealedFor('alice') })).toBe(
      '/data-sources/garmin?connected=oauth',
    )
    expect(deleteOAuthToken).toHaveBeenCalledWith('bob', GARMIN_OAUTH_PROVIDER)
    expect(auditWarn).toHaveBeenCalledWith(
      'bob',
      'auth',
      'Garmin account connected from another Aurboda account',
    )
    expect(http.delete).not.toHaveBeenCalled()
  })

  it('removes the grant again when the mapping cannot be written', async () => {
    const { auditWarn, client, deleteOAuthToken, upsertOAuthToken } = makeClient({ mappingFails: true })
    expect(await callback(client, { code: 'fake-code', state: sealedFor('alice') })).toBe(
      '/data-sources/garmin?error=auth_failed',
    )
    expect(upsertOAuthToken).toHaveBeenCalledTimes(1)
    expect(deleteOAuthToken).toHaveBeenCalledWith('alice', GARMIN_OAUTH_PROVIDER)
    expect(auditWarn).toHaveBeenCalledWith('alice', 'auth', 'Garmin OAuth connection failed', {
      error: 'central db down',
    })
  })

  it('deregisters the Garmin account the user had connected before, with the old token', async () => {
    const { client, http, upsertOAuthToken } = makeClient({
      grant: liveGrant,
      mappedGarminUserId: 'another-garmin-user',
    })
    expect(await callback(client, { code: 'fake-code', state: sealedFor('alice') })).toBe(
      '/data-sources/garmin?connected=oauth',
    )
    expect(http.delete).toHaveBeenCalledWith('https://apis.garmin.com/wellness-api/rest/user/registration', {
      headers: { Authorization: 'Bearer fake-access-live' },
    })
    const deleteOrder = (http.delete as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    expect(deleteOrder).toBeLessThan(upsertOAuthToken.mock.invocationCallOrder[0])
  })

  it('does not deregister when the same Garmin account reconnects', async () => {
    const { client, http } = makeClient({ grant: liveGrant, mappedGarminUserId: GARMIN_USER_ID })
    await callback(client, { code: 'fake-code', state: sealedFor('alice') })
    expect(http.delete).not.toHaveBeenCalled()
  })
})

describe('parseGarminPermissions', () => {
  it('reads a bare array and a permissions object, and nothing else', () => {
    expect(parseGarminPermissions(['HEALTH_EXPORT', 'MCT_EXPORT'])).toEqual(['HEALTH_EXPORT', 'MCT_EXPORT'])
    expect(parseGarminPermissions({ permissions: ['ACTIVITY_EXPORT', 7] })).toEqual(['ACTIVITY_EXPORT'])
    expect(parseGarminPermissions({ other: [] })).toEqual([])
    expect(parseGarminPermissions('HEALTH_EXPORT')).toEqual([])
  })
})

describe('garminOAuthStatusFromToken', () => {
  it('reports connection, reconnect and permissions from the row', () => {
    expect(garminOAuthStatusFromToken(null)).toEqual({
      connected: false,
      needs_reconnect: false,
      permissions: [],
    })
    expect(
      garminOAuthStatusFromToken({
        access_token: '',
        provider: GARMIN_OAUTH_PROVIDER,
        scopes: ['HEALTH_EXPORT'],
      }),
    ).toEqual({ connected: false, needs_reconnect: false, permissions: [] })
    expect(
      garminOAuthStatusFromToken({
        access_token: 'x',
        provider: GARMIN_OAUTH_PROVIDER,
        scopes: ['HEALTH_EXPORT'],
      }),
    ).toEqual({ connected: true, needs_reconnect: false, permissions: ['HEALTH_EXPORT'] })
    expect(
      garminOAuthStatusFromToken({ access_token: 'x', provider: GARMIN_OAUTH_PROVIDER, refused_at: NOW }),
    ).toEqual({ connected: true, needs_reconnect: true, permissions: [] })
  })
})

describe('getAccessToken', () => {
  it('answers the stored token while it is valid beyond the 600 s buffer', async () => {
    const { client, http } = makeClient({ grant: liveGrant })
    await expect(client.getAccessToken('alice')).resolves.toBe('fake-access-live')
    expect(http.post).not.toHaveBeenCalled()
  })

  it('refreshes within the buffer and stores the rotated refresh token with the scopes kept', async () => {
    const { client, http, upsertOAuthToken } = makeClient({ grant: dueGrant })
    await expect(client.getAccessToken('alice')).resolves.toBe('fake-access-new')
    const body = (http.post as ReturnType<typeof vi.fn>).mock.calls[0][1] as URLSearchParams
    expect(Object.fromEntries(body)).toEqual({
      client_id: 'fake-client-id',
      client_secret: SECRET,
      grant_type: 'refresh_token',
      refresh_token: 'fake-refresh-old',
    })
    expect(upsertOAuthToken).toHaveBeenCalledWith('alice', {
      access_token: 'fake-access-new',
      expires_at: new Date('2026-11-11T10:00:00Z'),
      provider: GARMIN_OAUTH_PROVIDER,
      refresh_token: 'fake-refresh-new',
      scopes: ['HEALTH_EXPORT'],
    })
  })

  it('shares one refresh between concurrent callers', async () => {
    const { client, http } = makeClient({ grant: dueGrant })
    const [a, b] = await Promise.all([client.getAccessToken('alice'), client.getAccessToken('alice')])
    expect([a, b]).toEqual(['fake-access-new', 'fake-access-new'])
    expect(http.post).toHaveBeenCalledTimes(1)
  })

  it.each([400, 401])('marks the row refused with the token that was sent on a %i', async (status) => {
    const post = vi.fn().mockRejectedValue(axiosFailure(status, { error: 'invalid_grant' }))
    const { client, markOAuthTokenRefused, upsertOAuthToken } = makeClient({
      grant: dueGrant,
      http: { post },
    })
    await expect(client.getAccessToken('alice')).rejects.toBeInstanceOf(GarminOAuthRefusedError)
    expect(markOAuthTokenRefused).toHaveBeenCalledWith('alice', GARMIN_OAUTH_PROVIDER, 'fake-refresh-old')
    expect(upsertOAuthToken).not.toHaveBeenCalled()
  })

  it('does not mark the row when Garmin rejects the client credentials', async () => {
    const post = vi.fn().mockRejectedValue(axiosFailure(401, { error: 'invalid_client' }))
    const { client, markOAuthTokenRefused } = makeClient({ grant: dueGrant, http: { post } })
    await expect(client.getAccessToken('alice')).rejects.not.toBeInstanceOf(GarminOAuthRefusedError)
    expect(markOAuthTokenRefused).not.toHaveBeenCalled()
  })

  it('does not mark the row on a 500, and keeps secrets out of the message', async () => {
    const post = vi
      .fn()
      .mockRejectedValue(
        axiosFailure(500, { error: 'server_error', error_description: `oops ${SECRET} fake-refresh-old` }),
      )
    const { client, markOAuthTokenRefused } = makeClient({ grant: dueGrant, http: { post } })
    const error = (await client.getAccessToken('alice').catch((e: unknown) => e)) as Error
    expect(error.message).toContain('500')
    expect(error.message).not.toContain(SECRET)
    expect(error.message).not.toContain('fake-refresh-old')
    expect(markOAuthTokenRefused).not.toHaveBeenCalled()
  })

  it('does not refresh a refused row, and throws without a grant', async () => {
    const { client, http } = makeClient({ grant: { ...dueGrant, refused_at: NOW } })
    await expect(client.getAccessToken('alice')).rejects.toBeInstanceOf(GarminOAuthRefusedError)
    expect(http.post).not.toHaveBeenCalled()
    await expect(makeClient().client.getAccessToken('alice')).rejects.toBeInstanceOf(
      GarminOAuthNotConnectedError,
    )
    await expect(
      makeClient({ grant: { access_token: '', provider: GARMIN_OAUTH_PROVIDER } }).client.getAccessToken(
        'alice',
      ),
    ).rejects.toBeInstanceOf(GarminOAuthNotConnectedError)
  })
})

describe('keepFresh', () => {
  it('refreshes a due grant', async () => {
    const { client, upsertOAuthToken } = makeClient({ grant: dueGrant })
    await client.keepFresh('alice')
    expect(upsertOAuthToken).toHaveBeenCalledWith(
      'alice',
      expect.objectContaining({ access_token: 'fake-access-new' }),
    )
  })

  it('does nothing without a grant, with a refused grant, or without server credentials', async () => {
    for (const setup of [
      makeClient(),
      makeClient({ grant: { ...dueGrant, refused_at: NOW } }),
      makeClient({ configured: false, grant: dueGrant }),
    ]) {
      await expect(setup.client.keepFresh('alice')).resolves.toBeUndefined()
      expect(setup.http.post).not.toHaveBeenCalled()
      expect(setup.auditWarn).not.toHaveBeenCalled()
    }
  })

  it('never throws, and audits the failure without secrets', async () => {
    const post = vi
      .fn()
      .mockRejectedValue(axiosFailure(401, { error: 'invalid_grant', error_description: SECRET }))
    const { auditWarn, client } = makeClient({ grant: dueGrant, http: { post } })
    await expect(client.keepFresh('alice')).resolves.toBeUndefined()
    expect(auditWarn).toHaveBeenCalledWith('alice', 'auth', 'Garmin OAuth token refresh failed', {
      error: expect.any(String),
    })
    const said = everythingSaid([auditWarn])
    expect(said).not.toContain(SECRET)
    expect(said).not.toContain('fake-refresh-old')
  })

  it('leaves a user alone for an hour after a failed refresh', async () => {
    const post = vi.fn().mockRejectedValue(axiosFailure(503))
    const { auditWarn, client, clock } = makeClient({ grant: dueGrant, http: { post } })
    await client.keepFresh('alice')
    await client.keepFresh('alice')
    expect(post).toHaveBeenCalledTimes(1)
    expect(auditWarn).toHaveBeenCalledTimes(1)

    clock.now = new Date(NOW.getTime() + 61 * 60 * 1000)
    await client.keepFresh('alice')
    expect(post).toHaveBeenCalledTimes(2)
  })
})

describe('disconnect', () => {
  it('deregisters with the bearer token, then clears the row and the mapping', async () => {
    const { auditInfo, client, deleteGarminUserMappingByUsername, deleteOAuthToken, http } = makeClient({
      grant: liveGrant,
    })
    await client.disconnect('alice')
    expect(http.delete).toHaveBeenCalledWith('https://apis.garmin.com/wellness-api/rest/user/registration', {
      headers: { Authorization: 'Bearer fake-access-live' },
    })
    expect(deleteOAuthToken).toHaveBeenCalledWith('alice', GARMIN_OAUTH_PROVIDER)
    expect(deleteGarminUserMappingByUsername).toHaveBeenCalledWith('alice')
    expect(auditInfo).toHaveBeenCalledWith('alice', 'auth', 'Garmin OAuth disconnected')
  })

  it('resets the push sync states', async () => {
    const { client, resetSyncState } = makeClient({ grant: liveGrant })
    await client.disconnect('alice')
    expect(resetSyncState).toHaveBeenCalledWith('alice', GARMIN_PUSH_PROVIDER)
  })

  it('clears the row and the mapping also when the DELETE fails', async () => {
    const del = vi.fn().mockRejectedValue(axiosFailure(500))
    const { auditWarn, client, deleteGarminUserMappingByUsername, deleteOAuthToken } = makeClient({
      grant: liveGrant,
      http: { delete: del },
    })
    await client.disconnect('alice')
    expect(deleteOAuthToken).toHaveBeenCalledWith('alice', GARMIN_OAUTH_PROVIDER)
    expect(deleteGarminUserMappingByUsername).toHaveBeenCalledWith('alice')
    expect(auditWarn).toHaveBeenCalledWith('alice', 'auth', 'Garmin OAuth deregistration failed', {
      error: expect.any(String),
    })
    expect(everythingSaid([auditWarn])).not.toContain('fake-access-live')
  })

  it('does nothing without a grant', async () => {
    const { client, deleteGarminUserMappingByUsername, deleteOAuthToken, http } = makeClient()
    await client.disconnect('alice')
    expect(http.delete).not.toHaveBeenCalled()
    expect(deleteOAuthToken).not.toHaveBeenCalled()
    expect(deleteGarminUserMappingByUsername).not.toHaveBeenCalled()
  })
})

describe('forget', () => {
  it('clears the grant, the mapping and the push sync states without calling Garmin', async () => {
    const { client, deleteGarminUserMappingByUsername, deleteOAuthToken, http, resetSyncState } = makeClient({
      grant: liveGrant,
    })
    await client.forget('alice')
    expect(http.delete).not.toHaveBeenCalled()
    expect(http.post).not.toHaveBeenCalled()
    expect(deleteOAuthToken).toHaveBeenCalledWith('alice', GARMIN_OAUTH_PROVIDER)
    expect(deleteGarminUserMappingByUsername).toHaveBeenCalledWith('alice')
    expect(resetSyncState).toHaveBeenCalledWith('alice', GARMIN_PUSH_PROVIDER)
  })
})

describe('probeGrant', () => {
  it('answers the Garmin user id the live grant belongs to', async () => {
    const { client } = makeClient({ grant: liveGrant })
    await expect(client.probeGrant('alice')).resolves.toEqual({
      garminUserId: GARMIN_USER_ID,
      status: 'alive',
    })
  })

  it('answers gone without a grant', async () => {
    const { client } = makeClient()
    await expect(client.probeGrant('alice')).resolves.toEqual({ status: 'gone' })
  })

  it('answers gone when Garmin refuses the refresh token', async () => {
    const { client } = makeClient({
      grant: dueGrant,
      http: { post: vi.fn().mockRejectedValue(axiosFailure(400, { error: 'invalid_grant' })) },
    })
    await expect(client.probeGrant('alice')).resolves.toEqual({ status: 'gone' })
  })

  it.each([401, 403])('answers gone when the user id request is answered %i', async (status) => {
    const { client } = makeClient({
      grant: liveGrant,
      http: { get: vi.fn().mockRejectedValue(axiosFailure(status)) as unknown as AxiosInstance['get'] },
    })
    await expect(client.probeGrant('alice')).resolves.toEqual({ status: 'gone' })
  })

  it('answers unknown on a server error, without the token in the message', async () => {
    const { client } = makeClient({
      grant: liveGrant,
      http: { get: vi.fn().mockRejectedValue(axiosFailure(503)) as unknown as AxiosInstance['get'] },
    })
    const probe = await client.probeGrant('alice')
    expect(probe.status).toBe('unknown')
    expect(JSON.stringify(probe)).not.toContain('fake-access-live')
  })

  it('answers unknown when the refresh fails for another reason than a refused grant', async () => {
    const { client } = makeClient({
      grant: dueGrant,
      http: { post: vi.fn().mockRejectedValue(axiosFailure(401, { error: 'invalid_client' })) },
    })
    await expect(client.probeGrant('alice')).resolves.toMatchObject({ status: 'unknown' })
  })
})
