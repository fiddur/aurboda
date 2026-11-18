/**
 * "Connect with Garmin": the Garmin Connect Developer Program's OAuth 2.0
 * authorization-code + PKCE flow. Unlike the login session and the Personal
 * API key, this connection cannot pull: Garmin pushes data to the server, keyed
 * by the Garmin user id, so completing the sign-in maps that id to the Aurboda user.
 *
 * Access tokens live 24 h and refresh tokens about three months, rotating on
 * every refresh. `keepFresh` runs from the scheduler so a user whose data only
 * arrives by push does not let the refresh token lapse.
 */

import type { OAuthConnectUrlResponse } from '@aurboda/api-spec'
import type { Request, Response } from 'express'

import axios, { type AxiosInstance, isAxiosError } from 'axios'
import { addSeconds, isAfter } from 'date-fns'

import type { OAuthToken } from '../../db/types.ts'

import {
  deleteOAuthToken,
  getOAuthToken,
  initializeSchema,
  markOAuthTokenRefused,
  resetSyncState,
  schemaInitialized,
  updateOAuthTokenScopes,
  upsertOAuthToken,
} from '../../db/index.ts'
import { auditInfo, auditWarn } from '../../services/audit-log.ts'
import { handOverOAuthCallback, type OAuthCompletion } from '../../services/oauth-completion.ts'
import { createPkcePair, openState, sealState } from '../../services/oauth-state.ts'
import { redactSecret } from './client.ts'
import {
  GARMIN_OAUTH_PROVIDER,
  GARMIN_PUSH_PROVIDER,
  isGarminOAuthConnected as isConnected,
} from './oauth-status.ts'

export { GARMIN_OAUTH_PROVIDER, GARMIN_PUSH_PROVIDER, garminOAuthStatusFromToken } from './oauth-status.ts'

const GARMIN_AUTH_URL = 'https://connect.garmin.com/oauth2Confirm'
const GARMIN_TOKEN_URL = 'https://connectapi.garmin.com/di-oauth2-service/oauth/token'
const GARMIN_WELLNESS_API = 'https://apis.garmin.com/wellness-api/rest'
const USER_ID_URL = `${GARMIN_WELLNESS_API}/user/id`
const PERMISSIONS_URL = `${GARMIN_WELLNESS_API}/user/permissions`
const REGISTRATION_URL = `${GARMIN_WELLNESS_API}/user/registration`

/** Garmin's recommendation: treat a token as expired 600 s before `expires_in` says. */
const TOKEN_EXPIRY_BUFFER_SECONDS = 600

/** How long `keepFresh` leaves a user alone after a failed refresh, so a lasting fault is not audited on every tick. */
const KEEP_FRESH_RETRY_SECONDS = 3600

/**
 * What a check of the stored grant found: `alive` with the Garmin user id it answers for, `gone`
 * when there is no grant or Garmin refuses it, `unknown` when Garmin could not be asked.
 */
export type GarminGrantProbe =
  | { status: 'alive'; garminUserId: string }
  | { status: 'gone' }
  | { status: 'unknown'; error: string }

export interface GarminOAuthCredentials {
  clientId: string
  clientSecret: string
}

/** Resolves the admin-configured Developer Program app, or `null` when the server has none. */
export type GarminOAuthCredentialGetter = () => Promise<GarminOAuthCredentials | null>

export interface GarminOAuthClientDeps {
  getOAuthToken: (user: string, provider: string) => Promise<OAuthToken | null>
  upsertOAuthToken: (user: string, token: OAuthToken) => Promise<void>
  deleteOAuthToken: (user: string, provider: string) => Promise<unknown>
  markOAuthTokenRefused: (user: string, provider: string, refreshToken?: string) => Promise<void>
  resetSyncState: (user: string, provider: string) => Promise<void>
  updateOAuthTokenScopes: (user: string, provider: string, scopes: string[]) => Promise<unknown>
  ensureUserSchema: (user: string) => Promise<void>
  upsertGarminUserMapping: (garminUserId: string, username: string) => Promise<string | null>
  getGarminUserIdByUsername: (username: string) => Promise<string | null>
  deleteGarminUserMappingByUsername: (username: string) => Promise<boolean>
  auditInfo: typeof auditInfo
  auditWarn: typeof auditWarn
  http: AxiosInstance
  now: () => Date
}

interface GarminTokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  refresh_token_expires_in?: number
  scope?: string
  token_type?: string
}

