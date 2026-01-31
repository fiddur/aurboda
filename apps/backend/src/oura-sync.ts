/**
 * Oura data sync module.
 *
 * Handles fetching data from Oura API and storing it in the database.
 * Supports incremental sync with rate limit handling.
 */

import { addMinutes, isFuture, subDays } from 'date-fns'
import {
  getSyncState,
  insertActivity,
  insertRawRecord,
  insertTag,
  insertTimeSeries,
  SyncState,
  TimeSeriesPoint,
  upsertSyncState,
} from './db'
import { ouraClient } from './oura'
import { MetricType } from './schema'

/** Oura data types that can be synced */
export type OuraDataType =
  | 'dailyCardiovascularAge'
  | 'dailyReadiness'
  | 'dailyResilience'
  | 'dailySleep'
  | 'sessions'
  | 'tags'

/** Default start date for historical sync (90 days back) */
const DEFAULT_SYNC_HISTORY_DAYS = 90

/** Backoff intervals for rate limiting (in minutes) */
const RATE_LIMIT_BACKOFF = [1, 5, 15, 60]

interface OuraDailyRecord {
  id: string
  timestamp?: string
  day?: string
}

interface OuraCardiovascularAge extends OuraDailyRecord {
  vascular_age: number
}

interface OuraReadiness extends OuraDailyRecord {
  score: number
  temperature_deviation?: number
  temperature_trend_deviation?: number
  contributors?: Record<string, number>
}

interface OuraResilience extends OuraDailyRecord {
  level: string
  contributors?: {
    sleep_recovery?: number
    daytime_recovery?: number
    stress?: number
  }
}

interface OuraSleep extends OuraDailyRecord {
  score: number
  contributors?: {
    deep_sleep?: number
    efficiency?: number
    latency?: number
    rem_sleep?: number
    restfulness?: number
    timing?: number
    total_sleep?: number
  }
}

/** Oura interval-based time series data (HR, HRV, motion) */
interface OuraIntervalData {
  interval: number // interval in seconds
  items: (number | null)[]
}

interface OuraSession {
  id: string
  startTime: Date
  endTime: Date
  type: string
  mood?: string
  heartRate?: OuraIntervalData
  hrv?: OuraIntervalData
  motion?: unknown
}

interface OuraTag {
  startTime: Date
  endTime?: Date
  tag: string
  externalId: string
  source: string
}

/**
 * Calculate retry time based on Retry-After header or exponential backoff.
 */
export const calculateRetryAfter = (retryAfterHeader?: string, attemptCount = 0): Date => {
  if (retryAfterHeader) {
    const seconds = parseInt(retryAfterHeader, 10)
    if (!isNaN(seconds)) {
      return addMinutes(new Date(), Math.ceil(seconds / 60))
    }
  }

  const backoffIndex = Math.min(attemptCount, RATE_LIMIT_BACKOFF.length - 1)
  return addMinutes(new Date(), RATE_LIMIT_BACKOFF[backoffIndex])
}

/**
 * Check if a data type is currently rate limited.
 */
export const isRateLimited = (syncState: SyncState | null): boolean => {
  if (!syncState?.retryAfter) return false
  return syncState.status === 'rate_limited' && isFuture(syncState.retryAfter)
}

/**
 * Process Oura cardiovascular age data.
 */
const processCardiovascularAge = async (user: string, data: OuraCardiovascularAge[]) => {
  const points: TimeSeriesPoint[] = []

  for (const record of data) {
    const time = new Date(record.timestamp || record.day || '')

    await insertRawRecord(user, {
      data: record as unknown as Record<string, unknown>,
      externalId: record.id,
      recordType: 'daily_cardiovascular_age',
      recordedAt: time,
      source: 'oura',
    })

    if (record.vascular_age !== undefined) {
      points.push({
        metric: 'cardiovascular_age',
        source: 'oura',
        time,
        value: record.vascular_age,
      })
    }
  }

  if (points.length > 0) {
    await insertTimeSeries(user, points)
  }
}

/**
 * Process Oura readiness data.
 */
const processReadiness = async (user: string, data: OuraReadiness[]) => {
  const points: TimeSeriesPoint[] = []

  for (const record of data) {
    const time = new Date(record.timestamp || record.day || '')

    await insertRawRecord(user, {
      data: record as unknown as Record<string, unknown>,
      externalId: record.id,
      recordType: 'daily_readiness',
      recordedAt: time,
      source: 'oura',
    })

    if (record.score !== undefined) {
      points.push({
        metric: 'readiness_score',
        source: 'oura',
        time,
        value: record.score,
      })
    }
  }

  if (points.length > 0) {
    await insertTimeSeries(user, points)
  }
}

/**
 * Process Oura resilience data.
 */
