/**
 * Gravl API client — credential resolution + read-only API calls.
 *
 * Two ways in, resolved per request in this order (#1042):
 *
 * 1. An OAuth grant (`oauth_tokens.provider = 'gravl'`), which exists only when
 *    the admin has configured `gravl_client_id` / `gravl_client_secret` in server
 *    settings and the user clicked "Connect Gravl". Access tokens live 6 h and
 *    are refreshed here; refresh tokens rotate on every use.
 * 2. A personal access token the user pasted into settings
 *    (`user_settings.gravl_api_token`, the `rescue_time_key` precedent).
 *
 * The OAuth flow is authorization-code + PKCE (S256). The PKCE verifier and
 * the user are carried through the round-trip inside the `state` parameter,
 * sealed with AES-256-GCM under a key derived from the client secret — so the
 * callback can land on any backend instance without shared session storage,
 * and nobody can forge a state that links a Gravl grant to a different user.
 *
 * Gravl is Cloudflare-fronted and answers 403 to bot-looking user agents, so
 * every request carries a descriptive `User-Agent`.
 */

import type { Request, Response } from 'express'

import axios, { type AxiosInstance, isAxiosError } from 'axios'
import { addSeconds, isAfter } from 'date-fns'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

import type { OAuthToken } from '../../db/types.ts'
import type {
  GravlPage,
  GravlProblem,
  GravlTokenResponse,
  GravlWorkoutDetail,
  GravlWorkoutSummary,
} from './types.ts'

import { getOAuthToken, initializeSchema, schemaInitialized, upsertOAuthToken } from '../../db/index.ts'
import { getSettings } from '../../services/settings.ts'

export const GRAVL_API_BASE = 'https://api.gravl.ai'
const GRAVL_AUTH_URL = `${GRAVL_API_BASE}/oauth/authorize`
const GRAVL_TOKEN_URL = `${GRAVL_API_BASE}/oauth/token`
const GRAVL_REVOKE_URL = `${GRAVL_API_BASE}/oauth/revoke`

/** `workouts:read` is all the sync needs today; the rest are for the follow-ups listed in #1042. */
export const GRAVL_SCOPES = ['workouts:read', 'records:read', 'measurements:read', 'profile:read'] as const

/** Authorization codes are valid 10 minutes; a sealed state older than that is useless anyway. */
const STATE_MAX_AGE_MS = 10 * 60 * 1000

/** Refresh an access token this close to expiry rather than risk a 401 mid-sync. */
const TOKEN_EXPIRY_BUFFER_SECONDS = 100

export const GRAVL_PAGE_SIZE_MAX = 100

export interface GravlCredentials {
  clientId: string
  clientSecret: string
}

/** Resolves the admin-configured OAuth app, or `null` when the server has none. */
export type GravlCredentialGetter = () => Promise<GravlCredentials | null>

export interface GravlClientDeps {
  getOAuthToken: (user: string, provider: string) => Promise<OAuthToken | null>
  upsertOAuthToken: (user: string, token: OAuthToken) => Promise<void>
  /** The user's pasted personal token, if any. */
  getPersonalToken: (user: string) => Promise<string | null>
  ensureUserSchema: (user: string) => Promise<void>
  http: AxiosInstance
  now: () => Date
}

/**
 * Thrown for any non-2xx Gravl response. `status` lets callers tell auth
 * failures (401/403) from throttling (429, with `retryAfterSeconds` when Gravl
 * sent `Retry-After`) and transient upstream errors.
 */
export class GravlApiError extends Error {
  readonly status: number
  readonly retryAfterSeconds?: number

