/**
 * Garmin data processing.
 *
 * Transforms raw Garmin API responses into normalized DB records:
 * raw_records + time_series + activities.
 */

import type { IActivity } from '@flow-js/garmin-connect/dist/garmin/types/activity'
import type { SleepData } from '@flow-js/garmin-connect/dist/garmin/types/sleep'

import type { Activity, RawRecord, TimeSeriesPoint } from './db/types.ts'
import type {
  GarminBodyBatteryData,
  GarminDailySummary,
  GarminHrvData,
  GarminIntensityMinutes,
  GarminRespirationData,
  GarminSpo2Data,
  GarminStressData,
  GarminTrainingReadiness,
} from './garmin.ts'

import { insertActivity, insertRawRecord, insertTimeSeries } from './db/index.ts'

// ============================================================================
// Types
// ============================================================================

export type GarminDataType =
  | 'dailySummary'
  | 'heartRate'
  | 'hrv'
  | 'sleep'
  | 'stress'
  | 'bodyBattery'
  | 'activities'
  | 'spo2'
  | 'respiration'
  | 'trainingReadiness'
  | 'intensityMinutes'

export const garminDataTypes: GarminDataType[] = [
  'dailySummary',
  'heartRate',
  'hrv',
  'sleep',
  'stress',
  'bodyBattery',
  'activities',
  'spo2',
  'respiration',
  'trainingReadiness',
  'intensityMinutes',
]

// ============================================================================
// Processing dependencies (for testability)
// ============================================================================

export interface GarminProcessDeps {
  insertRawRecord: typeof insertRawRecord
  insertTimeSeries: typeof insertTimeSeries
  insertActivity: typeof insertActivity
}

const defaultDeps: GarminProcessDeps = { insertActivity, insertRawRecord, insertTimeSeries }

// ============================================================================
// Main dispatcher
// ============================================================================

export const processGarminData = async (
  user: string,
  dataType: GarminDataType,
  data: unknown,
  deps: GarminProcessDeps = defaultDeps,
): Promise<number> => {
  if (data == null) return 0

  switch (dataType) {
    case 'dailySummary':
      return processDailySummary(user, data as GarminDailySummary, deps)
    case 'heartRate':
      return processHeartRate(user, data, deps)
    case 'hrv':
      return processHrv(user, data as GarminHrvData, deps)
    case 'sleep':
      return processSleep(user, data as SleepData, deps)
    case 'stress':
      return processStress(user, data as GarminStressData, deps)
    case 'bodyBattery':
      return processBodyBattery(user, data as GarminBodyBatteryData[], deps)
    case 'activities':
      return processActivities(user, data as IActivity[], deps)
    case 'spo2':
      return processSpo2(user, data as GarminSpo2Data, deps)
    case 'respiration':
      return processRespiration(user, data as GarminRespirationData, deps)
    case 'trainingReadiness':
      return processTrainingReadiness(user, data as GarminTrainingReadiness, deps)
    case 'intensityMinutes':
      return processIntensityMinutes(user, data as GarminIntensityMinutes, deps)
  }
}

// ============================================================================
// Per-type processors
// ============================================================================

/** Parse a Garmin calendar date (YYYY-MM-DD) to a Date at noon UTC (avoids timezone issues). */
const dateAt = (calendarDate: string, hour = 12): Date => {
  const [y, m, d] = calendarDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, hour, 0, 0))
}

const makeRaw = (recordType: string, externalId: string, recordedAt: Date, data: unknown): RawRecord => ({
  data: data as Record<string, unknown>,
  external_id: externalId,
  record_type: recordType,
  recorded_at: recordedAt,
  source: 'garmin',
})

// ---------------------------------------------------------------------------
// Daily Summary
// ---------------------------------------------------------------------------
const processDailySummary = async (
  user: string,
  data: GarminDailySummary,
  deps: GarminProcessDeps,
): Promise<number> => {
  if (!data?.calendarDate) return 0

  const time = dateAt(data.calendarDate)
  await deps.insertRawRecord(
    user,
    makeRaw('garmin_daily_summary', `garmin-summary-${data.calendarDate}`, time, data),
  )

  const points: TimeSeriesPoint[] = []
  const add = (metric: string, value: number | null | undefined, unit: string) => {
    if (value != null && value > 0) points.push({ metric, source: 'garmin', time, unit, value })
  }

  add('steps', data.totalSteps, 'count')
  add('distance', data.totalDistanceMeters, 'm')
  add('floors_climbed', data.floorsAscended, 'count')
  add('calories_active', data.activeKilocalories, 'kcal')
  add('calories_total', data.totalKilocalories, 'kcal')
  add('resting_heart_rate', data.restingHeartRate, 'bpm')
  add('stress_level', data.averageStressLevel, 'score')
  add('spo2', data.averageSpo2, 'percent')

  if (points.length > 0) await deps.insertTimeSeries(user, points)
  return 1
}