const processResilience = async (user: string, data: OuraResilience[]) => {
  const points: TimeSeriesPoint[] = []
  const levelToScore: Record<string, number> = {
    exceptional: 100,
    limited: 25,
    solid: 75,
    strong: 50,
  }

  for (const record of data) {
    const time = new Date(record.timestamp || record.day || '')

    await insertRawRecord(user, {
      data: record as unknown as Record<string, unknown>,
      externalId: record.id,
      recordType: 'daily_resilience',
      recordedAt: time,
      source: 'oura',
    })

    if (record.level && record.level in levelToScore) {
      points.push({
        metric: 'resilience_score',
        source: 'oura',
        time,
        value: levelToScore[record.level],
      })
    }
  }

  if (points.length > 0) {
    await insertTimeSeries(user, points)
  }
}

/** Mapping from Oura sleep contributor names to our metric types */
const sleepContributorMetricMap: Record<string, MetricType> = {
  deep_sleep: 'sleep_deep_score',
  efficiency: 'sleep_efficiency',
  latency: 'sleep_latency',
  rem_sleep: 'sleep_rem_score',
  restfulness: 'sleep_restfulness',
  timing: 'sleep_timing',
  total_sleep: 'sleep_total_score',
}

/**
 * Process Oura daily sleep data.
 */
const processDailySleep = async (user: string, data: OuraSleep[]) => {
  const points: TimeSeriesPoint[] = []

  for (const record of data) {
    const time = new Date(record.timestamp || record.day || '')

    await insertRawRecord(user, {
      data: record as unknown as Record<string, unknown>,
      externalId: record.id,
      recordType: 'daily_sleep',
      recordedAt: time,
      source: 'oura',
    })

    if (record.score !== undefined) {
      points.push({
        metric: 'sleep_score',
        source: 'oura',
        time,
        value: record.score,
      })
    }

    // Extract sleep contributors as separate metrics
    if (record.contributors) {
      for (const [key, value] of Object.entries(record.contributors)) {
        const metric = sleepContributorMetricMap[key]
        if (metric && value !== undefined) {
          points.push({
            metric,
            source: 'oura',
            time,
            value,
          })
        }
      }
    }
  }

  if (points.length > 0) {
    await insertTimeSeries(user, points)
  }
}

/**
 * Extract time series points from Oura interval-based data.
 */
const extractIntervalPoints = (
  startTime: Date,
  intervalData: OuraIntervalData | undefined,
  metric: MetricType,
): TimeSeriesPoint[] => {
  if (!intervalData?.items) return []

  const points: TimeSeriesPoint[] = []
  const intervalMs = intervalData.interval * 1000

  for (let i = 0; i < intervalData.items.length; i++) {
    const value = intervalData.items[i]
    if (value !== null) {
      points.push({
        metric,
        source: 'oura',
        time: new Date(startTime.getTime() + i * intervalMs),
        value,
      })
    }
  }

  return points
}

/**
 * Process Oura session data (meditation).
 */
const processSessions = async (user: string, data: OuraSession[]) => {
  for (const record of data) {
    await insertRawRecord(user, {
      data: record as unknown as Record<string, unknown>,
      externalId: record.id,
      recordType: 'session',
      recordedAt: record.startTime,
      source: 'oura',
    })

    await insertActivity(user, {
      activityType: 'meditation',
      data: {
        heartRate: record.heartRate,
        hrv: record.hrv,
        mood: record.mood,
        motion: record.motion,
        sessionType: record.type,
      },
      endTime: record.endTime,
      source: 'oura',
      startTime: record.startTime,
      title: record.type,
    })

    // Extract HR and HRV samples to time series
    const hrPoints = extractIntervalPoints(record.startTime, record.heartRate, 'heart_rate')
    const hrvPoints = extractIntervalPoints(record.startTime, record.hrv, 'hrv_rmssd')
    const timeSeriesPoints = [...hrPoints, ...hrvPoints]

    if (timeSeriesPoints.length > 0) {
      await insertTimeSeries(user, timeSeriesPoints)
    }
  }
}

/**
 * Process Oura tag data.
 */
const processTags = async (user: string, data: OuraTag[]) => {
  for (const record of data) {
    await insertRawRecord(user, {
      data: record as unknown as Record<string, unknown>,
      externalId: record.externalId,
      recordType: 'enhanced_tag',
      recordedAt: record.startTime,
      source: 'oura',
    })

    await insertTag(user, {
      endTime: record.endTime,
      externalId: record.externalId,
      source: 'oura',
      startTime: record.startTime,
      tag: record.tag,
    })
  }
}

/**
 * Process Oura data and store in database.
 *
 * @param user - The user identifier
 * @param dataType - The type of Oura data being processed
 * @param data - Array of Oura records
 */