  constructor(message: string, status: number, retryAfterSeconds?: number) {
    super(message)
    this.name = 'GravlApiError'
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export const isGravlRateLimit = (error: unknown): error is GravlApiError =>
  error instanceof GravlApiError && error.status === 429

export const isGravlAuthFailure = (error: unknown): error is GravlApiError =>
  error instanceof GravlApiError && (error.status === 401 || error.status === 403)

const parseRetryAfter = (header: unknown): number | undefined => {
  if (typeof header !== 'string' || header === '') return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds)
  const at = Date.parse(header)
  return Number.isNaN(at) ? undefined : Math.max(0, Math.round((at - Date.now()) / 1000))
}

const toGravlError = (error: unknown): unknown => {
  if (!isAxiosError(error) || !error.response) return error
  const problem = (error.response.data ?? {}) as GravlProblem
  const detail = [problem.title, problem.detail].filter(Boolean).join(': ')
  return new GravlApiError(
    `Gravl API ${error.response.status}${detail ? ` — ${detail}` : ''}`,
    error.response.status,
    parseRetryAfter(error.response.headers?.['retry-after']),
  )
}

// ---------------------------------------------------------------------------
// PKCE + sealed state
// ---------------------------------------------------------------------------

const base64url = (buf: Buffer): string => buf.toString('base64url')

export const createPkcePair = (): { verifier: string; challenge: string } => {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { challenge, verifier }
}

interface SealedState {
  iat: number
  user: string
  verifier: string
}

const stateKey = (clientSecret: string): Buffer => createHash('sha256').update(clientSecret).digest()

/** AES-256-GCM: iv(12) | tag(16) | ciphertext, base64url. Integrity comes from the tag. */
export const sealState = (state: SealedState, clientSecret: string): string => {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', stateKey(clientSecret), iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(state), 'utf8'), cipher.final()])
  return base64url(Buffer.concat([iv, cipher.getAuthTag(), ciphertext]))
}

export const openState = (sealed: string, clientSecret: string, now: Date): SealedState | null => {
  try {
    const buf = Buffer.from(sealed, 'base64url')
    if (buf.length < 28) return null
    const decipher = createDecipheriv('aes-256-gcm', stateKey(clientSecret), buf.subarray(0, 12))
    decipher.setAuthTag(buf.subarray(12, 28))
    const plain = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8')
    const parsed: unknown = JSON.parse(plain)
    if (!isSealedState(parsed)) return null
    if (now.getTime() - parsed.iat > STATE_MAX_AGE_MS) return null
    return parsed
  } catch {
    return null
  }
}

const isSealedState = (value: unknown): value is SealedState =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as SealedState).iat === 'number' &&
  typeof (value as SealedState).user === 'string' &&
  typeof (value as SealedState).verifier === 'string'

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const defaultDeps = (): GravlClientDeps => ({
  ensureUserSchema: async (user) => {
    if (!(await schemaInitialized(user))) await initializeSchema(user)
  },
  getOAuthToken,
  getPersonalToken: async (user) => (await getSettings(user)).gravl_api_token ?? null,
  http: axios.create({
    headers: {
      Accept: 'application/json',
      'User-Agent': `aurboda/${process.env.BUILD_SHA ?? 'dev'} (+https://github.com/fiddur/aurboda)`,
    },
  }),
  now: () => new Date(),
  upsertOAuthToken,
})

