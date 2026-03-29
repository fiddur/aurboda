/* eslint-disable max-lines -- TODO: refactor - extract helpers */
/**
 * Query services for health data.
 *
 * These functions contain the business logic for querying health data.
 * They are used by both the MCP tools and the REST API.
 */

import {
  getExerciseTypeName,
  type CustomMetricDefinition,
  type DataSource,
  type ExerciseTypeName,
} from '@aurboda/api-spec'
import { Temporal } from '@js-temporal/polyfill'

import {
  getActivities,
  getDailyAggregates,
  getDailyAggregateValue,
  getDistinctMetrics,
  getMeals,
  getNotesByEntityIds,
  getNotesForTimeRange,
  getProductivity,
  getSleepSessions,
  getTags,
  getTimeSeries,
  getTimeSeriesBucketed,
  getTimeSeriesMultiMetric,
  getTimeSeriesStats,
  getTimeSeriesWithSource,
  type ProductivityRecord,
} from '../db/index.ts'
import {
  type ActivityType,
  getMetricAggregation,
  getMetricUnit,
  isContextualHrvMetric,
  isHrZoneMetric,
  type MetricType,
  metricUnits,
} from '../schema.ts'
import { classifyHrvByContext, getHrvContextWindows, type HrvContext } from './hrv-context.ts'
import { getPlaceVisits, type PlaceVisit } from './locations.ts'
import { computeHrZoneSecs, getEffectiveHrZones, type HrZoneSecs, type HrZoneThresholds } from './settings.ts'
import { computeSleepMinutes } from './sleep-duration.ts'

// ============================================================================
// Types
// ============================================================================

/**
 * Provider for auto-syncing data from external sources before queries.
 * Pass this to query functions to enable automatic data refresh.
 */
export interface SyncProvider {
  /** Sync Oura data if stale (tags, sessions, etc.) */
  syncOuraIfNeeded: (user: string, dataType: 'tags' | 'sessions') => Promise<void>
  /** Sync Garmin data if stale */
  syncGarminIfNeeded: (user: string, dataType: string) => Promise<void>
  /** Sync RescueTime productivity data if stale */
  syncRescueTimeIfNeeded: (user: string) => Promise<void>
  /** Sync calendar data if stale */
  syncCalendarsIfNeeded: (user: string) => Promise<void>
  /** Sync Last.fm scrobbles if stale */
  syncLastFmIfNeeded: (user: string) => Promise<void>
}

export interface MetricDataPoint {
  source?: string
  time: string
  value: number
}

export interface QueryMetricsResult {
  metric: string
  unit: string
  count: number
  data: MetricDataPoint[]
}

/**
 * Bucket size string in {number}{unit} format (e.g., '5m', '10s', '1h', '1d', '1M').
 */
export type BucketSize = string

/**
 * Bucket statistics for a single metric.
 */
export interface BucketMetricStats {
  avg: number
  min: number
  max: number
  count: number
  sum?: number
}

/**
 * A single time bucket with aggregated metrics.
 */
export interface MetricBucket {
  start: string
  end: string
  metrics: Partial<Record<MetricType, BucketMetricStats>>
}

/**
 * Result of a bucketed metrics query.
 */
export interface QueryMetricsBucketedResult {
  start: string
  end: string
  bucket: BucketSize
  buckets: MetricBucket[]
}

export interface HeartRateStats {
  min: number
  max: number
  avg: number
  count: number
}

export interface SessionSummary {
  start_time: string
  end_time?: string
  duration?: number // minutes
  title?: string
  exercise_type?: ExerciseTypeName
  hr_zone_secs?: HrZoneSecs
}

export interface SleepLocation {
  name: string
  source: 'named' | 'detected' | 'owntracks' | 'unknown'
  lat?: number
  lon?: number
}

export interface SleepStageSummary {
  awake_min?: number
  light_min?: number
  deep_min?: number
  rem_min?: number
}

export interface SleepSessionSummary {
  start_time: string
  end_time?: string
  duration?: number // minutes (actual sleep time or time in bed)
  time_in_bed?: number // minutes
  total_sleep?: number // minutes (from sleep stage data)
  sleep_date?: string // YYYY-MM-DD — the date this sleep "belongs to" (wake-up convention)
  sleep_location?: SleepLocation
  sleep_stages?: SleepStageSummary
}

export interface TagSummary {
  id?: string
  external_id?: string
  tag: string
  start_time: string
  end_time?: string
  source?: DataSource
  comments: CommentSummary[]
}

export interface PlaceSummary {
  name: string
  start_time: string
  end_time: string
  duration: number // minutes
  source: 'named' | 'detected' | 'owntracks' | 'unknown'
  lat?: number
  lon?: number
  address?: string
  detected_location_id?: string
}

export interface ProductivitySummary {
  total_duration_sec: number
  productive_sec: number
  very_productive_sec: number
  distracting_sec: number
}

export interface OuraScores {
  sleep_score: number | null
  readiness_score: number | null
  resilience_score: number | null
  cardiovascular_age: number | null
}

export interface MealSummary {
  time: string
  meal_type?: string
  name?: string
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
  fiber?: number
  food_items?: string[]
}

export interface DailySummaryResult {
  date: string
  heart_rate: HeartRateStats | null
  meals: MealSummary[]
  notes: NoteSummary[]
  steps: { total: number }
  primary_sleep: SleepSessionSummary | null
  evening_sleep: SleepSessionSummary | null
  sleep_sessions: SleepSessionSummary[]
  exercise_sessions: SessionSummary[]
  tags: TagSummary[]
  productivity: ProductivitySummary | null
  places: PlaceSummary[]
  oura_scores: OuraScores | null
}

export interface PeriodMetricStats {
  metric: string
  unit: string
  count: number
  min: number
  max: number
  avg: number
  stddev: number
  trend_per_day: number | null
  change_from_previous_period_percent: number | null
  completeness_percent: number
  outliers?: { type: 'high' | 'low'; value: number }[]
}

export interface PeriodSummaryResult {
  start: string
  end: string
  period_days: number
  metrics: PeriodMetricStats[]
}

export interface CommentSummary {
  id: string
  content: string
  start_time?: string
  end_time?: string
  created_at: string
  updated_at: string
}

export interface NoteSummary {
  id: string
  entity_type: 'activity' | 'tag' | 'productivity' | 'metric' | 'report'
  entity_id: string
  content: string
  start_time?: string
  end_time?: string
  created_at: string
  updated_at: string
}

