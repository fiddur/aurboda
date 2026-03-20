/**
 * Oura data processing module.
 *
 * Handles transforming Oura API responses into database records.
 * Separated from oura-sync.ts to keep file sizes manageable.
 */

import type { OuraSleepPeriodRaw, OuraTagWithComment } from './oura.ts'
import type { MetricType } from './schema.ts'

import {
  insertActivity,
  insertRawRecord,
  insertTag,
  insertTimeSeries,
  type TimeSeriesPoint,
  upsertSyncedNote,
} from './db/index.ts'

/** Oura data types that can be synced */
export type OuraDataType =
  | 'dailyCardiovascularAge'
  | 'dailyReadiness'
  | 'dailyResilience'
  | 'dailySleep'
  | 'sessions'
  | 'sleep'
  | 'tags'

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

/** Minimum minutes of actual sleep stages (non-awake) for Oura short sleep to qualify as a nap. */
const NAP_SLEEP_MINUTES_THRESHOLD = 15

/** HC stage number for "awake". */
const HC_STAGE_AWAKE = 1

/**
 * Compute total non-awake sleep time in minutes from HC-encoded sleep stages.
 *
 * Stages use Health Connect encoding where 1 = awake. All other stages
 * (light=4, deep=5, REM=6, sleeping/unknown=2) count as actual sleep.
 */
export const computeSleepMinutes = (stages: SleepStage[]): number =>
  stages.reduce((total, s) => {
    if (s.stage === HC_STAGE_AWAKE) return total
    const ms = new Date(s.endTime).getTime() - new Date(s.startTime).getTime()
    return total + ms / 60_000
  }, 0)

/** Map Oura sleep period type to Aurboda activity type (for non-short-sleep types). */
const OURA_SLEEP_TYPE_MAP: Record<string, 'sleep' | 'meditation'> = {
  long_sleep: 'sleep',
  rest: 'meditation',
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

    const stages = convertOuraSleepPhases(record.sleep_phase_5_min, bedtimeStart)

    // For Oura short sleep (type "sleep"), classify based on actual sleep time:
    // >= 15 min of sleep stages → nap, otherwise → rest.
    const activityType =
      record.type === 'sleep'
        ? computeSleepMinutes(stages) >= NAP_SLEEP_MINUTES_THRESHOLD
          ? 'nap'
          : 'rest'
        : (OURA_SLEEP_TYPE_MAP[record.type] ?? 'sleep')

    const titleMap: Record<string, string> = {
      long_sleep: 'Sleep',
      rest: 'Rest',
    }
    const title =
      record.type === 'sleep'
        ? activityType === 'nap'
          ? 'Nap'
          : 'Rest'
        : (titleMap[record.type] ?? record.type)

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
      title,
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
const processTags = async (user: string, data: OuraTagWithComment[]) => {
  for (const record of data) {
    await insertRawRecord(user, {
      data: record as unknown as Record<string, unknown>,
      external_id: record.external_id,
      record_type: 'enhanced_tag',
      recorded_at: record.start_time,
      source: 'oura',
    })

    const tagId = await insertTag(user, record)

    await upsertSyncedNote(user, 'tag', tagId, 'oura', record.comment, record.start_time, record.end_time)
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
      await processTags(user, data as OuraTagWithComment[])
      break
  }
}
