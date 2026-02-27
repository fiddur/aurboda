/**
 * Oura data sync module.
 *
 * Handles fetching data from Oura API and storing it in the database.
 * Supports incremental sync with rate limit handling.
 */

import { addMinutes, isFuture, subDays } from 'date-fns'
import {
  getSyncState,
  getUserSettings,
  insertActivity,
  insertRawRecord,
  insertTag,
  insertTimeSeries,
  SyncState,
  Tag,
  TimeSeriesPoint,
  upsertSyncState,
} from './db'
import { ouraClient, type OuraSleepPeriodRaw } from './oura'
import { MetricType } from './schema'

/** Oura data types that can be synced */
export type OuraDataType =
  | 'dailyCardiovascularAge'
  | 'dailyReadiness'
  | 'dailyResilience'
  | 'dailySleep'
  | 'sessions'
  | 'sleep'
  | 'tags'

/** Default start date for historical sync (90 days back) */
const DEFAULT_SYNC_HISTORY_DAYS = 90

/** Overlap buffer for incremental syncs to catch retroactive edits (in days). */
const INCREMENTAL_SYNC_OVERLAP_DAYS = 2

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
  if (!syncState?.retry_after) return false
  return syncState.status === 'rate_limited' && isFuture(syncState.retry_after)
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
      external_id: record.id,
      record_type: 'daily_cardiovascular_age',
      recorded_at: time,
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
      external_id: record.id,
      record_type: 'daily_readiness',
      recorded_at: time,
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
      external_id: record.id,
      record_type: 'daily_resilience',
      recorded_at: time,
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
      external_id: record.id,
      record_type: 'daily_sleep',
      recorded_at: time,
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
      external_id: record.id,
      record_type: 'session',
      recorded_at: record.startTime,
      source: 'oura',
    })

    await insertActivity(user, {
      activity_type: 'meditation',
      data: {
        heartRate: record.heartRate,
        hrv: record.hrv,
        mood: record.mood,
        motion: record.motion,
        sessionType: record.type,
      },
      end_time: record.endTime,
      source: 'oura',
      start_time: record.startTime,
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

// ── Oura sleep period processing ─────────────────────────────────────────────

/**
 * Mapping from Oura sleep_phase_5_min digits to Health Connect stage numbers.
 *
 * Oura encoding:  1=deep, 2=light, 3=REM, 4=awake
 * HC encoding:    1=awake, 2=sleeping/unknown, 4=light, 5=deep, 6=REM
 */
const OURA_PHASE_TO_HC_STAGE: Record<string, number> = {
  '1': 5, // deep
  '2': 4, // light
  '3': 6, // REM
  '4': 1, // awake
}

interface SleepStage {
  startTime: string
  endTime: string
  stage: number
}

/**
 * Convert Oura's sleep_phase_5_min string into Health Connect sleep stages.
 *
 * Each character represents a 5-minute epoch starting from bedtimeStart.
 * Consecutive same-stage epochs are merged into a single entry.
 */
export const convertOuraSleepPhases = (phases: string | null, bedtimeStart: Date): SleepStage[] => {
  if (!phases) return []

  const stages: SleepStage[] = []
  const epochMs = 5 * 60 * 1000

  let currentStage: number | null = null
  let stageStart: Date | null = null

  for (let i = 0; i < phases.length; i++) {
    const hcStage = OURA_PHASE_TO_HC_STAGE[phases[i]]
    if (hcStage === undefined) continue // skip unknown digits

    const epochStart = new Date(bedtimeStart.getTime() + i * epochMs)

    if (hcStage !== currentStage) {
      // Close previous stage
      if (currentStage !== null && stageStart !== null) {
        stages.push({
          endTime: epochStart.toISOString(),
          stage: currentStage,
          startTime: stageStart.toISOString(),
        })
      }
      currentStage = hcStage
      stageStart = epochStart
    }
  }

  // Close final stage
  if (currentStage !== null && stageStart !== null) {
    const finalEnd = new Date(bedtimeStart.getTime() + phases.length * epochMs)
    stages.push({
      endTime: finalEnd.toISOString(),
      stage: currentStage,
      startTime: stageStart.toISOString(),
    })
  }

  return stages
}

/** Map Oura sleep period type to Aurboda activity type. */
const OURA_SLEEP_TYPE_MAP: Record<string, 'sleep' | 'nap' | 'meditation'> = {
  long_sleep: 'sleep',
  rest: 'meditation',
  sleep: 'nap',
}

/**
 * Process Oura individual sleep period data (night sleep, naps, rest).
 */
const processSleep = async (user: string, data: OuraSleepPeriodRaw[]) => {
  for (const record of data) {
    const bedtimeStart = new Date(record.bedtime_start)
    const bedtimeEnd = new Date(record.bedtime_end)

    await insertRawRecord(user, {
      data: record as unknown as Record<string, unknown>,
      external_id: record.id,
      record_type: 'sleep',
      recorded_at: bedtimeStart,
      source: 'oura',
    })

    const activityType = OURA_SLEEP_TYPE_MAP[record.type] ?? 'sleep'
    const stages = convertOuraSleepPhases(record.sleep_phase_5_min, bedtimeStart)

    const titleMap: Record<string, string> = {
      long_sleep: 'Sleep',
      rest: 'Rest',
      sleep: 'Nap',
    }

    await insertActivity(user, {
      activity_type: activityType,
      data: {
        averageHeartRate: record.average_heart_rate,
        averageHrv: record.average_hrv,
        lowestHeartRate: record.lowest_heart_rate,
        ouraType: record.type,
        stages,
      },
      end_time: bedtimeEnd,
      source: 'oura',
      start_time: bedtimeStart,
      title: titleMap[record.type] ?? record.type,
    })

    // Extract HR and HRV interval data to time series
    const hrPoints = extractIntervalPoints(bedtimeStart, record.heart_rate ?? undefined, 'heart_rate')
    const hrvPoints = extractIntervalPoints(
      bedtimeStart,
      record.heart_rate_variability ?? undefined,
      'hrv_rmssd',
    )
    const timeSeriesPoints = [...hrPoints, ...hrvPoints]

    if (timeSeriesPoints.length > 0) {
      await insertTimeSeries(user, timeSeriesPoints)
    }
  }
}

/**
 * Process Oura tag data.
 */
const processTags = async (user: string, data: Tag[]) => {
  for (const record of data) {
    await insertRawRecord(user, {
      data: record as unknown as Record<string, unknown>,
      external_id: record.external_id,
      record_type: 'enhanced_tag',
      recorded_at: record.start_time,
      source: 'oura',
    })

    await insertTag(user, record)
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
    case 'sleep':
      await processSleep(user, data as OuraSleepPeriodRaw[])
      break
    case 'tags':
      await processTags(user, data as Tag[])
      break
  }
}

/** Result of a sync operation */
export interface SyncResult {
  data_type: OuraDataType
  records_processed: number
  status: 'success' | 'skipped' | 'error' | 'rate_limited'
  error?: string
  retry_after?: Date
}

/**
 * Sync a single Oura data type.
 */
/* eslint-disable complexity -- TODO: refactor */
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
      data_type: dataType,
      records_processed: 0,
      retry_after: syncState!.retry_after,
      status: 'skipped',
    }
  }

  // Determine date range
  const end = new Date()
  let start: Date

  if (options.fullResync || !syncState?.last_sync_time) {
    start = options.startDate || subDays(end, DEFAULT_SYNC_HISTORY_DAYS)
  } else {
    // Add overlap buffer to catch retroactive edits in Oura
    start = subDays(syncState.last_sync_time, INCREMENTAL_SYNC_OVERLAP_DAYS)
  }

  // Mark as syncing
  await upsertSyncState(user, {
    data_type: dataType,
    provider: 'oura',
    status: 'syncing',
    sync_start_date: start,
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
      case 'sleep':
        data = await oura.getSleep(start, end, accessToken)
        break
      case 'tags': {
        const settings = await getUserSettings(user)
        data = await oura.getTags(start, end, accessToken, settings?.tag_mappings)
        break
      }
    }

    await processOuraData(user, dataType, data)

    // Update sync state on success
    await upsertSyncState(user, {
      data_type: dataType,
      last_sync_time: end,
      provider: 'oura',
      status: 'idle',
    })

    return {
      data_type: dataType,
      records_processed: data.length,
      status: 'success',
    }
  } catch (error: unknown) {
    const axiosError = error as { response?: { status?: number; headers?: Record<string, string> } }

    // Handle rate limiting
    if (axiosError.response?.status === 429) {
      const retryAfter = calculateRetryAfter(axiosError.response.headers?.['retry-after'])
      await upsertSyncState(user, {
        data_type: dataType,
        error_message: 'Rate limited by Oura API',
        provider: 'oura',
        retry_after: retryAfter,
        status: 'rate_limited',
      })

      return {
        data_type: dataType,
        records_processed: 0,
        retry_after: retryAfter,
        status: 'rate_limited',
      }
    }

    // Handle other errors
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    await upsertSyncState(user, {
      data_type: dataType,
      error_message: errorMessage,
      provider: 'oura',
      status: 'error',
    })

    return {
      data_type: dataType,
      error: errorMessage,
      records_processed: 0,
      status: 'error',
    }
  }
}
/* eslint-enable complexity */

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
    'sleep',
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
          data_type: remainingType,
          records_processed: 0,
          retry_after: result.retry_after,
          status: 'skipped',
        })
      }
      break
    }
  }

  return results
}
