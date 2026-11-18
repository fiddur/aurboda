/**
 * All API methods return { data, headers } so the queue processor can
 * read rate limit headers (X-ReadRateLimit-Usage).
 */

import type { Request, Response } from 'express'

import axios, { type AxiosResponse } from 'axios'
import { addSeconds, isFuture } from 'date-fns'

import type {
  StravaAthleteProfile,
  StravaDetailedActivity,
  StravaRateLimitInfo,
  StravaStreamsResponse,
  StravaSummaryActivity,
  StravaTokenResponse,
} from './types.ts'

import { getOAuthToken, initializeSchema, schemaInitialized, upsertOAuthToken } from '../../db/index.ts'
import { auditWarn } from '../../services/audit-log.ts'
import { handOverOAuthCallback, type OAuthCompletion } from '../../services/oauth-completion.ts'
import { signOAuthState, verifyOAuthState } from '../../services/signed-oauth-state.ts'
import { redactSecret } from '../garmin/client.ts'
import { parseRateLimitHeaders } from './types.ts'

const STRAVA_AUTH_URL = 'https://www.strava.com/oauth/authorize'
const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token'
const STRAVA_DEAUTHORIZE_URL = 'https://www.strava.com/oauth/deauthorize'
const STRAVA_API_BASE = 'https://www.strava.com/api/v3'
const STRAVA_SCOPES = 'activity:read_all,profile:read_all,read'

export interface StravaClientOptions {
  onUserAuthenticated?: (stravaAthleteId: number, username: string) => Promise<void>
  now?: () => Date
  auditWarn?: typeof auditWarn
}

export type StravaCredentialGetter = () => Promise<{ clientId: string; clientSecret: string }>

export interface StravaApiResponse<T> {
  data: T
  rateLimit: StravaRateLimitInfo
}