// ---------------------------------------------------------------------------
// Heart Rate
// ---------------------------------------------------------------------------

/** Flatten a single HR entry (which may be nested) into [timestamp, value] pairs. */
const flattenHrEntry = (entry: unknown[]): [number, number][] => {
  if (!Array.isArray(entry) || entry.length < 2) return []
  const flat = Array.isArray(entry[0]) ? entry : [entry]
  return (flat as [number, number][]).filter(([ts, value]) => ts && value && value > 0)
}

const processHeartRate = async (user: string, data: unknown, deps: GarminProcessDeps): Promise<number> => {
  const hr = data as {
    calendarDate?: string
    restingHeartRate?: number
    heartRateValues?: [number, number][][] | null
  }
  if (!hr?.calendarDate) return 0

  const time = dateAt(hr.calendarDate)
  await deps.insertRawRecord(user, makeRaw('garmin_heart_rate', `garmin-hr-${hr.calendarDate}`, time, data))

  const points: TimeSeriesPoint[] = (hr.heartRateValues ?? []).flatMap(flattenHrEntry).map(([ts, value]) => ({
    metric: 'heart_rate' as const,
    source: 'garmin' as const,
    time: new Date(ts),
    unit: 'bpm',
    value,
  }))

  if (points.length > 0) await deps.insertTimeSeries(user, points)
  return points.length > 0 ? 1 : 0
}

// ---------------------------------------------------------------------------
// HRV
// ---------------------------------------------------------------------------
const processHrv = async (user: string, data: GarminHrvData, deps: GarminProcessDeps): Promise<number> => {
  if (!data?.calendarDate) return 0

  const time = dateAt(data.calendarDate)
  await deps.insertRawRecord(user, makeRaw('garmin_hrv', `garmin-hrv-${data.calendarDate}`, time, data))

  const points: TimeSeriesPoint[] = []
  if (data.lastNightAvg > 0) {
    points.push({ metric: 'hrv_rmssd', source: 'garmin', time, unit: 'ms', value: data.lastNightAvg })
  }

  if (points.length > 0) await deps.insertTimeSeries(user, points)
  return 1
}

// ---------------------------------------------------------------------------
// Sleep
// ---------------------------------------------------------------------------

/** Build a sleep activity record from the daily sleep DTO. */
const buildSleepActivity = (dto: SleepData['dailySleepDTO']): Activity | null => {
  const startTime = dto.sleepStartTimestampGMT ? new Date(dto.sleepStartTimestampGMT) : null
  const endTime = dto.sleepEndTimestampGMT ? new Date(dto.sleepEndTimestampGMT) : null
  if (!startTime || !endTime) return null

  return {
    activity_type: 'sleep',
    data: {
      awake_seconds: dto.awakeSleepSeconds,
      deep_sleep_seconds: dto.deepSleepSeconds,
      light_sleep_seconds: dto.lightSleepSeconds,
      rem_sleep_seconds: dto.remSleepSeconds,
      sleep_score: dto.sleepScores?.overall?.value,
    },
    end_time: endTime,
    source: 'garmin',
    start_time: startTime,
    title: 'Sleep',
  }
}

/** Extract time series points from sleep data (score, HR, HRV, sleep HR samples). */
const buildSleepTimeSeries = (data: SleepData, time: Date): TimeSeriesPoint[] => {
  const dto = data.dailySleepDTO
  const points: TimeSeriesPoint[] = []

  if (dto.sleepScores?.overall?.value) {
    points.push({
      metric: 'sleep_score',
      source: 'garmin',
      time,
      unit: 'score',
      value: dto.sleepScores.overall.value,
    })
  }
  if (data.restingHeartRate > 0) {
    points.push({
      metric: 'resting_heart_rate',
      source: 'garmin',
      time,
      unit: 'bpm',
      value: data.restingHeartRate,
    })
  }
  if (data.avgOvernightHrv > 0) {
    points.push({ metric: 'hrv_rmssd', source: 'garmin', time, unit: 'ms', value: data.avgOvernightHrv })
  }
  if (data.sleepHeartRate?.length) {
    for (const hr of data.sleepHeartRate) {
      if (hr.value > 0 && hr.startGMT) {
        points.push({
          metric: 'heart_rate',
          source: 'garmin',
          time: new Date(hr.startGMT),
          unit: 'bpm',
          value: hr.value,
        })
      }
    }
  }

  return points
}