const getCommentsMap = async (
  user: string,
  entityType: 'activity' | 'tag' | 'productivity' | 'metric',
  ids: string[],
): Promise<Map<string, CommentSummary[]>> => {
  const notesMap = await getNotesByEntityIds(user, entityType, ids)
  const result = new Map<string, CommentSummary[]>()
  for (const [entityId, notes] of notesMap) {
    result.set(
      entityId,
      notes.map((n) => ({
        content: n.content,
        created_at: n.created_at.toISOString(),
        end_time: n.end_time?.toISOString(),
        id: n.id,
        start_time: n.start_time?.toISOString(),
        updated_at: n.updated_at.toISOString(),
      })),
    )
  }
  return result
}

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Query time series data for a single metric.
 * Supports both built-in and custom metrics via the customMetrics parameter.
 *
 * Supports contextual HRV metrics (hrv_sleep, hrv_activity, hrv_awake) which
 * are computed by filtering hrv_rmssd data by overlapping sleep/activity windows.
 */
export async function queryMetrics(
  user: string,
  metric: string,
  start: Date,
  end: Date,
  customMetrics: CustomMetricDefinition[] = [],
): Promise<QueryMetricsResult> {
  const unit = getMetricUnit(metric, customMetrics) ?? metricUnits[metric as MetricType] ?? ''

  // Handle contextual HRV metrics
  if (isContextualHrvMetric(metric as MetricType)) {
    const data = await getContextualHrvData(user, metric as MetricType, start, end)
    return {
      count: data.length,
      data: data.map(([time, value]) => ({ time: time.toISOString(), value })),
      metric,
      unit,
    }
  }

  const data = await getTimeSeriesWithSource(user, metric, start, end)

  return {
    count: data.length,
    data: data.map((d) => ({ source: d.source, time: d.time.toISOString(), value: d.value })),
    metric,
    unit,
  }
}

/**
 * Get contextual HRV data for a single metric.
 */
async function getContextualHrvData(
  user: string,
  metric: MetricType,
  start: Date,
  end: Date,
): Promise<[Date, number][]> {
  const contextMap: Record<string, HrvContext> = {
    hrv_activity: 'activity',
    hrv_awake: 'awake',
    hrv_sleep: 'sleep',
  }
  const context = contextMap[metric]
  if (!context) return []

  // Fetch raw HRV data and context windows in parallel
  const [hrvData, { sleepWindows, activityWindows }] = await Promise.all([
    getTimeSeries(user, 'hrv_rmssd', start, end),
    getHrvContextWindows(user, start, end),
  ])

  if (hrvData.length === 0) return []

  // Classify and return the requested context
  const classified = classifyHrvByContext(hrvData, sleepWindows, activityWindows)
  return classified[context]
}

/**
 * Parse a bucket size string like '5m', '10s', '1h', '1d', '1M' into:
 * - interval: PostgreSQL interval string for date_bin() (e.g., '300 seconds')
 * - ms: bucket duration in milliseconds (for in-memory bucketing)
 */
export const parseBucketSize = (bucket: string): { interval: string; ms: number } => {
  const match = bucket.match(/^(\d+)([smhdM])$/)
  if (!match) throw new Error(`Invalid bucket size: ${bucket}`)
  const n = parseInt(match[1], 10)
  const unit = match[2]
  switch (unit) {
    case 's':
      return { interval: `${n} seconds`, ms: n * 1000 }
    case 'm':
      return { interval: `${n} minutes`, ms: n * 60 * 1000 }
    case 'h':
      return { interval: `${n} hours`, ms: n * 60 * 60 * 1000 }
    case 'd':
      return { interval: `${n} days`, ms: n * 24 * 60 * 60 * 1000 }
    case 'M':
      // Approximate months as 30 days for in-memory bucketing; PostgreSQL handles months properly
      return { interval: `${n} months`, ms: n * 30 * 24 * 60 * 60 * 1000 }
    default:
      throw new Error(`Invalid bucket size unit: ${unit}`)
  }
}

/**
 * Compute bucket start time for a given timestamp.
 * For buckets >= 1 day, uses Temporal for timezone-aware flooring (DST-correct).
 */
const MS_PER_DAY = 24 * 60 * 60 * 1000
const getBucketStart = (time: Date, bucketMs: number, rangeStart: Date, tz: string = 'UTC'): Date => {
  // For daily+ buckets, floor to local midnight using Temporal (DST-correct)
  if (bucketMs >= MS_PER_DAY) {
    const instant = Temporal.Instant.fromEpochMilliseconds(time.getTime())
    const localMidnight = instant.toZonedDateTimeISO(tz).startOfDay()
    return new Date(localMidnight.epochMilliseconds)
  }
  // For sub-day buckets, use fixed-interval arithmetic (TZ doesn't affect sub-day boundaries)
  const startMs = rangeStart.getTime()
  const timeMs = time.getTime()
  const bucketIndex = Math.floor((timeMs - startMs) / bucketMs)
  return new Date(startMs + bucketIndex * bucketMs)
}

/**
 * Map contextual HRV metric names to their context.
 */
const contextualHrvMetricToContext: Record<string, HrvContext> = {
  hrv_activity: 'activity',
  hrv_awake: 'awake',
  hrv_sleep: 'sleep',
}

/**
 * Compute bucketed aggregations for contextual HRV data.
 * Returns buckets with min/max/avg/count for filtered HRV samples.
 */
const computeContextualHrvBuckets = (
  hrvData: [Date, number][],
  metric: MetricType,
  bucketMs: number,
  rangeStart: Date,
  tz: string = 'UTC',
): {
  bucket_start: Date
  metric: MetricType
  avg: number
  min: number
  max: number
  count: number
  sum: number
}[] => {
  if (hrvData.length === 0) return []

  // Group data by bucket
  const bucketMap = new Map<string, number[]>()
  for (const [time, value] of hrvData) {
    const bucketStart = getBucketStart(time, bucketMs, rangeStart, tz)
    const key = bucketStart.toISOString()
    if (!bucketMap.has(key)) {
      bucketMap.set(key, [])
    }
    bucketMap.get(key)!.push(value)
  }

  // Compute aggregations for each bucket
  return Array.from(bucketMap.entries()).map(([key, values]) => {
    const sum = values.reduce((a, b) => a + b, 0)
    return {
      avg: sum / values.length,
      bucket_start: new Date(key),
      count: values.length,
      max: Math.max(...values),
      metric,
      min: Math.min(...values),
      sum,
    }
  })
}

