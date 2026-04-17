/**
 * Strava API client — OAuth2 authentication + API methods.
 *
 * Follows the oura/client.ts pattern: factory function returning methods
 * for OAuth redirect, callback, token refresh, and API calls.
 *
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

const STRAVA_AUTH_URL = 'https://www.strava.com/oauth/authorize'
const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token'
const STRAVA_API_BASE = 'https://www.strava.com/api/v3'
const STRAVA_SCOPES = 'activity:read_all,profile:read_all,read'

export interface StravaClientOptions {
  onUserAuthenticated?: (stravaAthleteId: number, username: string) => Promise<void>
}

export interface StravaApiResponse<T> {
  data: T
  rateLimit: StravaRateLimitInfo
}

const parseRateLimitHeaders = (headers: Record<string, unknown>): StravaRateLimitInfo => {
  const readUsage = String(headers['x-readratelimit-usage'] ?? '0,0').split(',')
  const readLimit = String(headers['x-readratelimit-limit'] ?? '100,1000').split(',')

  return {
    reads_15min: parseInt(readUsage[0], 10) || 0,
    reads_15min_limit: parseInt(readLimit[0], 10) || 100,
    reads_daily: parseInt(readUsage[1], 10) || 0,
    reads_daily_limit: parseInt(readLimit[1], 10) || 1000,
  }
}

export const stravaClient = (
  clientId: string,
  clientSecret: string,
  webHost: string,
  options?: StravaClientOptions,
) => {
  if (!clientId || !clientSecret) throw new Error('Strava missing client_id or client_secret')
  const redirectUri = `${webHost}/auth/stravacb`

  const apiGet = async <T>(path: string, token: string): Promise<StravaApiResponse<T>> => {
    const response: AxiosResponse<T> = await axios.get(`${STRAVA_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    return {
      data: response.data,
      rateLimit: parseRateLimitHeaders(response.headers as Record<string, unknown>),
    }
  }

  return {
    async authCb(req: Request, res: Response) {
      const { code, state, error } = req.query as Record<string, string | undefined>

      if (error) {
        res.statusCode = 500
        return res.end('{"success":false}')
      }

      const user = state as string

      if (!(await schemaInitialized(user))) {
        await initializeSchema(user)
      }

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

      res.end()
    },

    async getAccessToken(user: string): Promise<string> {
      const token = await getOAuthToken(user, 'strava')
      if (!token) throw new Error('User has no Strava OAuth token')

      // Return token if not expired (with 100 second buffer)
      if (token.expires_at && isFuture(addSeconds(token.expires_at, -100))) {
        return token.access_token
      }

      // Refresh the token
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
    },

    async getActivity(token: string, activityId: number): Promise<StravaApiResponse<StravaDetailedActivity>> {
      return apiGet(`/activities/${activityId}`, token)
    },

    async getActivityStreams(
      token: string,
      activityId: number,
    ): Promise<StravaApiResponse<StravaStreamsResponse>> {
      return apiGet(
        `/activities/${activityId}/streams?keys=heartrate,latlng,altitude,time,distance,cadence,watts,temp&key_by_type=true`,
        token,
      )
    },

    async getAthleteProfile(token: string): Promise<StravaApiResponse<StravaAthleteProfile>> {
      return apiGet('/athlete', token)
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

    redirectToAuthorize(req: Request, res: Response) {
      const { username } = req.query as Record<string, string | undefined>
      if (!username) {
        res.statusCode = 400
        res.end('No username')
        return
      }

      const location = new URL(STRAVA_AUTH_URL)
      location.searchParams.append('client_id', clientId)
      location.searchParams.append('redirect_uri', redirectUri)
      location.searchParams.append('response_type', 'code')
      location.searchParams.append('scope', STRAVA_SCOPES)
      location.searchParams.append('state', username)
      location.searchParams.append('approval_prompt', 'auto')

      res.writeHead(302, {
        'Content-Length': 0,
        'Content-Type': 'text/plain',
        Location: location.toString(),
      })
      res.end()
    },
  }
}

export type StravaClient = ReturnType<typeof stravaClient>