const processSleep = async (user: string, data: SleepData, deps: GarminProcessDeps): Promise<number> => {
  const dto = data?.dailySleepDTO
  if (!dto?.calendarDate) return 0

  const time = dateAt(dto.calendarDate)
  await deps.insertRawRecord(user, makeRaw('garmin_sleep', `garmin-sleep-${dto.calendarDate}`, time, data))

  const activity = buildSleepActivity(dto)
  if (activity) await deps.insertActivity(user, activity)

  const points = buildSleepTimeSeries(data, time)
  if (points.length > 0) await deps.insertTimeSeries(user, points)
  return 1
}

// ---------------------------------------------------------------------------
// Stress
// ---------------------------------------------------------------------------
const processStress = async (
  user: string,
  data: GarminStressData,
  deps: GarminProcessDeps,
): Promise<number> => {
  if (!data?.calendarDate) return 0

  const time = dateAt(data.calendarDate)
  await deps.insertRawRecord(user, makeRaw('garmin_stress', `garmin-stress-${data.calendarDate}`, time, data))

  // Prefer granular time-series data from stressValuesArray
  const points: TimeSeriesPoint[] = (data.stressValuesArray ?? [])
    .filter(([ts, value]) => ts && value > 0)
    .map(([ts, value]) => ({
      metric: 'stress_level' as const,
      source: 'garmin' as const,
      time: new Date(ts),
      unit: 'score',
      value,
    }))

  // Fall back to daily average if no granular data
  if (points.length === 0 && data.overallStressLevel > 0) {
    points.push({
      metric: 'stress_level',
      source: 'garmin',
      time,
      unit: 'score',
      value: data.overallStressLevel,
    })
  }

  if (points.length > 0) await deps.insertTimeSeries(user, points)
  return 1
}

// ---------------------------------------------------------------------------
// Body Battery
// ---------------------------------------------------------------------------
const processBodyBattery = async (
  user: string,
  data: GarminBodyBatteryData[],
  deps: GarminProcessDeps,
): Promise<number> => {
  if (!Array.isArray(data) || data.length === 0) return 0

  let count = 0
  for (const day of data) {
    if (!day?.date) continue

    const time = dateAt(day.date)
    await deps.insertRawRecord(user, makeRaw('garmin_body_battery', `garmin-bb-${day.date}`, time, day))

    const points: TimeSeriesPoint[] = []

    // Insert time-series points from the body battery values array
    if (day.bodyBatteryValuesArray?.length) {
      for (const [ts, value] of day.bodyBatteryValuesArray) {
        if (ts && value != null && value >= 0) {
          points.push({ metric: 'body_battery', source: 'garmin', time: new Date(ts), unit: 'score', value })
        }
      }
    }

    // If no detailed data, use a daily snapshot from charged/drained
    if (points.length === 0 && day.charged > 0) {
      points.push({ metric: 'body_battery', source: 'garmin', time, unit: 'score', value: day.charged })
    }

    if (points.length > 0) await deps.insertTimeSeries(user, points)
    count++
  }
  return count
}

