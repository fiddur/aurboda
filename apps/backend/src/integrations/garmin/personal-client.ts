import type { OAuthToken } from '../../db/types.ts'
import type {
  GarminBodyBatteryData,
  GarminDailySummary,
  GarminHrvData,
  GarminIntensityMinutes,
  GarminRespirationData,
  GarminSpo2Data,
} from './client.ts'

import {
  deleteOAuthToken,
  getOAuthToken,
  markOAuthTokenRefused,
  updateOAuthAccessToken,
  upsertOAuthToken,
} from '../../db/index.ts'
import { auditError } from '../../services/audit-log.ts'
import { redactSecret } from './client.ts'
import { parseGarminGmt } from './sleep-stages.ts'
import { GARMIN_PERSONAL_PROVIDER } from './source.ts'

const PERSONAL_API = 'https://personal.connectapi.garmin.com'
const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token'
const JWT_MIN_REMAINING_MS = 60 * 60 * 1000
const SUMMARY_TTL_MS = 60_000

/** Garmin answered 401/403 to the key exchange: the key is revoked, expired or mistyped. */
export class GarminKeyRefusedError extends Error {
  constructor() {
    super('Garmin refused the Personal API key')
    this.name = 'GarminKeyRefusedError'
  }
}

/** Any other non-2xx answer. The message names the status and the path, never a credential. */
export class GarminPersonalApiError extends Error {
  readonly status: number

  constructor(status: number, path: string) {
    super(`Garmin Personal API ${status} for ${path}`)
    this.name = 'GarminPersonalApiError'
    this.status = status
  }
}

export interface GarminPersonalClientDeps {
  fetch: typeof fetch
  getOAuthToken: (user: string, provider: string) => Promise<OAuthToken | null>
  upsertOAuthToken: (user: string, token: OAuthToken) => Promise<void>
  deleteOAuthToken: (user: string, provider: string) => Promise<boolean>
  markOAuthTokenRefused: (user: string, provider: string, refreshToken?: string) => Promise<void>
  updateOAuthAccessToken: (
    user: string,
    provider: string,
    refreshToken: string,
    accessToken: string,
  ) => Promise<boolean>
  auditError: typeof auditError
  now: () => Date
}

const defaultDeps = (): GarminPersonalClientDeps => ({
  auditError,
  deleteOAuthToken,
  fetch: (...args) => fetch(...args),
  getOAuthToken,
  markOAuthTokenRefused,
  now: () => new Date(),
  updateOAuthAccessToken,
  upsertOAuthToken,
})

/** The daily summary as the Personal API serves it, with the fields the derived types read. */
export interface GarminPersonalDailySummary extends GarminDailySummary {
  avgWakingRespirationValue?: number | null
  highestRespirationValue?: number | null
  lowestRespirationValue?: number | null
  latestRespirationValue?: number | null
  intensityMinutesGoal?: number | null
}

/** The `exp` claim of a JWT in epoch milliseconds, or null when it cannot be read. */
export const jwtExpiryMs = (jwt: string): number | null => {
  const payload = jwt.split('.')[1]
  if (!payload) return null
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown }
    return typeof exp === 'number' ? exp * 1000 : null
  } catch {
    return null
  }
}

const toEpochMs = (value: unknown): number | null => {
  if (typeof value === 'number') return value
  if (typeof value !== 'string' || value === '') return null
  if (/^\d+$/.test(value)) return Number(value)
  return parseGarminGmt(value)?.getTime() ?? null
}

/**
 * The Personal API serves the flat `DailySleepDTO`; the session path's processor
 * reads it wrapped, as `dailySleepData` answers, with epoch-millisecond times.
 */
export const adaptPersonalSleep = (body: unknown): unknown => {
  if (body === null || typeof body !== 'object') return body
  if ('dailySleepDTO' in body) return body
  const dto = body as Record<string, unknown>
  return {
    dailySleepDTO: {
      ...dto,
      sleepEndTimestampGMT: toEpochMs(dto.sleepEndTimestampGMT),
      sleepStartTimestampGMT: toEpochMs(dto.sleepStartTimestampGMT),
    },
  }
}