/**
 * Query bucketed/aggregated time series data for multiple metrics.
 *
 * Returns pre-aggregated buckets with min/max/avg/count/sum for each metric,
 * significantly reducing data size compared to raw time series queries.
 * Sum is included for cumulative metrics (steps, calories, etc.).
 *
 * Supports contextual HRV metrics (hrv_sleep, hrv_activity, hrv_awake) which
 * are computed by filtering hrv_rmssd data by overlapping sleep/activity windows.
 *
 * @param user - The username
 * @param metrics - Specific metrics to query (omit for all metrics in range)
 * @param start - Start of time range
 * @param end - End of time range
 * @param bucket - Bucket size string, e.g. '5m', '10s', '1h', '1d', '1M'
 * @param options.exclude - Metrics to exclude (useful when fetching all)
 * @param options.customMetrics - Custom metric definitions for validation
 */
export async function queryMetricsBucketed(
  user: string,
  metrics: MetricType[] | undefined,
  start: Date,
  end: Date,
  bucket: BucketSize,
  options: { customMetrics?: CustomMetricDefinition[]; exclude?: string[]; tz?: string } = {},
): Promise<QueryMetricsBucketedResult> {
  const { interval, ms: bucketMs } = parseBucketSize(bucket)
  const excludeSet = new Set(options.exclude ?? [])

  // Resolve which metrics to query
  let resolvedMetrics: MetricType[]
  if (metrics && metrics.length > 0) {
    resolvedMetrics = metrics.filter((m) => !excludeSet.has(m))
  } else {
    // Discover all metrics with data in the range
    const available = await getDistinctMetrics(user, start, end)
    resolvedMetrics = available.filter((m) => !excludeSet.has(m)) as MetricType[]
  }

  if (resolvedMetrics.length === 0) {
    return { bucket, buckets: [], end: end.toISOString(), start: start.toISOString() }
  }

  // Separate regular metrics from contextual HRV metrics
  const regularMetrics = resolvedMetrics.filter((m) => !isContextualHrvMetric(m))
  const contextualHrvMetricsRequested = resolvedMetrics.filter(isContextualHrvMetric)

  // Fetch regular bucketed data and contextual HRV data in parallel
  const tz = options.tz ?? 'UTC'
  const needsContextualHrv = contextualHrvMetricsRequested.length > 0
  const [regularData, contextualHrvData] = await Promise.all([
    regularMetrics.length > 0 ? getTimeSeriesBucketed(user, regularMetrics, start, end, interval, tz) : [],
    needsContextualHrv
      ? computeContextualHrvData(user, contextualHrvMetricsRequested, start, end, bucketMs, tz)
      : [],
  ])

  // Combine all data
  const allData = [...regularData, ...contextualHrvData]

  // Group data by bucket start time
  const bucketMap = new Map<string, MetricBucket>()

  for (const row of allData) {
    const bucketKey = row.bucket_start.toISOString()
    const bucketEndMs = row.bucket_start.getTime() + bucketMs
    const bucketEnd = new Date(bucketEndMs).toISOString()

    if (!bucketMap.has(bucketKey)) {
      bucketMap.set(bucketKey, {
        end: bucketEnd,
        metrics: {},
        start: bucketKey,
      })
    }

    const bucketEntry = bucketMap.get(bucketKey)!
    const stats: BucketMetricStats = {
      avg: row.avg,
      count: row.count,
      max: row.max,
      min: row.min,
    }
    // Include sum for cumulative metrics
    if (getMetricAggregation(row.metric) === 'sum') {
      stats.sum = row.sum
    }
    bucketEntry.metrics[row.metric] = stats
  }

  // Convert map to sorted array
  const buckets = Array.from(bucketMap.values()).sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  )

  return {
    bucket,
    buckets,
    end: end.toISOString(),
    start: start.toISOString(),
  }
}

/**
 * Compute bucketed data for contextual HRV metrics.
 * Fetches raw hrv_rmssd data, classifies by context, and computes bucket aggregations.
 */
async function computeContextualHrvData(
  user: string,
  metrics: MetricType[],
  start: Date,
  end: Date,
  bucketMs: number,
  tz: string = 'UTC',
): Promise<
  {
    bucket_start: Date
    metric: MetricType
    avg: number
    min: number
    max: number
    count: number
    sum: number
  }[]
> {
  // Fetch raw HRV data and context windows in parallel
  const [hrvData, { sleepWindows, activityWindows }] = await Promise.all([
    getTimeSeries(user, 'hrv_rmssd', start, end),
    getHrvContextWindows(user, start, end),
  ])

  if (hrvData.length === 0) return []

  // Classify HRV data by context
  const classified = classifyHrvByContext(hrvData, sleepWindows, activityWindows)

  // Compute buckets for each requested contextual HRV metric
  const results: {
    bucket_start: Date
    metric: MetricType
    avg: number
    min: number
    max: number
    count: number
    sum: number
  }[] = []

  for (const metric of metrics) {
    const context = contextualHrvMetricToContext[metric]
    if (context) {
      const contextData = classified[context]
      const buckets = computeContextualHrvBuckets(contextData, metric, bucketMs, start, tz)
      results.push(...buckets)
    }
  }

  return results
}

/**
 * Health Connect sleep stage codes → named stages.
 * 1=Awake, 2=Sleeping/unknown, 3=Out of bed, 4=Light, 5=Deep, 6=REM
 */
interface SleepStageEntry {
  startTime?: string
  endTime?: string
  stage?: number
}

export const computeSleepStageSummary = (
  data: Record<string, unknown> | undefined,
): SleepStageSummary | undefined => {
  if (!data) return undefined
  const stages = data.stages
  if (!Array.isArray(stages) || stages.length === 0) return undefined

  let awakeMs = 0
  let lightMs = 0
  let deepMs = 0
  let remMs = 0

  for (const s of stages as SleepStageEntry[]) {
    if (typeof s.startTime !== 'string' || typeof s.endTime !== 'string') continue
    const ms = new Date(s.endTime).getTime() - new Date(s.startTime).getTime()
    if (ms <= 0) continue

    switch (s.stage) {
      case 1:
        awakeMs += ms
        break
      case 4:
        lightMs += ms
        break
      case 5:
        deepMs += ms
        break
      case 6:
        remMs += ms
        break
      // 2=sleeping/unknown, 3=out of bed — omitted from summary
    }
  }

  const toMin = (ms: number) => (ms > 0 ? Math.round(ms / 60000) : undefined)
  return {
    awake_min: toMin(awakeMs),
    deep_min: toMin(deepMs),
    light_min: toMin(lightMs),
    rem_min: toMin(remMs),
  }
}

/**
 * Get a comprehensive summary of health data for a specific day.
 * @param sync Optional sync provider to auto-refresh stale data before querying
 */
