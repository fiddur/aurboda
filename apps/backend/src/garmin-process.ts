/**
 * Garmin data processing.
 *
 * Transforms raw Garmin API responses into normalized DB records:
 * raw_records + time_series + activities.
 */

import type { IActivity } from '@flow-js/garmin-connect/dist/garmin/types/activity'
import type { SleepData } from '@flow-js/garmin-connect/dist/garmin/types/sleep'

import type { Activity, Location, RawRecord, TimeSeriesPoint } from './db/types.ts'
import type {
  GarminActivityDetailResponse,
  GarminBodyBatteryData,
  GarminDailySummary,
  GarminHrvData,
  GarminIntensityMinutes,
  GarminRespirationData,
  GarminSpo2Data,
  GarminStressData,
  GarminTrainingReadiness,
} from './garmin.ts'

import {
  deleteGarminActivityWithWrongType,
  insertActivity,
  insertLocations,
  insertRawRecord,
  insertTimeSeries,
  softDeleteLocationRange,
} from './db/index.ts'

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
  deleteGarminActivityWithWrongType: typeof deleteGarminActivityWithWrongType
  insertActivity: typeof insertActivity
  insertLocations: typeof insertLocations
  insertRawRecord: typeof insertRawRecord
  insertTimeSeries: typeof insertTimeSeries
  softDeleteLocationRange: typeof softDeleteLocationRange
}

const defaultDeps: GarminProcessDeps = {
  deleteGarminActivityWithWrongType,
  insertActivity,
  insertLocations,
  insertRawRecord,
  insertTimeSeries,
  softDeleteLocationRange,
}

