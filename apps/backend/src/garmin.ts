/**
 * Garmin Connect API client.
 *
 * Wraps @flow-js/garmin-connect for authenticated data fetching.
 * Uses custom GET requests for endpoints not covered by the library.
 *
 * Auth is via username/password login → OAuth tokens persisted as a serialized
 * blob in oauth_tokens. Credentials are never stored.
 */

import type { IGarminTokens } from '@flow-js/garmin-connect'

import garminConnectPkg from '@flow-js/garmin-connect'
const { GarminConnect } = garminConnectPkg

import { getOAuthToken, upsertOAuthToken } from './db/index.ts'

// ============================================================================
// Types for Garmin API responses (from custom GET endpoints)
// ============================================================================

/** Daily stress response from /wellness-service/wellness/dailyStress/{date} */
export interface GarminStressData {
  calendarDate: string
  overallStressLevel: number
  restStressDuration: number
  activityStressDuration: number
  uncategorizedStressDuration: number
  totalStressDuration: number
  lowStressDuration: number
  mediumStressDuration: number
  highStressDuration: number
  stressValuesArray: [number, number][] | null // [timestamp, stressLevel]
}

/** Body battery daily report from /wellness-service/wellness/bodyBattery/reports/daily */
export interface GarminBodyBatteryData {
  date: string
  charged: number
  drained: number
  startTimestampGMT: number | null
  endTimestampGMT: number | null
  startTimestampLocal: number | null
  endTimestampLocal: number | null
  bodyBatteryValuesArray: [number, number][] | null // [timestamp, value]
}

/** Daily respiration from /wellness-service/wellness/daily/respiration/{date} */
export interface GarminRespirationData {
  calendarDate: string
  avgWakingRespirationValue: number
  highestRespirationValue: number
  lowestRespirationValue: number
  latestRespirationValue: number
}

/** Daily SpO2 from /wellness-service/wellness/daily/spo2/{date} */
export interface GarminSpo2Data {
  calendarDate: string
  averageSpO2: number
  lowestSpO2: number
  latestSpO2: number
  latestSpO2ReadingTimeLocal: string | null
}

/** HRV data from /hrv-service/hrv/{date} */
export interface GarminHrvData {
  calendarDate: string
  weeklyAvg: number
  lastNightAvg: number
  lastNight5MinHigh: number
  status: string // e.g. "BALANCED", "UNBALANCED", etc.
  startTimestampGMT: number | null
  endTimestampGMT: number | null
  startTimestampLocal: number | null
  endTimestampLocal: number | null
  hrvSummaries: GarminHrvSummary[] | null
}

export interface GarminHrvSummary {
  calendarDate: string
  weeklyAvg: number
  lastNightAvg: number
  lastNight5MinHigh: number
  status: string
  startTimestampGMT: number | null
  endTimestampGMT: number | null
  startTimestampLocal: number | null
  endTimestampLocal: number | null
  createTimeStamp: number | null
}

/** Training readiness from /metrics-service/metrics/trainingreadiness/{date} */
export interface GarminTrainingReadiness {
  calendarDate: string
  overallScore: number | null
  sleepScore: number | null
  recoveryScore: number | null
  trainingLoadScore: number | null
  hrvScore: number | null
  level: string // e.g. "PRIME", "HIGH", "MODERATE", "LOW"
}

/** Daily intensity minutes from /wellness-service/wellness/daily/im/{date} */
export interface GarminIntensityMinutes {
  calendarDate: string
  weeklyGoal: number
  moderateIntensityMinutes: number
  vigorousIntensityMinutes: number
}

/** Daily user summary from /usersummary-service/usersummary/daily/{displayName} */
export interface GarminDailySummary {
  calendarDate: string
  totalSteps: number
  totalDistanceMeters: number
  floorsAscended: number
  activeKilocalories: number
  totalKilocalories: number
  restingHeartRate: number
  minHeartRate: number
  maxHeartRate: number
  averageStressLevel: number
  maxStressLevel: number
  bodyBatteryHighestValue: number
  bodyBatteryLowestValue: number
  bodyBatteryMostRecentValue: number
  moderateIntensityMinutes: number
  vigorousIntensityMinutes: number
  measurableAwakeDuration: number
  measurableAsleepDuration: number
  averageSpo2: number
  lowestSpo2: number
}