/** A non-2xx answer from Garmin. The message holds the status and Garmin's error fields, never a credential. */
export class GarminOAuthApiError extends Error {
  readonly status: number
  /** Garmin's OAuth `error` field, when the answer carried one. */
  readonly code: string | undefined

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'GarminOAuthApiError'
    this.status = status
    this.code = code
  }
}

/** Garmin refused to renew the grant: the user has to connect again. */
export class GarminOAuthRefusedError extends Error {
  constructor() {
    super('Garmin refused to renew the connection; connect with Garmin again')
    this.name = 'GarminOAuthRefusedError'
  }
}

export class GarminOAuthNotConnectedError extends Error {
  constructor() {
    super('Garmin is not connected through Connect with Garmin')
    this.name = 'GarminOAuthNotConnectedError'
  }
}

export const redactAll = (message: string, secrets: (string | undefined)[]): string =>
  secrets.reduce<string>((acc, secret) => (secret ? redactSecret(acc, secret) : acc), message)

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const toGarminOAuthError = (error: unknown, what: string, secrets: (string | undefined)[]): Error => {
  if (isAxiosError(error) && error.response) {
    const data = (error.response.data ?? {}) as { error?: unknown; error_description?: unknown }
    const detail = [data.error, data.error_description]
      .filter((part): part is string => typeof part === 'string' && part !== '')
      .join(': ')
    return new GarminOAuthApiError(
      redactAll(`Garmin ${what} ${error.response.status}${detail ? ` — ${detail}` : ''}`, secrets),
      error.response.status,
      typeof data.error === 'string' ? data.error : undefined,
    )
  }
  return new Error(
    redactAll(
      `Garmin ${what} failed: ${isAxiosError(error) ? (error.code ?? 'no answer') : errorText(error)}`,
      secrets,
    ),
  )
}

const PERMISSION_TOKEN = /"([A-Z][A-Z0-9_]*)"/g

const parseJson = (text: string): { ok: true; value: unknown } | { ok: false } => {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

/** The list the answer holds, or null when it holds none: a bare array, `{ "permissions": [...] }`, or either as text. */
const permissionList = (data: unknown): unknown[] | null => {
  if (Array.isArray(data)) return data
  if (typeof data === 'string') {
    const parsed = parseJson(data)
    if (parsed.ok) return typeof parsed.value === 'string' ? null : permissionList(parsed.value)
    const tokens = [...data.matchAll(PERMISSION_TOKEN)].map((match) => match[1])
    return tokens.length > 0 ? tokens : null
  }
  if (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { permissions?: unknown }).permissions)
  ) {
    return (data as { permissions: unknown[] }).permissions
  }
  return null
}

/**
 * Reads a bare JSON array, `{ "permissions": [...] }`, and either as a string body. Garmin's documented
 * example, `{["ACTIVITY_EXPORT", ...]}`, is not JSON, so a string that does not parse yields its quoted names.
 */
export const parseGarminPermissions = (data: unknown): string[] =>
  (permissionList(data) ?? []).filter((permission): permission is string => typeof permission === 'string')

/** The JSON type of an answer and, for an object, its top-level key names: never a value. */
export const garminAnswerShape = (data: unknown): string => {
  if (data === null) return 'null'
  if (Array.isArray(data)) return 'array'
  if (typeof data === 'object') return `object (${Object.keys(data).join(', ')})`
  return typeof data
}

/** Whether a permissions answer was understood: a list whose entries are permission names, or an empty one. */
const permissionsUnderstood = (data: unknown): boolean => {
  const list = permissionList(data)
  return list !== null && (list.length === 0 || parseGarminPermissions(data).length > 0)
}

/** The OAuth callback URL — also the redirect URI the admin registers with Garmin. */
export const garminOAuthRedirectUri = (apiBaseUrl: string): string => `${apiBaseUrl}/auth/garmincb`

type MappingDeps =
  | 'upsertGarminUserMapping'
  | 'getGarminUserIdByUsername'
  | 'deleteGarminUserMappingByUsername'

const defaultDeps = (): Omit<GarminOAuthClientDeps, MappingDeps> => ({
  auditInfo,
  auditWarn,
  deleteOAuthToken,
  ensureUserSchema: async (user) => {
    if (!(await schemaInitialized(user))) await initializeSchema(user)
  },
  getOAuthToken,
  http: axios.create({ headers: { Accept: 'application/json' } }),
  markOAuthTokenRefused,
  now: () => new Date(),
  resetSyncState: (user, provider) => resetSyncState(user, provider),
  updateOAuthTokenScopes,
  upsertOAuthToken,
})