// ---------------------------------------------------------------------------
// Activities (exercise)
// ---------------------------------------------------------------------------
const processActivities = async (
  user: string,
  data: IActivity[],
  deps: GarminProcessDeps,
): Promise<number> => {
  if (!Array.isArray(data) || data.length === 0) return 0

  let count = 0
  for (const act of data) {
    if (!act?.activityId) continue

    const externalId = `garmin-activity-${act.activityId}`
    const startTime = new Date(act.startTimeGMT || act.beginTimestamp)
    const durationMs = (act.duration || act.elapsedDuration || 0) * 1000
    const endTime = new Date(startTime.getTime() + durationMs)

    await deps.insertRawRecord(user, makeRaw('garmin_activity', externalId, startTime, act))

    const activityTypeKey = act.activityType?.typeKey ?? 'unknown'
    const exerciseTitle = act.activityName || activityTypeKey

    const activity: Activity = {
      activity_type: 'exercise',
      data: {
        activity_type_key: activityTypeKey,
        average_hr: act.averageHR,
        calories: act.calories,
        distance: act.distance,
        elevation_gain: act.elevationGain,
        garmin_activity_id: act.activityId,
        max_hr: act.maxHR,
        steps: act.steps,
        vo2_max: act.vO2MaxValue,
      },
      end_time: endTime,
      source: 'garmin',
      start_time: startTime,
      title: exerciseTitle,
    }
    await deps.insertActivity(user, activity)

    // Time series from activity summary
    const points: TimeSeriesPoint[] = []
    if (act.vO2MaxValue > 0) {
      points.push({
        metric: 'vo2_max',
        source: 'garmin',
        time: startTime,
        unit: 'mL/kg/min',
        value: act.vO2MaxValue,
      })
    }

    if (points.length > 0) await deps.insertTimeSeries(user, points)
    count++
  }
  return count
}

// ---------------------------------------------------------------------------
// SpO2
// ---------------------------------------------------------------------------
const processSpo2 = async (user: string, data: GarminSpo2Data, deps: GarminProcessDeps): Promise<number> => {
  if (!data?.calendarDate) return 0

  const time = dateAt(data.calendarDate)
  await deps.insertRawRecord(user, makeRaw('garmin_spo2', `garmin-spo2-${data.calendarDate}`, time, data))

  const points: TimeSeriesPoint[] = []
  if (data.averageSpO2 > 0) {
    points.push({ metric: 'spo2', source: 'garmin', time, unit: 'percent', value: data.averageSpO2 })
  }

  if (points.length > 0) await deps.insertTimeSeries(user, points)
  return 1
}

// ---------------------------------------------------------------------------
// Respiration
// ---------------------------------------------------------------------------
const processRespiration = async (
  user: string,
  data: GarminRespirationData,
  deps: GarminProcessDeps,
): Promise<number> => {
  if (!data?.calendarDate) return 0

  const time = dateAt(data.calendarDate)
  await deps.insertRawRecord(
    user,
    makeRaw('garmin_respiration', `garmin-resp-${data.calendarDate}`, time, data),
  )

  const points: TimeSeriesPoint[] = []
  if (data.avgWakingRespirationValue > 0) {
    points.push({
      metric: 'respiratory_rate',
      source: 'garmin',
      time,
      unit: 'brpm',
      value: data.avgWakingRespirationValue,
    })
  }

  if (points.length > 0) await deps.insertTimeSeries(user, points)
  return 1
}

// ---------------------------------------------------------------------------
// Training Readiness
// ---------------------------------------------------------------------------
const processTrainingReadiness = async (
  user: string,
  data: GarminTrainingReadiness,
  deps: GarminProcessDeps,
): Promise<number> => {
  if (!data?.calendarDate) return 0

  const time = dateAt(data.calendarDate)
  await deps.insertRawRecord(
    user,
    makeRaw('garmin_training_readiness', `garmin-tr-${data.calendarDate}`, time, data),
  )

  const points: TimeSeriesPoint[] = []
  if (data.overallScore != null && data.overallScore > 0) {
    points.push({
      metric: 'training_readiness',
      source: 'garmin',
      time,
      unit: 'score',
      value: data.overallScore,
    })
  }

  if (points.length > 0) await deps.insertTimeSeries(user, points)
  return 1
}

// ---------------------------------------------------------------------------
// Intensity Minutes
// ---------------------------------------------------------------------------
const processIntensityMinutes = async (
  user: string,
  data: GarminIntensityMinutes,
  deps: GarminProcessDeps,
): Promise<number> => {
  if (!data?.calendarDate) return 0

  const time = dateAt(data.calendarDate)
  await deps.insertRawRecord(
    user,
    makeRaw('garmin_intensity_minutes', `garmin-im-${data.calendarDate}`, time, data),
  )

  const totalMinutes = (data.moderateIntensityMinutes ?? 0) + (data.vigorousIntensityMinutes ?? 0) * 2
  const points: TimeSeriesPoint[] = []
  if (totalMinutes > 0) {
    points.push({ metric: 'intensity_minutes', source: 'garmin', time, unit: 'min', value: totalMinutes })
  }

  if (points.length > 0) await deps.insertTimeSeries(user, points)
  return 1
}