const fmt = (d: Date): string => d.toISOString().slice(0, 10)

const isRefusal = (status: number): boolean => status === 401 || status === 403

export const garminPersonalClient = (overrides: Partial<GarminPersonalClientDeps> = {}) => {
  const deps: GarminPersonalClientDeps = { ...defaultDeps(), ...overrides }
  const exchanging = new Map<string, Promise<string>>()
  const summaries = new Map<string, { at: number; summary: Promise<GarminPersonalDailySummary | null> }>()

  const send = async (url: string, init: RequestInit, path: string, secrets: string[]): Promise<Response> => {
    try {
      return await deps.fetch(url, init)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const redacted = secrets.reduce((acc, secret) => redactSecret(acc, secret), message)
      throw new Error(`Garmin Personal API request failed for ${path}: ${redacted}`)
    }
  }

  const exchange = async (apiKey: string): Promise<{ jwt: string } | { status: number }> => {
    const res = await send(
      `${PERSONAL_API}${TOKEN_PATH}`,
      { headers: { Accept: '*/*', Authorization: `ApiKey ${apiKey}` }, method: 'POST' },
      TOKEN_PATH,
      [apiKey],
    )
    if (!res.ok) return { status: res.status }
    const jwt = (await res.text()).trim()
    if (!jwt) throw new GarminPersonalApiError(res.status, TOKEN_PATH)
    return { jwt }
  }

  const refreshJwt = async (user: string, stored: OAuthToken): Promise<string> => {
    const apiKey = stored.refresh_token!
    const result = await exchange(apiKey)
    if ('status' in result) {
      if (isRefusal(result.status)) {
        await deps.markOAuthTokenRefused(user, GARMIN_PERSONAL_PROVIDER, apiKey)
        deps.auditError(user, 'auth', 'Garmin refused the Personal API key', { status: result.status })
        throw new GarminKeyRefusedError()
      }
      throw new GarminPersonalApiError(result.status, TOKEN_PATH)
    }
    await deps.updateOAuthAccessToken(user, GARMIN_PERSONAL_PROVIDER, apiKey, result.jwt)
    return result.jwt
  }

  const sharedRefresh = (user: string, stored: OAuthToken): Promise<string> => {
    const inFlight = exchanging.get(user)
    if (inFlight) return inFlight
    const promise = refreshJwt(user, stored).finally(() => exchanging.delete(user))
    exchanging.set(user, promise)
    return promise
  }

  const storedKey = async (user: string): Promise<OAuthToken> => {
    const stored = await deps.getOAuthToken(user, GARMIN_PERSONAL_PROVIDER)
    if (!stored?.refresh_token) throw new Error('No Garmin Personal API key is connected.')
    if (stored.refused_at) throw new GarminKeyRefusedError()
    return stored
  }

  const freshJwt = (stored: OAuthToken): string | null => {
    if (!stored.access_token) return null
    const exp = jwtExpiryMs(stored.access_token)
    return exp !== null && exp - deps.now().getTime() > JWT_MIN_REMAINING_MS ? stored.access_token : null
  }

  const get = async <T>(
    user: string,
    path: string,
    query: Record<string, string> = {},
  ): Promise<T | null> => {
    const stored = await storedKey(user)
    const search = new URLSearchParams(query).toString()
    const url = `${PERSONAL_API}${path}${search ? `?${search}` : ''}`
    const call = (jwt: string) =>
      send(
        url,
        { headers: { Accept: 'application/json', Authorization: `Bearer ${jwt}` }, method: 'GET' },
        path,
        [jwt, stored.refresh_token!],
      )

    let res = await call(freshJwt(stored) ?? (await sharedRefresh(user, stored)))
    if (res.status === 401) res = await call(await sharedRefresh(user, stored))

    if (res.status === 204) return null
    if (!res.ok) throw new GarminPersonalApiError(res.status, path)
    const text = await res.text()
    return text.trim() ? (JSON.parse(text) as T) : null
  }

  const dailySummary = (user: string, date: Date): Promise<GarminPersonalDailySummary | null> => {
    const key = `${user}|${fmt(date)}`
    const now = deps.now().getTime()
    const cached = summaries.get(key)
    if (cached && now - cached.at < SUMMARY_TTL_MS) return cached.summary
    for (const [k, entry] of summaries) if (now - entry.at >= SUMMARY_TTL_MS) summaries.delete(k)
    const summary = get<GarminPersonalDailySummary>(user, '/usersummary-service/usersummary/daily', {
      calendarDate: fmt(date),
    })
    summaries.set(key, { at: now, summary })
    summary.catch(() => summaries.delete(key))
    return summary
  }

  return {
    async connect(user: string, apiKey: string, keyExpiresAt: Date): Promise<void> {
      const result = await exchange(apiKey)
      if ('status' in result) {
        if (isRefusal(result.status)) throw new GarminKeyRefusedError()
        throw new GarminPersonalApiError(result.status, TOKEN_PATH)
      }
      await deps.upsertOAuthToken(user, {
        access_token: result.jwt,
        expires_at: keyExpiresAt,
        provider: GARMIN_PERSONAL_PROVIDER,
        refresh_token: apiKey,
      })
    },

    async disconnect(user: string): Promise<void> {
      await deps.deleteOAuthToken(user, GARMIN_PERSONAL_PROVIDER)
    },

    getActivities: async (user: string, start: number, limit: number): Promise<unknown[]> =>
      (await get<unknown[]>(user, '/activitylist-service/activities/search/activities', {
        limit: String(limit),
        start: String(start),
      })) ?? [],

    getBodyBattery: async (user: string, startDate: Date, endDate: Date): Promise<GarminBodyBatteryData[]> =>
      (await get<GarminBodyBatteryData[]>(user, '/wellness-service/wellness/bodyBattery/reports/daily', {
        endDate: fmt(endDate),
        startDate: fmt(startDate),
      })) ?? [],

    getDailySummary: (user: string, date: Date): Promise<GarminDailySummary | null> =>
      dailySummary(user, date),

    getHeartRate: (user: string, date: Date): Promise<unknown> =>
      get<unknown>(user, '/wellness-service/wellness/dailyHeartRate', { date: fmt(date) }),

    getHrv: (user: string, date: Date): Promise<GarminHrvData | null> =>
      get<GarminHrvData>(user, `/hrv-service/hrv/${fmt(date)}`),

    async getIntensityMinutes(user: string, date: Date): Promise<GarminIntensityMinutes | null> {
      const summary = await dailySummary(user, date)
      if (!summary?.calendarDate) return null
      return {
        calendarDate: summary.calendarDate,
        moderateIntensityMinutes: summary.moderateIntensityMinutes,
        vigorousIntensityMinutes: summary.vigorousIntensityMinutes,
        weeklyGoal: summary.intensityMinutesGoal ?? 0,
      }
    },

    async getRespiration(user: string, date: Date): Promise<GarminRespirationData | null> {
      const summary = await dailySummary(user, date)
      if (!summary?.calendarDate) return null
      return {
        avgWakingRespirationValue: summary.avgWakingRespirationValue ?? 0,
        calendarDate: summary.calendarDate,
        highestRespirationValue: summary.highestRespirationValue ?? 0,
        latestRespirationValue: summary.latestRespirationValue ?? 0,
        lowestRespirationValue: summary.lowestRespirationValue ?? 0,
      }
    },

    getSleep: async (user: string, date: Date): Promise<unknown> =>
      adaptPersonalSleep(await get<unknown>(user, '/sleep-service/sleep/dailySleep', { date: fmt(date) })),

    getSpo2: (user: string, date: Date): Promise<GarminSpo2Data | null> =>
      get<GarminSpo2Data>(user, `/wellness-service/wellness/daily/spo2acclimation/${fmt(date)}`),
  }
}

export type GarminPersonalClient = ReturnType<typeof garminPersonalClient>