export const processOuraData = async (
  user: string,
  dataType: OuraDataType,
  data: unknown[],
): Promise<void> => {
  if (!data || data.length === 0) return

  switch (dataType) {
    case 'dailyCardiovascularAge':
      await processCardiovascularAge(user, data as OuraCardiovascularAge[])
      break
    case 'dailyReadiness':
      await processReadiness(user, data as OuraReadiness[])
      break
    case 'dailyResilience':
      await processResilience(user, data as OuraResilience[])
      break
    case 'dailySleep':
      await processDailySleep(user, data as OuraSleep[])
      break
    case 'sessions':
      await processSessions(user, data as OuraSession[])
      break
    case 'tags':
      await processTags(user, data as OuraTag[])
      break
  }
}

/** Result of a sync operation */
export interface SyncResult {
  dataType: OuraDataType
  recordsProcessed: number
  status: 'success' | 'skipped' | 'error' | 'rate_limited'
  error?: string
  retryAfter?: Date
}

/**
 * Sync a single Oura data type.
 */
export const syncOuraDataType = async (
  user: string,
  oura: ReturnType<typeof ouraClient>,
  dataType: OuraDataType,
  accessToken: string,
  options: { fullResync?: boolean; startDate?: Date } = {},
): Promise<SyncResult> => {
  // Check current sync state
  const syncState = await getSyncState(user, 'oura', dataType)

  // Skip if rate limited
  if (isRateLimited(syncState)) {
    return {
      dataType,
      recordsProcessed: 0,
      retryAfter: syncState!.retryAfter,
      status: 'skipped',
    }
  }

  // Determine date range
  const end = new Date()
  let start: Date

  if (options.fullResync || !syncState?.lastSyncTime) {
    start = options.startDate || subDays(end, DEFAULT_SYNC_HISTORY_DAYS)
  } else {
    start = syncState.lastSyncTime
  }

  // Mark as syncing
  await upsertSyncState(user, {
    dataType,
    provider: 'oura',
    status: 'syncing',
    syncStartDate: start,
  })

  try {
    let data: unknown[]

    switch (dataType) {
      case 'dailyCardiovascularAge':
        data = await oura.getDailyCardiovascularAge(start, end, accessToken)
        break
      case 'dailyReadiness':
        data = await oura.getDailyReadiness(start, end, accessToken)
        break
      case 'dailyResilience':
        data = await oura.getDailyResilience(start, end, accessToken)
        break
      case 'dailySleep':
        data = await oura.getDailySleep(start, end, accessToken)
        break
      case 'sessions':
        data = await oura.getSessions(start, end, accessToken)
        break
      case 'tags':
        data = await oura.getTags(start, end, accessToken)
        break
    }

    await processOuraData(user, dataType, data)

    // Update sync state on success
    await upsertSyncState(user, {
      dataType,
      lastSyncTime: end,
      provider: 'oura',
      status: 'idle',
    })

    return {
      dataType,
      recordsProcessed: data.length,
      status: 'success',
    }
  } catch (error: unknown) {
    const axiosError = error as { response?: { status?: number; headers?: Record<string, string> } }

    // Handle rate limiting
    if (axiosError.response?.status === 429) {
      const retryAfter = calculateRetryAfter(axiosError.response.headers?.['retry-after'])
      await upsertSyncState(user, {
        dataType,
        errorMessage: 'Rate limited by Oura API',
        provider: 'oura',
        retryAfter,
        status: 'rate_limited',
      })

      return {
        dataType,
        recordsProcessed: 0,
        retryAfter,
        status: 'rate_limited',
      }
    }

    // Handle other errors
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    await upsertSyncState(user, {
      dataType,
      errorMessage,
      provider: 'oura',
      status: 'error',
    })

    return {
      dataType,
      error: errorMessage,
      recordsProcessed: 0,
      status: 'error',
    }
  }
}

/**
 * Sync all Oura data types.
 */
export const syncAllOuraData = async (
  user: string,
  oura: ReturnType<typeof ouraClient>,
  options: { fullResync?: boolean; startDate?: Date } = {},
): Promise<SyncResult[]> => {
  const accessToken = await oura.getAccessToken(user)
  const dataTypes: OuraDataType[] = [
    'dailyCardiovascularAge',
    'dailyReadiness',
    'dailyResilience',
    'dailySleep',
    'sessions',
    'tags',
  ]

  const results: SyncResult[] = []

  for (const dataType of dataTypes) {
    const result = await syncOuraDataType(user, oura, dataType, accessToken, options)
    results.push(result)

    // Stop if we hit rate limiting to avoid more 429s
    if (result.status === 'rate_limited') {
      // Mark remaining types as skipped
      const remaining = dataTypes.slice(dataTypes.indexOf(dataType) + 1)
      for (const remainingType of remaining) {
        results.push({
          dataType: remainingType,
          recordsProcessed: 0,
          retryAfter: result.retryAfter,
          status: 'skipped',
        })
      }
      break
    }
  }

  return results
}