// eslint-disable-next-line complexity -- TODO: refactor
export async function getDailySummary(
  user: string,
  date: Date,
  sync?: SyncProvider,
  tz?: string,
): Promise<DailySummaryResult> {
  // Fire-and-forget: trigger background sync so data is fresh for the next request,
  // but return current data immediately to avoid blocking on slow external APIs
  if (sync) {
    void Promise.all([
      sync.syncOuraIfNeeded(user, 'tags'),
      sync.syncOuraIfNeeded(user, 'sessions'),
      sync.syncRescueTimeIfNeeded(user),
      sync.syncCalendarsIfNeeded(user),
      sync.syncLastFmIfNeeded(user),
    ])
  }

  let start: Date
  let end: Date
  if (tz) {
    const { dateOnlyToRange } = await import('../mcp/tz-utils.ts')
    const dateStr = date.toISOString().slice(0, 10)
    const range = dateOnlyToRange(dateStr, tz)
    start = range.start
    end = range.end
  } else {
    start = new Date(date)
    start.setHours(0, 0, 0, 0)
    end = new Date(date)
    end.setHours(23, 59, 59, 999)
  }

  // Run queries in parallel
  const [
    heartRateData,
    stepsData,
    sleepSessions,
    exerciseSessions,
    tags,
    productivity,
    placeVisits,
    ouraMetrics,
    dayNotes,
    dayMeals,
    stepsAggregate,
  ] = await Promise.all([
    getTimeSeries(user, 'heart_rate', start, end),
    getTimeSeries(user, 'steps', start, end),
    getSleepSessions(user, start, end),
    getActivities(user, 'exercise', start, end),
    getTags(user, start, end),
    getProductivity(user, start, end),
    getPlaceVisits(user, start, end),
    getTimeSeriesMultiMetric(
      user,
      ['sleep_score', 'readiness_score', 'resilience_score', 'cardiovascular_age'],
      start,
      end,
    ),
    getNotesForTimeRange(user, start, end),
    getMeals(user, { start, end }),
    getDailyAggregateValue(user, 'steps', date),
  ])

  // Calculate heart rate stats
  const heartRates = heartRateData.map(([, value]) => value)
  const heartRateStats: HeartRateStats | null =
    heartRates.length > 0
      ? {
          avg: Math.round(heartRates.reduce((a, b) => a + b, 0) / heartRates.length),
          count: heartRates.length,
          max: Math.max(...heartRates),
          min: Math.min(...heartRates),
        }
      : null

  // Get steps - prefer aggregate (deduplicated) over summing raw records
  const totalSteps =
    stepsAggregate !== null ? stepsAggregate : stepsData.reduce((sum, [, value]) => sum + value, 0)

  // Calculate productivity summary
  const productivitySummary: ProductivitySummary | null =
    productivity.length > 0
      ? productivity.reduce(
          (acc, record) => {
            acc.total_duration_sec += record.duration_sec
            if (record.productivity !== undefined && record.productivity !== null) {
              if (record.productivity >= 1) acc.productive_sec += record.duration_sec
              if (record.productivity >= 2) acc.very_productive_sec += record.duration_sec
              if (record.productivity <= -1) acc.distracting_sec += record.duration_sec
            }
            return acc
          },
          { distracting_sec: 0, productive_sec: 0, total_duration_sec: 0, very_productive_sec: 0 },
        )
      : null

  // Build Oura scores object (get first value for each metric if available)
  const sleepScoreData = ouraMetrics['sleep_score']
  const readinessScoreData = ouraMetrics['readiness_score']
  const resilienceScoreData = ouraMetrics['resilience_score']
  const cardiovascularAgeData = ouraMetrics['cardiovascular_age']

  const hasAnyOuraData =
    sleepScoreData?.length ||
    readinessScoreData?.length ||
    resilienceScoreData?.length ||
    cardiovascularAgeData?.length

  const ouraScores: OuraScores | null = hasAnyOuraData
    ? {
        cardiovascular_age: cardiovascularAgeData?.[0]?.[1] ?? null,
        readiness_score: readinessScoreData?.[0]?.[1] ?? null,
        resilience_score: resilienceScoreData?.[0]?.[1] ?? null,
        sleep_score: sleepScoreData?.[0]?.[1] ?? null,
      }
    : null

  // Get user's HR zones for exercise session HR zone calculation
  const { zones: hrZones } = await getEffectiveHrZones(user)

  // Compute HR zones for exercise sessions (filter already-fetched HR data in memory)
  const exerciseSessionsWithHrZones: SessionSummary[] = exerciseSessions.map((s) => {
    // Resolve human-readable exercise type name from numeric Health Connect ID
    const dataObj = s.data as Record<string, unknown> | undefined
    const exerciseTypeCode = dataObj?.exerciseType
    const exerciseType =
      typeof exerciseTypeCode === 'number' ? getExerciseTypeName(exerciseTypeCode) : undefined

    const sessionSummary: SessionSummary = {
      duration: s.end_time
        ? Math.round((s.end_time.getTime() - s.start_time.getTime()) / 1000 / 60)
        : undefined,
      end_time: s.end_time?.toISOString(),
      exercise_type: exerciseType,
      start_time: s.start_time.toISOString(),
      title: s.title,
    }

    // Only compute HR zones for sessions with end time
    if (s.end_time) {
      const sessionHrData = heartRateData.filter(([time]) => time >= s.start_time && time <= s.end_time!)
      if (sessionHrData.length > 0) {
        sessionSummary.hr_zone_secs = computeHrZoneSecs(sessionHrData, hrZones)
      }
    }

    return sessionSummary
  })

  // Fetch tag comments
  const tagIds = tags.map((t) => t.id).filter((id): id is string => id !== undefined)
  const tagCommentsMap = await getCommentsMap(user, 'tag', tagIds)

  // Build sleep session summaries with sleep_date and sleep_location
  const dateStr = date.toISOString().split('T')[0]
  const sleepSessionSummaries: SleepSessionSummary[] = sleepSessions.map((s) => {
    const timeInBed = s.end_time
      ? Math.round((s.end_time.getTime() - s.start_time.getTime()) / 1000 / 60)
      : undefined
    const totalSleep = computeSleepMinutes(s.data as Record<string, unknown> | undefined)

    // sleep_date = wake-up date (end_time date), or start_time date if still sleeping
    const sleepDate = s.end_time
      ? s.end_time.toISOString().split('T')[0]
      : s.start_time.toISOString().split('T')[0]

    // Find the best-guess sleep location from place visits overlapping the sleep window
    const sleepLocation = findSleepLocation(s.start_time, s.end_time ?? end, placeVisits)

    return {
      duration: totalSleep ?? timeInBed,
      end_time: s.end_time?.toISOString(),
      sleep_date: sleepDate,
      sleep_location: sleepLocation,
      sleep_stages: computeSleepStageSummary(s.data as Record<string, unknown> | undefined),
      start_time: s.start_time.toISOString(),
      time_in_bed: timeInBed,
      total_sleep: totalSleep,
    }
  })

  // Classify sleep sessions:
  // primary_sleep = session where the user woke up on this date (end_time is on this date)
  // evening_sleep = session that started on this date but ends on the next day (or is ongoing)
  const primarySleep = sleepSessionSummaries.find((s) => s.end_time && s.end_time.startsWith(dateStr)) ?? null
  const eveningSleep =
    sleepSessionSummaries.find(
      (s) => s.start_time.startsWith(dateStr) && (!s.end_time || !s.end_time.startsWith(dateStr)),
    ) ?? null

  return {
    date: dateStr,
    evening_sleep: eveningSleep,
    exercise_sessions: exerciseSessionsWithHrZones,
    heart_rate: heartRateStats,
    meals: dayMeals.map((m) => ({
      calories: m.calories,
      carbs: m.carbs,
      fat: m.fat,
      fiber: m.fiber,
      food_items: m.food_items?.map((fi) => fi.name),
      meal_type: m.meal_type,
      name: m.name,
      protein: m.protein,
      time: m.time.toISOString(),
    })),
    notes: dayNotes.map((n) => ({
      content: n.content,
      created_at: n.created_at.toISOString(),
      end_time: n.end_time?.toISOString(),
      entity_id: n.entity_id,
      entity_type: n.entity_type,
      id: n.id,
      start_time: n.start_time?.toISOString(),
      updated_at: n.updated_at.toISOString(),
    })),
    oura_scores: ouraScores,
    places: placeVisits.map((p) => ({
      address: p.address,
      detected_location_id: p.detected_location_id,
      duration: p.duration_minutes,
      end_time: p.end_time.toISOString(),
      lat: p.lat,
      lon: p.lon,
      name: p.name,
      source: p.source,
      start_time: p.start_time.toISOString(),
    })),
    primary_sleep: primarySleep,
    productivity: productivitySummary,
    sleep_sessions: sleepSessionSummaries,
    steps: { total: totalSteps },
    tags: tags.map((t) => ({
      comments: t.id ? (tagCommentsMap.get(t.id) ?? []) : [],
      end_time: t.end_time?.toISOString(),
      start_time: t.start_time.toISOString(),
      tag: t.tag,
    })),
  }
}