export const garminOAuthClient = (
  getCredentials: GarminOAuthCredentialGetter,
  apiBaseUrl: string,
  overrides: Pick<GarminOAuthClientDeps, MappingDeps> & Partial<GarminOAuthClientDeps>,
) => {
  const deps: GarminOAuthClientDeps = { ...defaultDeps(), ...overrides }
  const redirectUri = garminOAuthRedirectUri(apiBaseUrl)
  /** Refresh tokens rotate: concurrent callers on this instance share one in-flight refresh per user. */
  const refreshing = new Map<string, Promise<string>>()
  const keepFreshRetryAt = new Map<string, Date>()
  const permissionsRetryAt = new Map<string, Date>()

  const tokenRequest = async (
    form: Record<string, string>,
    secrets: (string | undefined)[],
  ): Promise<GarminTokenResponse> => {
    try {
      const response = await deps.http.post<GarminTokenResponse>(
        GARMIN_TOKEN_URL,
        new URLSearchParams(form),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        },
      )
      return response.data
    } catch (error) {
      throw toGarminOAuthError(error, 'token request', secrets)
    }
  }

  const apiGet = async (url: string, accessToken: string, what: string): Promise<unknown> => {
    try {
      const response = await deps.http.get<unknown>(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      return response.data
    } catch (error) {
      throw toGarminOAuthError(error, what, [accessToken])
    }
  }

  const fetchUserId = async (accessToken: string): Promise<string> => {
    const data = await apiGet(USER_ID_URL, accessToken, 'user id request')
    const userId =
      typeof data === 'object' && data !== null ? (data as { userId?: unknown }).userId : undefined
    if (typeof userId !== 'string' || userId === '') throw new Error('Garmin answered no user id')
    return userId
  }

  /** The shared permissions, or none, with the reason audited: a failed request or an answer not understood. */
  const readPermissions = async (user: string, accessToken: string): Promise<string[]> => {
    let data: unknown
    try {
      data = await apiGet(PERMISSIONS_URL, accessToken, 'permissions request')
    } catch (error) {
      await deps.auditWarn(user, 'auth', 'Garmin: could not read the shared permissions', {
        error: errorText(error),
      })
      return []
    }
    if (!permissionsUnderstood(data)) {
      await deps.auditWarn(user, 'auth', 'Garmin: the shared permissions answer was not understood', {
        shape: garminAnswerShape(data),
      })
    }
    return parseGarminPermissions(data)
  }

  const refresh = async (user: string, grant: OAuthToken, refreshToken: string): Promise<string> => {
    const credentials = await getCredentials()
    if (!credentials) throw new Error('Garmin OAuth grant exists but the server has no Garmin credentials')
    let refreshed: GarminTokenResponse
    try {
      refreshed = await tokenRequest(
        {
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        },
        [credentials.clientSecret, refreshToken],
      )
    } catch (error) {
      // Only `invalid_grant` condemns the grant: a wrong client secret also answers 400/401, and
      // marking on the status alone would make every user reconnect after an admin's typo.
      if (error instanceof GarminOAuthApiError && error.code === 'invalid_grant') {
        await deps.markOAuthTokenRefused(user, GARMIN_OAUTH_PROVIDER, refreshToken)
        throw new GarminOAuthRefusedError()
      }
      throw error
    }
    await deps.upsertOAuthToken(user, {
      access_token: refreshed.access_token,
      expires_at: addSeconds(deps.now(), refreshed.expires_in),
      provider: GARMIN_OAUTH_PROVIDER,
      refresh_token: refreshed.refresh_token,
      scopes: grant.scopes,
    })
    return refreshed.access_token
  }

  const getAccessToken = async (user: string): Promise<string> => {
    const grant = await deps.getOAuthToken(user, GARMIN_OAUTH_PROVIDER)
    if (!isConnected(grant)) throw new GarminOAuthNotConnectedError()
    if (grant.refused_at !== undefined) throw new GarminOAuthRefusedError()
    const stillValid =
      grant.expires_at !== undefined &&
      isAfter(addSeconds(grant.expires_at, -TOKEN_EXPIRY_BUFFER_SECONDS), deps.now())
    if (stillValid) return grant.access_token
    const refreshToken = grant.refresh_token
    if (!refreshToken) throw new Error('Garmin OAuth grant has no refresh token; connect with Garmin again')
    const inFlight = refreshing.get(user)
    if (inFlight) return inFlight
    const pending = refresh(user, grant, refreshToken).finally(() => refreshing.delete(user))
    refreshing.set(user, pending)
    return pending
  }

  const clearGrant = (user: string) => deps.deleteOAuthToken(user, GARMIN_OAUTH_PROVIDER)

  const forget = async (user: string): Promise<void> => {
    await clearGrant(user)
    await deps.deleteGarminUserMappingByUsername(user)
    await deps.resetSyncState(user, GARMIN_PUSH_PROVIDER)
  }

  const deregister = async (accessToken: string): Promise<void> => {
    try {
      await deps.http.delete(REGISTRATION_URL, { headers: { Authorization: `Bearer ${accessToken}` } })
    } catch (error) {
      throw toGarminOAuthError(error, 'deregistration', [accessToken])
    }
  }

  /**
   * A user who connects a second Garmin account leaves the first one registered at Garmin, which
   * would keep pushing for a user id nothing maps any more. Must run before the new grant
   * replaces the old one's tokens.
   */
  const deregisterOtherGarminAccount = async (user: string, garminUserId: string): Promise<void> => {
    try {
      const mapped = await deps.getGarminUserIdByUsername(user)
      if (mapped === null || mapped === garminUserId) return
      await deregister(await getAccessToken(user))
    } catch (error) {
      if (error instanceof GarminOAuthNotConnectedError || error instanceof GarminOAuthRefusedError) return
      await deps.auditWarn(user, 'auth', 'Garmin OAuth deregistration failed', { error: errorText(error) })
    }
  }

  /** The live grant once it is fresh, or null when there is none to keep or the refresh failed. */
  const refreshIfDue = async (user: string): Promise<OAuthToken | null> => {
    try {
      const grant = await deps.getOAuthToken(user, GARMIN_OAUTH_PROVIDER)
      if (!isConnected(grant) || grant.refused_at !== undefined) return null
      if (!(await getCredentials())) return null
      const retryAt = keepFreshRetryAt.get(user)
      if (retryAt && isAfter(retryAt, deps.now())) return null
      keepFreshRetryAt.delete(user)
      await getAccessToken(user)
      return grant
    } catch (error) {
      keepFreshRetryAt.set(user, addSeconds(deps.now(), KEEP_FRESH_RETRY_SECONDS))
      await deps.auditWarn(user, 'auth', 'Garmin OAuth token refresh failed', { error: errorText(error) })
      return null
    }
  }

  /** Stores the permissions through the same path as Garmin's permission-change notice. At most once an hour per user. */
  const rereadPermissions = async (user: string): Promise<void> => {
    const retryAt = permissionsRetryAt.get(user)
    if (retryAt && isAfter(retryAt, deps.now())) return
    permissionsRetryAt.set(user, addSeconds(deps.now(), KEEP_FRESH_RETRY_SECONDS))
    try {
      const permissions = await readPermissions(user, await getAccessToken(user))
      if (permissions.length === 0) return
      await deps.updateOAuthTokenScopes(user, GARMIN_OAUTH_PROVIDER, permissions)
      permissionsRetryAt.delete(user)
      await deps.auditInfo(user, 'auth', 'Garmin: read the shared permissions', { permissions })
    } catch (error) {
      await deps.auditWarn(user, 'auth', 'Garmin: could not read the shared permissions', {
        error: errorText(error),
      })
    }
  }

  return {
    redirectUri,

    async isConfigured(): Promise<boolean> {
      return (await getCredentials()) !== null
    },

    getAccessToken,

    /** Asks Garmin which user the stored grant belongs to. Never throws. */
    async probeGrant(user: string): Promise<GarminGrantProbe> {
      let accessToken: string
      try {
        accessToken = await getAccessToken(user)
      } catch (error) {
        if (error instanceof GarminOAuthNotConnectedError || error instanceof GarminOAuthRefusedError) {
          return { status: 'gone' }
        }
        return { error: errorText(error), status: 'unknown' }
      }
      try {
        return { garminUserId: await fetchUserId(accessToken), status: 'alive' }
      } catch (error) {
        if (error instanceof GarminOAuthApiError && (error.status === 401 || error.status === 403)) {
          return { status: 'gone' }
        }
        return { error: errorText(error), status: 'unknown' }
      }
    },

    /**
     * Drops the grant, the Garmin user id mapping and the push sync states without telling
     * Garmin, for when Garmin has already removed the connection on its side.
     */
    forget,

    /**
     * Refreshes a grant that is due, so the refresh token does not lapse, and reads the shared
     * permissions again for a grant stored without any. Never throws.
     */
    async keepFresh(user: string): Promise<void> {
      const grant = await refreshIfDue(user)
      if (grant && (grant.scopes ?? []).length === 0) await rereadPermissions(user)
    },

    async getAuthorizeUrl(req: Request, res: Response<OAuthConnectUrlResponse>) {
      const user = req.user
      if (!user) {
        res.status(401).json({ error: 'Not authenticated', success: false })
        return
      }
      const credentials = await getCredentials()
      if (!credentials) {
        res.status(400).json({
          error: 'Garmin sign-in is not configured — set credentials in Admin Settings',
          success: false,
        })
        return
      }

      const { challenge, verifier } = createPkcePair()
      const state = sealState({ iat: deps.now().getTime(), user, verifier }, credentials.clientSecret)

      const location = new URL(GARMIN_AUTH_URL)
      location.searchParams.append('response_type', 'code')
      location.searchParams.append('client_id', credentials.clientId)
      location.searchParams.append('code_challenge', challenge)
      location.searchParams.append('code_challenge_method', 'S256')
      location.searchParams.append('redirect_uri', redirectUri)
      location.searchParams.append('state', state)

      res.json({ success: true, url: location.toString() })
    },

    /**
     * Garmin's redirect carries no Aurboda login, so it only hands the code and state to the
     * signed-in page, which finishes through `complete`.
     */
    async authCb(req: Request, res: Response) {
      const target = await handOverOAuthCallback(req.query, 'garmin', async (state) => {
        const credentials = await getCredentials()
        if (!credentials) return 'not_configured'
        return openState(state, credentials.clientSecret, deps.now()) ? null : 'invalid_state'
      })
      return res.redirect(target)
    },

    /** Links the Garmin account to `user`, who must be the user that started the sign-in. */
    async complete(user: string, code: string, state: string): Promise<OAuthCompletion> {
      const credentials = await getCredentials()
      if (!credentials) return { ok: false, reason: 'not_configured' }

      const opened = openState(state, credentials.clientSecret, deps.now())
      if (!opened) return { ok: false, reason: 'invalid_state' }
      if (opened.user !== user) {
        await deps.auditWarn(user, 'auth', 'Garmin sign-in started by another account was refused')
        return { ok: false, reason: 'wrong_user' }
      }

      await deps.ensureUserSchema(user)

      let grantStored = false
      try {
        const token = await tokenRequest(
          {
            client_id: credentials.clientId,
            client_secret: credentials.clientSecret,
            code,
            code_verifier: opened.verifier,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
          },
          [credentials.clientSecret, code, opened.verifier],
        )
        const garminUserId = await fetchUserId(token.access_token)
        const permissions = await readPermissions(user, token.access_token)
        await deregisterOtherGarminAccount(user, garminUserId)
        await deps.upsertOAuthToken(user, {
          access_token: token.access_token,
          expires_at: addSeconds(deps.now(), token.expires_in),
          provider: GARMIN_OAUTH_PROVIDER,
          refresh_token: token.refresh_token,
          scopes: permissions,
        })
        grantStored = true
        const previous = await deps.upsertGarminUserMapping(garminUserId, user)
        grantStored = false
        if (previous) {
          try {
            await clearGrant(previous)
            await deps.auditWarn(previous, 'auth', 'Garmin account connected from another Aurboda account')
            await deps.auditInfo(user, 'auth', 'Garmin account moved here from another Aurboda account')
          } catch (clearError) {
            await deps.auditWarn(
              user,
              'auth',
              'Could not clear the Garmin connection of the previous account',
              {
                error: redactAll(errorText(clearError), [credentials.clientSecret, token.access_token]),
              },
            )
          }
        }
        await deps.auditInfo(user, 'auth', 'Garmin connected through OAuth', { permissions })
        return { ok: true }
      } catch (failure) {
        // A grant without its mapping would show as connected while no push could reach the user.
        if (grantStored) await clearGrant(user).catch(() => {})
        await deps.auditWarn(user, 'auth', 'Garmin OAuth connection failed', {
          error: redactAll(errorText(failure), [credentials.clientSecret, code, opened.verifier]),
        })
        return { ok: false, reason: 'auth_failed' }
      }
    },

    /** The deregistration at Garmin is best effort: the grant and the mapping go either way. */
    async disconnect(user: string): Promise<void> {
      const grant = await deps.getOAuthToken(user, GARMIN_OAUTH_PROVIDER)
      if (!isConnected(grant)) return
      if (grant.refused_at === undefined && (await getCredentials())) {
        try {
          await deregister(await getAccessToken(user))
        } catch (error) {
          await deps.auditWarn(user, 'auth', 'Garmin OAuth deregistration failed', {
            error: errorText(error),
          })
        }
      }
      await forget(user)
      await deps.auditInfo(user, 'auth', 'Garmin OAuth disconnected')
    },
  }
}

export type GarminOAuthClient = ReturnType<typeof garminOAuthClient>