/** Garmin activity typeKeys that should be mapped to a different activity type name. */
const garminTypeKeyOverrides: Record<string, string> = {
  breathwork: 'meditation',
}

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
    const activityType = garminTypeKeyOverrides[activityTypeKey] ?? activityTypeKey
    const exerciseTitle = act.activityName || activityTypeKey

    // Clean up any existing activity with a different type (handles re-sync after type mapping changes)
    await deps.deleteGarminActivityWithWrongType(user, act.activityId, activityType)

    const activity: Activity = {
      activity_type: activityType,
      data: {
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

// ---------------------------------------------------------------------------
// Activity Detail (per-second metrics from /activity-service/activity/{id}/details)
// ---------------------------------------------------------------------------

interface DetailMetricMapping {
  metric: string
  unit: string
  /** Allow zero and negative values (e.g. elevation, vertical speed). Default: filter <= 0. */
  allowNegative?: boolean
  /** Transform the raw value (e.g. cm → m). */
  transform?: (v: number) => number
}

/** Metrics to extract from activity detail, mapped to our metric names. */
const DETAIL_METRIC_MAP: Record<string, DetailMetricMapping> = {
  directBodyBattery: { metric: 'body_battery', unit: 'score' },
  directCurrentStress: { metric: 'stress_level', unit: 'score' },
  directDoubleCadence: { metric: 'run_cadence', unit: 'spm' },
  directElevation: { allowNegative: true, metric: 'elevation', unit: 'm' },
  directGradeAdjustedSpeed: { metric: 'grade_adjusted_speed', unit: 'm/s' },
  directGroundContactTime: { metric: 'ground_contact_time', unit: 'ms' },
  directHeartRate: { metric: 'heart_rate', unit: 'bpm' },
  directPerformanceCondition: { allowNegative: true, metric: 'performance_condition', unit: 'score' },
  directPower: { metric: 'power', unit: 'W' },
  directRespirationRate: { metric: 'respiratory_rate', unit: 'brpm' },
  directSpeed: { metric: 'speed', unit: 'm/s' },
  directStrideLength: { metric: 'stride_length', transform: (v) => v / 100, unit: 'm' },
  directVerticalOscillation: { metric: 'vertical_oscillation', unit: 'cm' },
  directVerticalRatio: { metric: 'vertical_ratio', unit: 'percent' },
  directVerticalSpeed: { allowNegative: true, metric: 'vertical_speed', unit: 'm/s' },
}

/**
 * Extract a numeric value from a Garmin metric entry.
 * Some values are plain numbers, others are {source, parsedValue} objects.
 */
export const extractNumericValue = (value: unknown): number | null => {
  if (value == null) return null
  if (typeof value === 'number') return value
  if (typeof value === 'object' && 'parsedValue' in (value as Record<string, unknown>)) {
    const parsed = (value as { parsedValue: unknown }).parsedValue
    return typeof parsed === 'number' ? parsed : null
  }
  return null
}

/** Build a map of garminKey → metricsIndex from dynamic metricDescriptors. */
const buildMetricIndexMap = (
  descriptors: GarminActivityDetailResponse['metricDescriptors'],
): Map<string, number> => {
  const map = new Map<string, number>()
  for (const desc of descriptors ?? []) {
    if (desc) map.set(desc.key, desc.metricsIndex)
  }
  return map
}

/** Extract time series points from a single activity detail metrics entry. */
const extractDetailPoints = (
  metrics: unknown[],
  time: Date,
  indexMap: Map<string, number>,
): TimeSeriesPoint[] => {
  const points: TimeSeriesPoint[] = []
  for (const [garminKey, mapping] of Object.entries(DETAIL_METRIC_MAP)) {
    const idx = indexMap.get(garminKey)
    if (idx === undefined) continue
    const raw = extractNumericValue(metrics[idx])
    if (raw == null) continue
    if (!mapping.allowNegative && raw <= 0) continue
    const value = mapping.transform ? mapping.transform(raw) : raw
    points.push({ metric: mapping.metric, source: 'garmin', time, unit: mapping.unit, value })
  }
  return points
}

/** Extract a GPS location point from a detail metrics entry. */
const extractGpsPoint = (metrics: unknown[], time: Date, latIdx: number, lonIdx: number): Location | null => {
  const lat = extractNumericValue(metrics[latIdx])
  const lon = extractNumericValue(metrics[lonIdx])
  if (lat == null || lon == null || (lat === 0 && lon === 0)) return null
  return { lat, lon, source: 'garmin' as const, time }
}

/** GPS downsampling interval in milliseconds (1 point per minute). */
const GPS_DOWNSAMPLE_MS = 60_000

/** Extract GPS locations from geoPolylineDTO (fallback when metrics lack lat/lon). */
const extractPolylineGps = (data: GarminActivityDetailResponse): Location[] => {
  const polyline = data.geoPolylineDTO?.polyline
  if (!polyline?.length) return []

  const gpsPoints: Location[] = []
  let lastTime = 0

  for (const point of polyline) {
    const ts = point.timestampGMT
    if (!ts || ts <= 0) continue
    if (point.lat === 0 && point.lon === 0) continue
    if (ts - lastTime < GPS_DOWNSAMPLE_MS) continue

    gpsPoints.push({ lat: point.lat, lon: point.lon, source: 'garmin' as const, time: new Date(ts) })
    lastTime = ts
  }

  return gpsPoints
}

/** Extract per-second metrics and GPS from activityDetailMetrics, with polyline fallback. */
const extractMetricsAndGps = (
  data: GarminActivityDetailResponse,
): { gpsPoints: Location[]; points: TimeSeriesPoint[] } => {
  const indexMap = buildMetricIndexMap(data.metricDescriptors)
  const tsIdx = indexMap.get('directTimestamp')
  if (tsIdx === undefined) return { gpsPoints: [], points: [] }

  const latIdx = indexMap.get('directLatitude')
  const lonIdx = indexMap.get('directLongitude')

  const points: TimeSeriesPoint[] = []
  const gpsPoints: Location[] = []
  let lastGpsTime = 0

  for (const entry of data.activityDetailMetrics) {
    const ts = extractNumericValue(entry.metrics[tsIdx])
    if (!ts || ts <= 0) continue
    const time = new Date(ts)

    points.push(...extractDetailPoints(entry.metrics, time, indexMap))

    // Extract GPS, downsampled to ~1 point per minute
    if (latIdx !== undefined && lonIdx !== undefined && ts - lastGpsTime >= GPS_DOWNSAMPLE_MS) {
      const gps = extractGpsPoint(entry.metrics, time, latIdx, lonIdx)
      if (gps) {
        gpsPoints.push(gps)
        lastGpsTime = ts
      }
    }
  }

  // Fall back to polyline GPS if per-second metrics didn't include lat/lon
  if (gpsPoints.length === 0) {
    gpsPoints.push(...extractPolylineGps(data))
  }

  return { gpsPoints, points }
}

export const processActivityDetail = async (
  user: string,
  data: GarminActivityDetailResponse,
  deps: GarminProcessDeps = defaultDeps,
): Promise<number> => {
  if (!data.activityDetailMetrics?.length) return 0

  const indexMap = buildMetricIndexMap(data.metricDescriptors)
  const tsIdx = indexMap.get('directTimestamp')
  if (tsIdx === undefined) return 0

  const firstTs = extractNumericValue(data.activityDetailMetrics[0]!.metrics[tsIdx])
  if (!firstTs) return 0

  const { gpsPoints, points } = extractMetricsAndGps(data)

  await deps.insertRawRecord(
    user,
    makeRaw('garmin_activity_detail', `garmin-activity-detail-${data.activityId}`, new Date(firstTs), data),
  )

  if (points.length > 0) await deps.insertTimeSeries(user, points)

  // Batch-insert GPS locations and soft-delete conflicting OwnTracks data
  if (gpsPoints.length > 0) {
    const start = gpsPoints[0].time
    const end = gpsPoints[gpsPoints.length - 1].time
    await deps.softDeleteLocationRange(user, 'owntracks', start, end)
    await deps.insertLocations(user, gpsPoints)
  }

  return points.length
}