/**
 * Find the best-guess sleep location from place visits overlapping a sleep window.
 * Returns the place with the longest overlap during the sleep window.
 */
export function findSleepLocation(
  sleepStart: Date,
  sleepEnd: Date,
  placeVisits: PlaceVisit[],
): SleepLocation | undefined {
  let bestMatch: PlaceVisit | undefined
  let bestOverlap = 0

  for (const visit of placeVisits) {
    // Calculate overlap between sleep window and visit
    const overlapStart = Math.max(sleepStart.getTime(), visit.start_time.getTime())
    const overlapEnd = Math.min(sleepEnd.getTime(), visit.end_time.getTime())
    const overlap = overlapEnd - overlapStart

    if (overlap > bestOverlap) {
      bestOverlap = overlap
      bestMatch = visit
    }
  }

  if (!bestMatch) return undefined

  return {
    lat: bestMatch.lat,
    lon: bestMatch.lon,
    name: bestMatch.name,
    source: bestMatch.source,
  }
}

/**
 * Compute HR zone stats for period summary.
 * Returns PeriodMetricStats for each requested HR zone metric.
 */
async function computeHrZoneStats(
  user: string,
  hrZoneMetrics: MetricType[],
  start: Date,
  end: Date,
): Promise<PeriodMetricStats[]> {
  if (hrZoneMetrics.length === 0) return []

  // Get heart rate data and user's HR zones
  const [hrData, { zones: hrZones }] = await Promise.all([
    getTimeSeries(user, 'heart_rate', start, end),
    getEffectiveHrZones(user),
  ])

  // Compute total time in each zone
  const zoneSecs = computeHrZoneSecs(hrData, hrZones)

  // Build stats for each requested HR zone metric
  return hrZoneMetrics.map((metric) => {
    const zoneIndex = parseInt(metric.replace('hr_zone_', '').replace('_sec', ''), 10) as
      | 0
      | 1
      | 2
      | 3
      | 4
      | 5
    const totalSecs = zoneSecs[zoneIndex]

    return {
      avg: Math.round(totalSecs * 100) / 100,
      change_from_previous_period_percent: null, // Could compute if needed
      completeness_percent: hrData.length > 0 ? 100 : 0,
      count: hrData.length > 0 ? 1 : 0, // Treat as single aggregated value
      max: Math.round(totalSecs * 100) / 100,
      metric,
      min: Math.round(totalSecs * 100) / 100,
      outliers: undefined,
      stddev: 0,
      trend_per_day: null,
      unit: metricUnits[metric],
    }
  })
}

/**
 * Get aggregated statistics for a time period.
 */