export const gravlClient = (
  getCredentials: GravlCredentialGetter,
  apiBaseUrl: string,
  overrides: Partial<GravlClientDeps> = {},
) => {
  const deps: GravlClientDeps = { ...defaultDeps(), ...overrides }
  const redirectUri = `${apiBaseUrl}/auth/gravlcb`

  const tokenRequest = async (form: Record<string, string>): Promise<GravlTokenResponse> => {
    try {
      const response = await deps.http.post<GravlTokenResponse>(GRAVL_TOKEN_URL, new URLSearchParams(form), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
      return response.data
    } catch (error) {
      throw toGravlError(error)
    }
  }

  const storeGrant = async (user: string, token: GravlTokenResponse): Promise<void> => {
    await deps.upsertOAuthToken(user, {
      access_token: token.access_token,
      expires_at: addSeconds(deps.now(), token.expires_in),
      provider: 'gravl',
      refresh_token: token.refresh_token,
      scopes: token.scope ? token.scope.split(' ') : undefined,
    })
  }

  const apiGet = async <T>(path: string, token: string, params?: Record<string, string>): Promise<T> => {
    try {
      const response = await deps.http.get<T>(`${GRAVL_API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        params,
      })
      return response.data
    } catch (error) {
      throw toGravlError(error)
    }
  }

  return {
    /** Redirect target for the OAuth callback; also the URI the admin registers with Gravl. */
    redirectUri,

    async isConfigured(): Promise<boolean> {
      return (await getCredentials()) !== null
    },

    /**
     * Whether the user can sync at all: an OAuth grant or a personal token.
     * The grant wins when both exist, matching `getAccessToken`.
     */
    async connectionKind(user: string): Promise<'oauth' | 'token' | null> {
      const grant = await deps.getOAuthToken(user, 'gravl')
      if (grant && grant.access_token !== '') return 'oauth'
      if (await deps.getPersonalToken(user)) return 'token'
      return null
    },

    /**
     * Resolve a bearer token: a live OAuth grant (refreshed when within
     * `TOKEN_EXPIRY_BUFFER_SECONDS` of expiry), else the personal token.
     */
    async getAccessToken(user: string): Promise<string> {
      const grant = await deps.getOAuthToken(user, 'gravl')
      if (grant && grant.access_token !== '') {
        const stillValid =
          grant.expires_at !== undefined &&
          isAfter(addSeconds(grant.expires_at, -TOKEN_EXPIRY_BUFFER_SECONDS), deps.now())
        if (stillValid) return grant.access_token
        if (!grant.refresh_token) return grant.access_token
        const credentials = await getCredentials()
        if (!credentials) throw new Error('Gravl OAuth grant exists but the server has no Gravl credentials')
        const refreshed = await tokenRequest({
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: grant.refresh_token,
        })
        await storeGrant(user, refreshed)
        return refreshed.access_token
      }
      const personal = await deps.getPersonalToken(user)
      if (personal) return personal
      throw new Error('Gravl is not connected: connect via OAuth or add a personal token in settings')
    },

    // Returns the OAuth authorize URL as JSON (called with authMiddleware, uses req.user)
    async getAuthorizeUrl(req: Request, res: Response) {
      const user = req.user
      if (!user) {
        res.status(401).json({ error: 'Not authenticated', success: false })
        return
      }
      const credentials = await getCredentials()
      if (!credentials) {
        res
          .status(400)
          .json({ error: 'Gravl OAuth not configured — set credentials in Admin Settings', success: false })
        return
      }

      const { challenge, verifier } = createPkcePair()
      const state = sealState({ iat: deps.now().getTime(), user, verifier }, credentials.clientSecret)

      const location = new URL(GRAVL_AUTH_URL)
      location.searchParams.append('client_id', credentials.clientId)
      location.searchParams.append('redirect_uri', redirectUri)
      location.searchParams.append('response_type', 'code')
      location.searchParams.append('scope', GRAVL_SCOPES.join(' '))
      location.searchParams.append('state', state)
      location.searchParams.append('code_challenge', challenge)
      location.searchParams.append('code_challenge_method', 'S256')

      res.json({ success: true, url: location.toString() })
    },

    async authCb(req: Request, res: Response) {
      const { code, state, error } = req.query as Record<string, string | undefined>
      if (error || !state || !code) return res.redirect('/data-sources/gravl?error=auth_failed')

      const credentials = await getCredentials()
      if (!credentials) return res.redirect('/data-sources/gravl?error=not_configured')

      const opened = openState(state, credentials.clientSecret, deps.now())
      if (!opened) return res.redirect('/data-sources/gravl?error=invalid_state')

      await deps.ensureUserSchema(opened.user)

      try {
        const token = await tokenRequest({
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          code,
          code_verifier: opened.verifier,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        })
        await storeGrant(opened.user, token)
        return res.redirect('/data-sources/gravl?connected=true')
      } catch {
        return res.redirect('/data-sources/gravl?error=auth_failed')
      }
    },

    /**
     * Drop the OAuth grant. Revocation at Gravl is best effort — the local
     * row is cleared either way so the UI never shows a dead connection.
     */
    async disconnect(user: string): Promise<void> {
      const grant = await deps.getOAuthToken(user, 'gravl')
      const credentials = await getCredentials()
      if (grant?.refresh_token && credentials) {
        try {
          await deps.http.post(
            GRAVL_REVOKE_URL,
            new URLSearchParams({
              client_id: credentials.clientId,
              client_secret: credentials.clientSecret,
              token: grant.refresh_token,
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
          )
        } catch {
          // Revocation failing must not block the local disconnect.
        }
      }
      if (grant) await deps.upsertOAuthToken(user, { access_token: '', provider: 'gravl' })
    },

    async listWorkouts(
      token: string,
      params: { page?: number; pageSize?: number; startDate?: Date; endDate?: Date } = {},
    ): Promise<GravlPage<GravlWorkoutSummary>> {
      const query: Record<string, string> = {
        Page: String(params.page ?? 1),
        PageSize: String(Math.min(params.pageSize ?? GRAVL_PAGE_SIZE_MAX, GRAVL_PAGE_SIZE_MAX)),
      }
      if (params.startDate) query.StartDate = params.startDate.toISOString()
      if (params.endDate) query.EndDate = params.endDate.toISOString()
      return apiGet<GravlPage<GravlWorkoutSummary>>('/api/v1/workouts', token, query)
    },

    async getWorkout(token: string, workoutId: string): Promise<GravlWorkoutDetail> {
      return apiGet<GravlWorkoutDetail>(`/api/v1/workouts/${encodeURIComponent(workoutId)}`, token)
    },
  }
}

export type GravlClient = ReturnType<typeof gravlClient>