// ============================================================================
// Login result types
// ============================================================================

export interface GarminLoginSuccess {
  success: true
  tokens: IGarminTokens
}

export interface GarminMfaRequired {
  mfa_required: true
}

export type LoginResult = GarminLoginSuccess | GarminMfaRequired

// ============================================================================
// Client factory
// ============================================================================

export interface GarminClientDeps {
  getOAuthToken: typeof getOAuthToken
  upsertOAuthToken: typeof upsertOAuthToken
}

const defaultDeps: GarminClientDeps = { getOAuthToken, upsertOAuthToken }

/**
 * Pending MFA sessions, keyed by user.
 * Holds a live GarminConnect instance between login() and verifyMfa().
 * Entries are cleaned up on completion, timeout, or disconnect.
 */
const pendingMfaSessions = new Map<string, { gc: InstanceType<typeof GarminConnect>; createdAt: number }>()

/** Max time (ms) a pending MFA session is kept before being discarded. */
const MFA_SESSION_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Creates a Garmin Connect API client.
 * Does NOT require any server-side credentials (unlike Oura which needs client/secret).
 */
export const garminClient = (deps: GarminClientDeps = defaultDeps) => {
  /**
   * Restore a GarminConnect instance from stored tokens for a user.
   * Throws if no tokens are stored.
   */
  const restoreSession = async (user: string): Promise<InstanceType<typeof GarminConnect>> => {
    const stored = await deps.getOAuthToken(user, 'garmin')
    if (!stored) throw new Error('User has no Garmin session. Please connect Garmin first.')

    const tokens: IGarminTokens = JSON.parse(stored.access_token)
    const gc = new GarminConnect()
    gc.loadToken(tokens.oauth1, tokens.oauth2)
    return gc
  }

  /** Persist the current GarminConnect session tokens for a user. */
  const saveSession = async (user: string, gc: InstanceType<typeof GarminConnect>): Promise<void> => {
    const tokens = gc.exportToken()
    await deps.upsertOAuthToken(user, {
      access_token: JSON.stringify(tokens),
      provider: 'garmin',
    })
  }

  /** Helper to format a Date as YYYY-MM-DD. */
  const fmt = (d: Date): string => d.toISOString().slice(0, 10)

  return {
    /**
     * Disconnect Garmin by removing stored tokens.
     */
    async disconnect(user: string): Promise<void> {
      // We just remove the OAuth token; there's no server-side session to revoke
      // since we're scraping rather than using an official OAuth flow.
      await deps.upsertOAuthToken(user, {
        access_token: '',
        provider: 'garmin',
      })
    },
    async getActivities(user: string, start: number, limit: number): Promise<unknown[]> {
      const gc = await restoreSession(user)
      const result = await gc.getActivities(start, limit)
      await saveSession(user, gc)
      return result
    },

    async getBodyBattery(user: string, startDate: Date, endDate: Date): Promise<GarminBodyBatteryData[]> {
      const gc = await restoreSession(user)
      const result = await gc.get<GarminBodyBatteryData[]>(
        `/wellness-service/wellness/bodyBattery/reports/daily?startDate=${fmt(startDate)}&endDate=${fmt(endDate)}`,
      )
      await saveSession(user, gc)
      return result
    },

    // ========================================================================
    // Data fetching methods — each restores session, fetches, and returns data
    // ========================================================================

    async getDailySummary(user: string, date: Date): Promise<GarminDailySummary> {
      const gc = await restoreSession(user)
      const profile = await gc.getUserProfile()
      const result = await gc.get<GarminDailySummary>(
        `/usersummary-service/usersummary/daily/${profile.displayName}?calendarDate=${fmt(date)}`,
      )
      await saveSession(user, gc) // persist any refreshed tokens
      return result
    },

    async getHeartRate(user: string, date: Date): Promise<unknown> {
      const gc = await restoreSession(user)
      const result = await gc.getHeartRate(date)
      await saveSession(user, gc)
      return result
    },

    async getHrv(user: string, date: Date): Promise<GarminHrvData> {
      const gc = await restoreSession(user)
      const result = await gc.get<GarminHrvData>(`/hrv-service/hrv/${fmt(date)}`)
      await saveSession(user, gc)
      return result
    },

    async getIntensityMinutes(user: string, date: Date): Promise<GarminIntensityMinutes> {
      const gc = await restoreSession(user)
      const result = await gc.get<GarminIntensityMinutes>(`/wellness-service/wellness/daily/im/${fmt(date)}`)
      await saveSession(user, gc)
      return result
    },

    async getRespiration(user: string, date: Date): Promise<GarminRespirationData> {
      const gc = await restoreSession(user)
      const result = await gc.get<GarminRespirationData>(
        `/wellness-service/wellness/daily/respiration/${fmt(date)}`,
      )
      await saveSession(user, gc)
      return result
    },

    async getSleep(user: string, date: Date): Promise<unknown> {
      const gc = await restoreSession(user)
      const result = await gc.getSleepData(date)
      await saveSession(user, gc)
      return result
    },

    async getSpo2(user: string, date: Date): Promise<GarminSpo2Data> {
      const gc = await restoreSession(user)
      const result = await gc.get<GarminSpo2Data>(`/wellness-service/wellness/daily/spo2/${fmt(date)}`)
      await saveSession(user, gc)
      return result
    },

    async getStress(user: string, date: Date): Promise<GarminStressData> {
      const gc = await restoreSession(user)
      const result = await gc.get<GarminStressData>(`/wellness-service/wellness/dailyStress/${fmt(date)}`)
      await saveSession(user, gc)
      return result
    },

    async getTrainingReadiness(user: string, date: Date): Promise<GarminTrainingReadiness> {
      const gc = await restoreSession(user)
      const result = await gc.get<GarminTrainingReadiness>(
        `/metrics-service/metrics/trainingreadiness/${fmt(date)}`,
      )
      await saveSession(user, gc)
      return result
    },
    /**
     * Login with Garmin credentials. Returns tokens on success or indicates MFA required.
     * Credentials are used only for this call and never stored.
     *
     * When MFA is required, the GarminConnect instance is kept alive in
     * `pendingMfaSessions` so that `verifyMfa()` can complete the flow.
     */
    async login(user: string, email: string, password: string): Promise<LoginResult> {
      // Clean up any stale pending session for this user
      pendingMfaSessions.delete(user)

      console.log(`🔑 Garmin login attempt for user=${user}, email=${email}`)
      const gc = new GarminConnect({ password, username: email })

      let result
      try {
        result = await gc.login()
      } catch (error) {
        console.error(`🔑 Garmin login threw for user=${user}, email=${email}:`, error)
        throw error
      }

      console.log(`🔑 Garmin login result for user=${user}: type=${result.type}`)

      if (result.type === 'success') {
        const tokens = gc.exportToken()
        await saveSession(user, gc)
        return { success: true, tokens }
      }

      // MFA required — park the instance for verifyMfa()
      pendingMfaSessions.set(user, { gc, createdAt: Date.now() })

      // Schedule cleanup so we don't leak memory if verifyMfa() is never called
      setTimeout(() => {
        const entry = pendingMfaSessions.get(user)
        if (entry && entry.createdAt <= Date.now() - MFA_SESSION_TTL_MS) {
          pendingMfaSessions.delete(user)
        }
      }, MFA_SESSION_TTL_MS + 1000)

      return { mfa_required: true }
    },

    /**
     * Complete MFA verification after login() returned { mfa_required: true }.
     *
     * @param user     Aurboda user id
     * @param mfaCode  The code from the user's email/SMS
     */
    async verifyMfa(user: string, mfaCode: string): Promise<GarminLoginSuccess> {
      const entry = pendingMfaSessions.get(user)
      if (!entry) {
        throw new Error('No pending MFA session. Please start login again.')
      }

      if (Date.now() - entry.createdAt > MFA_SESSION_TTL_MS) {
        pendingMfaSessions.delete(user)
        throw new Error('MFA session expired. Please start login again.')
      }

      const { gc } = entry

      await gc.verifyMfa(mfaCode)
      pendingMfaSessions.delete(user)

      const tokens = gc.exportToken()
      await saveSession(user, gc)
      return { success: true, tokens }
    },
  }
}

export type GarminClient = ReturnType<typeof garminClient>