export async function getPeriodSummary(
  user: string,
  metrics: string[],
  start: Date,
  end: Date,
): Promise<PeriodSummaryResult> {
  // Separate special metric types from regular metrics
  const regularMetrics = metrics.filter(
    (m) => !isHrZoneMetric(m as MetricType) && !isContextualHrvMetric(m as MetricType),
  )
  const hrZoneMetricsRequested = metrics.filter((m) => isHrZoneMetric(m as MetricType)) as MetricType[]
  const contextualHrvMetricsRequested = metrics.filter((m) =>
    isContextualHrvMetric(m as MetricType),
  ) as MetricType[]

  // Calculate period length for previous period comparison
  const periodMs = end.getTime() - start.getTime()
  const prevStart = new Date(start.getTime() - periodMs)
  const prevEnd = new Date(start.getTime() - 1)

  // Fetch current and previous period stats in parallel (for regular metrics)
  const [currentStats, previousStats, dailyAggregates, hrZoneStats, contextualHrvStats] = await Promise.all([
    getTimeSeriesStats(user, regularMetrics, start, end),
    getTimeSeriesStats(user, regularMetrics, prevStart, prevEnd),
    getDailyAggregates(user, regularMetrics, start, end),
    computeHrZoneStats(user, hrZoneMetricsRequested, start, end),
    computeContextualHrvStats(user, contextualHrvMetricsRequested, start, end, prevStart, prevEnd),
  ])

  // Calculate days in period for completeness calculation
  const daysInPeriod = Math.ceil(periodMs / (1000 * 60 * 60 * 24))

  // Pre-index lookups for O(1) access instead of O(n) find/filter per metric
  const prevStatsMap = new Map(previousStats.map((s) => [s.metric, s]))
  const dailyByMetric = Map.groupBy(dailyAggregates, (d) => d.metric)

  // Build response with trends and completeness for regular metrics
  const metricsWithTrends: PeriodMetricStats[] = currentStats.map((stat) => {
    const prevStat = prevStatsMap.get(stat.metric)
    const dailyData = dailyByMetric.get(stat.metric) ?? []

    // Calculate trend using linear regression on daily averages
    let trend: number | null = null
    if (dailyData.length >= 2) {
      const n = dailyData.length
      const xMean = (n - 1) / 2
      const yMean = dailyData.reduce((sum, d) => sum + d.avg, 0) / n
      let numerator = 0
      let denominator = 0
      for (let i = 0; i < n; i++) {
        numerator += (i - xMean) * (dailyData[i].avg - yMean)
        denominator += (i - xMean) ** 2
      }
      if (denominator !== 0) {
        trend = numerator / denominator
      }
    }

    // Calculate change from previous period
    let changeFromPrevious: number | null = null
    if (prevStat && prevStat.avg !== 0) {
      changeFromPrevious = ((stat.avg - prevStat.avg) / prevStat.avg) * 100
    }

    // Calculate data completeness (days with data / total days)
    const daysWithData = dailyData.length
    const completeness = Math.round((daysWithData / daysInPeriod) * 100)

    // Identify outliers (values more than 2 stddev from mean)
    const outlierThreshold = stat.stddev * 2
    const outliers: { type: 'high' | 'low'; value: number }[] = []
    if (stat.stddev > 0) {
      if (stat.max > stat.avg + outlierThreshold) {
        outliers.push({ type: 'high', value: stat.max })
      }
      if (stat.min < stat.avg - outlierThreshold) {
        outliers.push({ type: 'low', value: stat.min })
      }
    }

    return {
      avg: Math.round(stat.avg * 100) / 100,
      change_from_previous_period_percent:
        changeFromPrevious !== null ? Math.round(changeFromPrevious * 10) / 10 : null,
      completeness_percent: completeness,
      count: stat.count,
      max: Math.round(stat.max * 100) / 100,
      metric: stat.metric,
      min: Math.round(stat.min * 100) / 100,
      outliers: outliers.length > 0 ? outliers : undefined,
      stddev: Math.round(stat.stddev * 100) / 100,
      trend_per_day: trend !== null ? Math.round(trend * 1000) / 1000 : null,
      unit: stat.unit,
    }
  })

  // Add regular metrics with no data in current period
  const missingRegularMetrics = regularMetrics.filter((m) => !currentStats.some((s) => s.metric === m))
  for (const metric of missingRegularMetrics) {
    metricsWithTrends.push({
      avg: 0,
      change_from_previous_period_percent: null,
      completeness_percent: 0,
      count: 0,
      max: 0,
      metric,
      min: 0,
      outliers: undefined,
      stddev: 0,
      trend_per_day: null,
      unit: metricUnits[metric as MetricType] ?? '',
    })
  }

  // Add HR zone stats and contextual HRV stats
  metricsWithTrends.push(...hrZoneStats, ...contextualHrvStats)

  return {
    end: end.toISOString(),
    metrics: metricsWithTrends,
    period_days: daysInPeriod,
    start: start.toISOString(),
  }
}

/**
 * Compute period summary stats for contextual HRV metrics (hrv_sleep, hrv_activity, hrv_awake).
 * These are computed by filtering hrv_rmssd data by overlapping sleep/activity windows.
 */
async function computeContextualHrvStats(
  user: string,
  metrics: MetricType[],
  start: Date,
  end: Date,
  prevStart: Date,
  prevEnd: Date,
): Promise<PeriodMetricStats[]> {
  if (metrics.length === 0) return []

  // Fetch current and previous period data in parallel
  const [currentData, previousData] = await Promise.all([
    getClassifiedHrvData(user, start, end),
    getClassifiedHrvData(user, prevStart, prevEnd),
  ])

  return metrics.map((metric) => {
    const context = contextualHrvMetricToContext[metric]
    if (!context) {
      return emptyPeriodMetricStats(metric)
    }

    const values = currentData[context]
    const prevValues = previousData[context]

    if (values.length === 0) {
      return emptyPeriodMetricStats(metric)
    }

    const nums = values.map(([, v]) => v)
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length
    const min = Math.min(...nums)
    const max = Math.max(...nums)
    const variance = nums.reduce((sum, v) => sum + (v - avg) ** 2, 0) / nums.length
    const stddev = Math.sqrt(variance)

    // Previous period comparison
    let changeFromPrevious: number | null = null
    if (prevValues.length > 0) {
      const prevNums = prevValues.map(([, v]) => v)
      const prevAvg = prevNums.reduce((a, b) => a + b, 0) / prevNums.length
      if (prevAvg !== 0) {
        changeFromPrevious = ((avg - prevAvg) / prevAvg) * 100
      }
    }

    // Outliers
    const outlierThreshold = stddev * 2
    const outliers: { type: 'high' | 'low'; value: number }[] = []
    if (stddev > 0) {
      if (max > avg + outlierThreshold) outliers.push({ type: 'high', value: max })
      if (min < avg - outlierThreshold) outliers.push({ type: 'low', value: min })
    }

    return {
      avg: Math.round(avg * 100) / 100,
      change_from_previous_period_percent:
        changeFromPrevious !== null ? Math.round(changeFromPrevious * 10) / 10 : null,
      completeness_percent: values.length > 0 ? 100 : 0,
      count: values.length,
      max: Math.round(max * 100) / 100,
      metric,
      min: Math.round(min * 100) / 100,
      outliers: outliers.length > 0 ? outliers : undefined,
      stddev: Math.round(stddev * 100) / 100,
      trend_per_day: null,
      unit: metricUnits[metric] ?? 'ms',
    }
  })
}

/**
 * Get HRV data classified by context (sleep/activity/awake) for a time range.
 */
async function getClassifiedHrvData(
  user: string,
  start: Date,
  end: Date,
): Promise<Record<HrvContext, [Date, number][]>> {
  const [hrvData, { sleepWindows, activityWindows }] = await Promise.all([
    getTimeSeries(user, 'hrv_rmssd', start, end),
    getHrvContextWindows(user, start, end),
  ])

  if (hrvData.length === 0) return { activity: [], awake: [], sleep: [] }

  return classifyHrvByContext(hrvData, sleepWindows, activityWindows)
}