export const stravaClient = (
  getCredentials: StravaCredentialGetter,
  apiBaseUrl: string,
  options?: StravaClientOptions,
) => {
  const redirectUri = `${apiBaseUrl}/auth/stravacb`
  const now = options?.now ?? (() => new Date())
  const audit = options?.auditWarn ?? auditWarn

  const readCredentials = async () => {
    try {
      return await getCredentials()
    } catch {
      return null
    }
  }

  const apiGet = async <T>(path: string, token: string): Promise<StravaApiResponse<T>> => {
    const response: AxiosResponse<T> = await axios.get(`${STRAVA_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    return {
      data: response.data,
      rateLimit: parseRateLimitHeaders(response.headers as Record<string, unknown>),
    }
  }

  const getAccessToken = async (user: string): Promise<string> => {
    const token = await getOAuthToken(user, 'strava')
    if (!token) throw new Error('User has no Strava OAuth token')

    // Return token if not expired (with 100 second buffer)
    if (token.expires_at && isFuture(addSeconds(token.expires_at, -100))) {
      return token.access_token
    }

    const { clientId, clientSecret } = await getCredentials()
    const response = await axios.post<StravaTokenResponse>(STRAVA_TOKEN_URL, {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
    })

    const { access_token, refresh_token, expires_at } = response.data

    await upsertOAuthToken(user, {
      access_token,
      expires_at: new Date(expires_at * 1000),
      provider: 'strava',
      refresh_token,
    })

    return access_token
  }

  return {
    /**
     * Strava's redirect carries no Aurboda login, so it only hands the code and state to the
     * signed-in page, which finishes through `complete`.
     */
    async authCb(req: Request, res: Response) {
      const target = await handOverOAuthCallback(req.query, 'strava', async (state) => {
        const credentials = await readCredentials()
        if (!credentials) return 'not_configured'
        return verifyOAuthState(state, { provider: 'strava' }, credentials.clientSecret, now())
          ? null
          : 'invalid_state'
      })
      return res.redirect(target)
    },

    /** Links the Strava athlete to `user`, who must be the user that started the sign-in. */
    async complete(user: string, code: string, state: string): Promise<OAuthCompletion> {
      const credentials = await readCredentials()
      if (!credentials) return { ok: false, reason: 'not_configured' }
      const { clientId, clientSecret } = credentials

      const stateUser = verifyOAuthState(state, { provider: 'strava' }, clientSecret, now())
      if (!stateUser) return { ok: false, reason: 'invalid_state' }
      if (stateUser !== user) {
        await audit(user, 'auth', 'Strava sign-in started by another account was refused')
        return { ok: false, reason: 'wrong_user' }
      }

      if (!(await schemaInitialized(user))) {
        await initializeSchema(user)
      }

      try {
        const response = await axios.post<StravaTokenResponse>(STRAVA_TOKEN_URL, {
          client_id: clientId,
          client_secret: clientSecret,
          code,
          grant_type: 'authorization_code',
        })

        const { access_token, refresh_token, expires_at, athlete } = response.data

        await upsertOAuthToken(user, {
          access_token,
          expires_at: new Date(expires_at * 1000),
          provider: 'strava',
          refresh_token,
          scopes: STRAVA_SCOPES.split(','),
        })

        if (options?.onUserAuthenticated && athlete?.id) {
          await options.onUserAuthenticated(athlete.id, user)
        }

        return { ok: true }
      } catch (failure) {
        const message = failure instanceof Error ? failure.message : String(failure)
        await audit(user, 'auth', 'Strava OAuth connection failed', {
          error: [clientSecret, code].reduce((acc, secret) => redactSecret(acc, secret), message),
        })
        return { ok: false, reason: 'auth_failed' }
      }
    },

    getAccessToken,

    /** Revoke the app's access at Strava and clear the stored grant. Does nothing without a grant. */
    async deauthorize(user: string): Promise<void> {
      const token = await getOAuthToken(user, 'strava')
      if (!token?.access_token) return
      const accessToken = await getAccessToken(user)
      await axios.post(STRAVA_DEAUTHORIZE_URL, undefined, { params: { access_token: accessToken } })
      await upsertOAuthToken(user, { access_token: '', provider: 'strava' })
    },

    async getActivity(token: string, activityId: number): Promise<StravaApiResponse<StravaDetailedActivity>> {
      return apiGet(`/activities/${activityId}`, token)
    },

    async getActivityStreams(
      token: string,
      activityId: number,
    ): Promise<StravaApiResponse<StravaStreamsResponse>> {
      return apiGet(
        `/activities/${activityId}/streams?keys=heartrate,latlng,altitude,time,distance,velocity_smooth,cadence,watts,temp&key_by_type=true`,
        token,
      )
    },

    async getAthleteProfile(token: string): Promise<StravaApiResponse<StravaAthleteProfile>> {
      return apiGet('/athlete', token)
    },

    async getAuthorizeUrl(req: Request, res: Response) {
      const user = req.user
      if (!user) {
        res.status(401).json({ error: 'Not authenticated', success: false })
        return
      }

      let clientId: string
      let clientSecret: string
      try {
        ;({ clientId, clientSecret } = await getCredentials())
      } catch {
        res
          .status(400)
          .json({ error: 'Strava not configured — set credentials in Admin Settings', success: false })
        return
      }

      const state = signOAuthState({ provider: 'strava', user }, clientSecret, now())

      const location = new URL(STRAVA_AUTH_URL)
      location.searchParams.append('client_id', clientId)
      location.searchParams.append('redirect_uri', redirectUri)
      location.searchParams.append('response_type', 'code')
      location.searchParams.append('scope', STRAVA_SCOPES)
      location.searchParams.append('state', state)
      location.searchParams.append('approval_prompt', 'auto')

      res.json({ success: true, url: location.toString() })
    },

    async listActivities(
      token: string,
      params: { before?: number; after?: number; page?: number; per_page?: number },
    ): Promise<StravaApiResponse<StravaSummaryActivity[]>> {
      const searchParams = new URLSearchParams()
      if (params.before) searchParams.append('before', String(params.before))
      if (params.after) searchParams.append('after', String(params.after))
      if (params.page) searchParams.append('page', String(params.page))
      searchParams.append('per_page', String(params.per_page ?? 200))

      const qs = searchParams.toString()
      return apiGet(`/athlete/activities${qs ? `?${qs}` : ''}`, token)
    },
  }
}

export type StravaClient = ReturnType<typeof stravaClient>