const emptyPeriodMetricStats = (metric: string): PeriodMetricStats => ({
  avg: 0,
  change_from_previous_period_percent: null,
  completeness_percent: 0,
  count: 0,
  max: 0,
  metric,
  min: 0,
  outliers: undefined,
  stddev: 0,
  trend_per_day: null,
  unit: metricUnits[metric as MetricType] ?? 'ms',
})

/**
 * Query tags for a time range.
 * @param sync Optional sync provider to auto-refresh stale data before querying
 */
export async function queryTags(
  user: string,
  start: Date,
  end: Date,
  sync?: SyncProvider,
): Promise<TagSummary[]> {
  // Fire-and-forget: trigger background sync so data is fresh for the next request
  if (sync) {
    void Promise.all([
      sync.syncOuraIfNeeded(user, 'tags'),
      sync.syncCalendarsIfNeeded(user),
      sync.syncLastFmIfNeeded(user),
    ])
  }

  const tags = await getTags(user, start, end)
  const ids = tags.map((t) => t.id).filter((id): id is string => id !== undefined)
  const commentsMap = await getCommentsMap(user, 'tag', ids)
  return tags.map((t) => ({
    comments: t.id ? (commentsMap.get(t.id) ?? []) : [],
    end_time: t.end_time?.toISOString(),
    external_id: t.external_id,
    id: t.id,
    source: t.source,
    start_time: t.start_time.toISOString(),
    tag: t.tag,
  }))
}

/**
 * Activity query result with formatted timestamps.
 */
export interface ActivityResult {
  id?: string
  start_time: string
  end_time?: string
  duration?: number // minutes
  time_in_bed?: number // minutes (end_time - start_time, sleep only)
  total_sleep?: number // minutes (actual sleep excluding awake, sleep only)
  activity_type: string
  title?: string
  notes?: string
  source: string
  data?: Record<string, unknown>
  hr_zone_secs?: HrZoneSecs
  avg_hrv?: number
  comments: CommentSummary[]
}

/**
 * Get average HRV for an activity, using embedded Oura data or time series.
 */
async function getAvgHrvForActivity(
  user: string,
  activity: { data?: Record<string, unknown>; start_time: Date; end_time?: Date },
): Promise<number | undefined> {
  // Try embedded Oura HRV data first (meditation sessions have hrv.items)
  const hrv = activity.data?.hrv as { items?: (number | null)[] } | undefined
  const items = hrv?.items?.filter((v): v is number => v !== null && v > 0)
  if (items && items.length > 0) {
    return Math.round(items.reduce((sum, v) => sum + v, 0) / items.length)
  }

  // Fall back to time series HRV data
  if (!activity.end_time) return undefined
  const hrvData = await getTimeSeries(user, 'hrv_rmssd', activity.start_time, activity.end_time)
  if (hrvData.length === 0) return undefined
  return Math.round(hrvData.reduce((sum, [, v]) => sum + v, 0) / hrvData.length)
}

/** Add sleep-specific fields (time_in_bed, total_sleep) to an activity result. */
function enrichSleepFields(result: ActivityResult, data: Record<string, unknown> | undefined): void {
  result.time_in_bed = result.duration
  const sleepMinutes = computeSleepMinutes(data)
  if (sleepMinutes !== undefined) {
    result.total_sleep = sleepMinutes
    result.duration = sleepMinutes
  }
}

/** Enrich a raw activity record into an ActivityResult with computed fields. */
async function enrichActivity(
  user: string,
  a: Awaited<ReturnType<typeof getActivities>>[number],
  hrZones: HrZoneThresholds | null,
  commentsMap: Map<string, CommentSummary[]>,
): Promise<ActivityResult> {
  const result: ActivityResult = {
    activity_type: a.activity_type,
    comments: a.id ? (commentsMap.get(a.id) ?? []) : [],
    data: a.data,
    duration: a.end_time
      ? Math.round((a.end_time.getTime() - a.start_time.getTime()) / 1000 / 60)
      : undefined,
    end_time: a.end_time?.toISOString(),
    id: 'source_ids' in a && a.source_ids ? `merged:${a.id}` : a.id,
    notes: a.notes,
    source: a.source,
    start_time: a.start_time.toISOString(),
    title: a.title,
  }

  if (a.activity_type === 'sleep') {
    enrichSleepFields(result, a.data as Record<string, unknown> | undefined)
  }

  // Compute HR zones for exercise activities with end time
  if (hrZones && a.activity_type === 'exercise' && a.end_time) {
    const hrData = await getTimeSeries(user, 'heart_rate', a.start_time, a.end_time)
    if (hrData.length > 0) {
      result.hr_zone_secs = computeHrZoneSecs(hrData, hrZones)
    }
  }

  // Compute average HRV for sleep and meditation
  if ((a.activity_type === 'sleep' || a.activity_type === 'meditation') && a.end_time) {
    result.avg_hrv = await getAvgHrvForActivity(user, a)
  }

  return result
}

/**
 * Query activities for a time range.
 * @param sync Optional sync provider to auto-refresh stale data before querying
 */
export async function queryActivities(
  user: string,
  types: ActivityType[],
  start: Date,
  end: Date,
  sync?: SyncProvider,
): Promise<ActivityResult[]> {
  // Fire-and-forget: trigger background sync so meditation data is fresh for the next request
  if (sync && types.includes('meditation')) {
    void sync.syncOuraIfNeeded(user, 'sessions')
  }

  const activities = await getActivities(user, types, start, end)

  // Get HR zones only if exercise activities are included
  const includesExercise = types.includes('exercise')
  const hrZones = includesExercise ? (await getEffectiveHrZones(user)).zones : null

  // Fetch comments for all activities
  const activityIds = activities.map((a) => a.id).filter((id): id is string => id !== undefined)
  const commentsMap = await getCommentsMap(user, 'activity', activityIds)

  return Promise.all(activities.map((a) => enrichActivity(user, a, hrZones, commentsMap)))
}

/**
 * Productivity record with formatted timestamps.
 * source_ids lists all original record IDs that were merged into this span.
 */
export interface ProductivityResult {
  id?: string
  source_ids?: string[]
  start_time: string
  end_time: string
  activity: string
  title?: string
  category?: string
  productivity?: number
  duration_sec: number
  is_mobile?: boolean
  source?: DataSource
  resolved_category?: string[]
  comments: CommentSummary[]
}

/**
 * Maximum gap (ms) between spans of the same activity that are still merged.
 * Applies both to directly consecutive spans and to spans separated by other
 * activities (interleave merging). 2 minutes covers RescueTime rounding gaps
 * and typical rapid window switches (e.g. terminal → browser → terminal).
 */
const MERGE_GAP_MS = 2 * 60 * 1000

/** Internal type that tracks source IDs through the merge pipeline. */
type MergeRecord = ProductivityRecord & { source_ids: string[] }

/**
 * Merge productivity spans for the same activity/is_mobile, in two phases:
 *
 * Phase 1 — sequential: adjacent spans of the same activity within MERGE_GAP_MS
 * are collapsed (handles RescueTime minute-boundary rounding).
 *
 * Phase 2 — interleave: spans of the same activity separated only by short
 * bursts of other apps (total interleaved gap ≤ MERGE_GAP_MS) are merged into
 * a single span. duration_sec accumulates only the actual time in that app;
 * source_ids tracks all original record IDs that were consolidated.
 *
 * Records must arrive sorted by start_time (the DB query guarantees this).
 */
// eslint-disable-next-line complexity -- two-phase merge algorithm is inherently branchy
export function mergeProductivitySpans(
  records: ProductivityRecord[],
): (ProductivityRecord & { source_ids: string[] })[] {
  if (records.length === 0) return []

  // --- Phase 1: sequential merge (same as before) ---
  const phase1: MergeRecord[] = [{ ...records[0]!, source_ids: records[0]!.id ? [records[0]!.id] : [] }]

  for (let i = 1; i < records.length; i++) {
    const current = records[i]!
    const prev = phase1[phase1.length - 1]!

    const sameActivity = current.activity === prev.activity
    const sameMobile = (current.is_mobile ?? false) === (prev.is_mobile ?? false)
    const gap = current.start_time.getTime() - prev.end_time.getTime()
    const closeEnough = gap >= 0 && gap <= MERGE_GAP_MS

    if (sameActivity && sameMobile && closeEnough) {
      prev.end_time = current.end_time
      prev.duration_sec += current.duration_sec
      if (current.id) prev.source_ids.push(current.id)
    } else {
      phase1.push({ ...current, source_ids: current.id ? [current.id] : [] })
    }
  }

  // --- Phase 2: interleave merge ---
  // Walk forward; for each span check whether the most-recent span of the same
  // activity ended within MERGE_GAP_MS. If so, extend that earlier span and
  // drop the current one from the output.
  const phase2: MergeRecord[] = []
  // Maps "activity|is_mobile" → index in phase2 of the last span for that key
  const lastIndexFor = new Map<string, number>()

  for (const span of phase1) {
    const key = `${span.activity}|${span.is_mobile ?? false}`
    const prevIdx = lastIndexFor.get(key)

    if (prevIdx !== undefined) {
      const prev = phase2[prevIdx]!
      const gap = span.start_time.getTime() - prev.end_time.getTime()

      if (gap >= 0 && gap <= MERGE_GAP_MS) {
        // Extend the earlier span; add this span's duration and source IDs
        prev.end_time = span.end_time
        prev.duration_sec += span.duration_sec
        prev.source_ids.push(...span.source_ids)
        // Update the index so future same-activity spans compare against the
        // latest end_time (which is now in the same slot prevIdx)
        lastIndexFor.set(key, prevIdx)
        continue
      }
    }

    // No mergeable predecessor — emit as a new span
    lastIndexFor.set(key, phase2.length)
    phase2.push({ ...span })
  }

  // Re-sort by start_time (interleave merging preserves the first-span position
  // but later spans may slot earlier ones after others are skipped)
  return phase2.sort((a, b) => a.start_time.getTime() - b.start_time.getTime())
}

/**
 * Query productivity data for a time range.
 * Merges consecutive spans for the same activity to reduce visual clutter.
 * @param sync Optional sync provider to auto-refresh stale data before querying
 */
export async function queryProductivity(
  user: string,
  start: Date,
  end: Date,
  sync?: SyncProvider,
): Promise<ProductivityResult[]> {
  // Fire-and-forget: trigger background sync so data is fresh for the next request
  if (sync) {
    void sync.syncRescueTimeIfNeeded(user)
  }

  const productivity = await getProductivity(user, start, end)
  const merged = mergeProductivitySpans(productivity)
  // Fetch comments for all source IDs so comments on any constituent record surface
  const allIds = merged.flatMap((p) => (p.source_ids.length > 0 ? p.source_ids : p.id ? [p.id] : []))
  const commentsMap = await getCommentsMap(user, 'productivity', allIds)
  return merged.map((p) => {
    // Collect comments from all source IDs for this merged span
    const comments = p.source_ids.flatMap((sid) => commentsMap.get(sid) ?? [])
    return {
      activity: p.activity,
      category: p.category,
      comments,
      duration_sec: p.duration_sec,
      end_time: p.end_time.toISOString(),
      id: p.id,
      is_mobile: p.is_mobile,
      productivity: p.productivity,
      resolved_category: p.resolved_category,
      source: p.source,
      source_ids: p.source_ids.length > 1 ? p.source_ids : undefined,
      start_time: p.start_time.toISOString(),
      title: p.title,
    }
  })
}

/**
 * Assemble raw bucketed productivity rows into screentime buckets with category breakdown.
 */
export const assembleScreentimeBuckets = (
  rows: Array<{
    bucket_start: Date
    resolved_category: string[] | null
    total_sec: number
  }>,
  bucketMs: number,
): Array<{
  start: string
  end: string
  total_sec: number
  categories: Array<{ path: string[]; total_sec: number }>
}> => {
  const bucketMap = new Map<
    string,
    { start: Date; categories: Array<{ path: string[]; total_sec: number }>; total_sec: number }
  >()

  for (const row of rows) {
    const key = row.bucket_start.toISOString()
    let entry = bucketMap.get(key)
    if (!entry) {
      entry = { categories: [], start: row.bucket_start, total_sec: 0 }
      bucketMap.set(key, entry)
    }
    entry.total_sec += row.total_sec
    entry.categories.push({
      path: row.resolved_category ?? [],
      total_sec: row.total_sec,
    })
  }

  return [...bucketMap.values()]
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map((b) => ({
      categories: b.categories.sort((a, c) => c.total_sec - a.total_sec),
      end: new Date(b.start.getTime() + bucketMs).toISOString(),
      start: b.start.toISOString(),
      total_sec: b.total_sec,
    }))
}

/**
 * Query locations/places for a time range.
 */
export async function queryLocations(user: string, start: Date, end: Date): Promise<PlaceSummary[]> {
  const visits = await getPlaceVisits(user, start, end)
  return visits.map((p) => ({
    address: p.address,
    detected_location_id: p.detected_location_id,
    duration: p.duration_minutes,
    end_time: p.end_time.toISOString(),
    lat: p.lat,
    lon: p.lon,
    name: p.name,
    source: p.source,
    start_time: p.start_time.toISOString(),
  }))
}
