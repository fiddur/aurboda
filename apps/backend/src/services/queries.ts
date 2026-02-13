/* eslint-disable max-lines -- TODO: refactor - extract helpers */
/**
 * Query services for health data.
 *
 * These functions contain the business logic for querying health data.
 * They are used by both the MCP tools and the REST API.
 */

import type { CustomMetricDefinition } from '@aurboda/api-spec'
import {
  getActivities,
  getDailyAggregates,
  getDailyAggregateValue,
  getProductivity,
  getSleepSessions,
  getTags,
  getTimeSeries,
  getTimeSeriesBucketed,
  getTimeSeriesMultiMetric,
  getTimeSeriesStats,
} from '../db'
import {
  ActivityType,
  getMetricUnit,
  isContextualHrvMetric,
  isHrZoneMetric,
  MetricType,
  metricUnits,
} from '../schema'
import { classifyHrvByContext, getHrvContextWindows, HrvContext } from './hrv-context'
import { getPlaceVisits } from './locations'
import { computeHrZoneSecs, getEffectiveHrZones, HrZoneSecs } from './settings'

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
  /** Sync RescueTime productivity data if stale */
  syncRescueTimeIfNeeded: (user: string) => Promise<void>
  /** Sync calendar data if stale */
  syncCalendarsIfNeeded: (user: string) => Promise<void>
}

export interface MetricDataPoint {
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
 * Valid bucket sizes for bucketed metrics queries.
 */
export type BucketSize = '5m' | '15m' | '30m' | '1h' | '1d'

/**
 * Bucket statistics for a single metric.
 */
export interface BucketMetricStats {
  avg: number
  min: number
  max: number
  count: number
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
  startTime: string
  endTime?: string
  duration?: number // minutes
  title?: string
  data?: Record<string, unknown>
  hrZoneSecs?: HrZoneSecs
}

export interface TagSummary {
  tag: string
  startTime: string
  endTime?: string
}

export interface PlaceSummary {
  name: string
  startTime: string
  endTime: string
  duration: number // minutes
  source: 'named' | 'detected' | 'owntracks' | 'unknown'
  lat?: number
  lon?: number
  address?: string
  detectedLocationId?: string
}

export interface ProductivitySummary {
  totalDurationSec: number
  productiveSec: number
  veryProductiveSec: number
  distractingSec: number
}

export interface OuraScores {
  sleepScore: number | null
  readinessScore: number | null
  resilienceScore: number | null
  cardiovascularAge: number | null
}

export interface DailySummaryResult {
  date: string
  heartRate: HeartRateStats | null
  steps: { total: number }
  sleepSessions: SessionSummary[]
  exerciseSessions: SessionSummary[]
  tags: TagSummary[]
  productivity: ProductivitySummary | null
  places: PlaceSummary[]
  ouraScores: OuraScores | null
}

export interface PeriodMetricStats {
  metric: string
  unit: string
  count: number
  min: number
  max: number
  avg: number
  stddev: number
  trendPerDay: number | null
  changeFromPreviousPeriodPercent: number | null
  completenessPercent: number
  outliers?: { type: 'high' | 'low'; value: number }[]
}

export interface PeriodSummaryResult {
  start: string
  end: string
  periodDays: number
  metrics: PeriodMetricStats[]
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

  const data = await getTimeSeries(user, metric, start, end)

  return {
    count: data.length,
    data: data.map(([time, value]) => ({ time: time.toISOString(), value })),
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
 * Convert bucket size string to minutes.
 */
const bucketSizeToMinutes: Record<BucketSize, number> = {
  '1d': 1440,
  '1h': 60,
  '5m': 5,
  '15m': 15,
  '30m': 30,
}

/**
 * Compute bucket start time for a given timestamp.
 */
const getBucketStart = (time: Date, bucketMinutes: number, rangeStart: Date): Date => {
  const msPerBucket = bucketMinutes * 60 * 1000
  const startMs = rangeStart.getTime()
  const timeMs = time.getTime()
  const bucketIndex = Math.floor((timeMs - startMs) / msPerBucket)
  return new Date(startMs + bucketIndex * msPerBucket)
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
  bucketMinutes: number,
  rangeStart: Date,
): { bucketStart: Date; metric: MetricType; avg: number; min: number; max: number; count: number }[] => {
  if (hrvData.length === 0) return []

  // Group data by bucket
  const bucketMap = new Map<string, number[]>()
  for (const [time, value] of hrvData) {
    const bucketStart = getBucketStart(time, bucketMinutes, rangeStart)
    const key = bucketStart.toISOString()
    if (!bucketMap.has(key)) {
      bucketMap.set(key, [])
    }
    bucketMap.get(key)!.push(value)
  }

  // Compute aggregations for each bucket
  return Array.from(bucketMap.entries()).map(([key, values]) => ({
    avg: values.reduce((a, b) => a + b, 0) / values.length,
    bucketStart: new Date(key),
    count: values.length,
    max: Math.max(...values),
    metric,
    min: Math.min(...values),
  }))
}

/**
 * Query bucketed/aggregated time series data for multiple metrics.
 *
 * Returns pre-aggregated buckets with min/max/avg/count for each metric,
 * significantly reducing data size compared to raw time series queries.
 *
 * Supports contextual HRV metrics (hrv_sleep, hrv_activity, hrv_awake) which
 * are computed by filtering hrv_rmssd data by overlapping sleep/activity windows.
 *
 * @param user - The username
 * @param metrics - Array of metric types to query
 * @param start - Start of time range
 * @param end - End of time range
 * @param bucket - Bucket size: '5m', '15m', '30m', '1h', or '1d'
 */
export async function queryMetricsBucketed(
  user: string,
  metrics: MetricType[],
  start: Date,
  end: Date,
  bucket: BucketSize,
): Promise<QueryMetricsBucketedResult> {
  const bucketMinutes = bucketSizeToMinutes[bucket]

  // Separate regular metrics from contextual HRV metrics
  const regularMetrics = metrics.filter((m) => !isContextualHrvMetric(m))
  const contextualHrvMetricsRequested = metrics.filter(isContextualHrvMetric)

  // Fetch regular bucketed data and contextual HRV data in parallel
  const needsContextualHrv = contextualHrvMetricsRequested.length > 0
  const [regularData, contextualHrvData] = await Promise.all([
    regularMetrics.length > 0 ? getTimeSeriesBucketed(user, regularMetrics, start, end, bucketMinutes) : [],
    needsContextualHrv ?
      computeContextualHrvData(user, contextualHrvMetricsRequested, start, end, bucketMinutes)
    : [],
  ])

  // Combine all data
  const allData = [...regularData, ...contextualHrvData]

  // Group data by bucket start time
  const bucketMap = new Map<string, MetricBucket>()

  for (const row of allData) {
    const bucketKey = row.bucketStart.toISOString()
    const bucketEndMs = row.bucketStart.getTime() + bucketMinutes * 60 * 1000
    const bucketEnd = new Date(bucketEndMs).toISOString()

    if (!bucketMap.has(bucketKey)) {
      bucketMap.set(bucketKey, {
        end: bucketEnd,
        metrics: {},
        start: bucketKey,
      })
    }

    const bucketEntry = bucketMap.get(bucketKey)!
    bucketEntry.metrics[row.metric] = {
      avg: row.avg,
      count: row.count,
      max: row.max,
      min: row.min,
    }
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
  bucketMinutes: number,
): Promise<
  { bucketStart: Date; metric: MetricType; avg: number; min: number; max: number; count: number }[]
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
    bucketStart: Date
    metric: MetricType
    avg: number
    min: number
    max: number
    count: number
  }[] = []

  for (const metric of metrics) {
    const context = contextualHrvMetricToContext[metric]
    if (context) {
      const contextData = classified[context]
      const buckets = computeContextualHrvBuckets(contextData, metric, bucketMinutes, start)
      results.push(...buckets)
    }
  }

  return results
}

/**
 * Get a comprehensive summary of health data for a specific day.
 * @param sync Optional sync provider to auto-refresh stale data before querying
 */
// eslint-disable-next-line max-lines-per-function, complexity -- TODO: refactor
export async function getDailySummary(
  user: string,
  date: Date,
  sync?: SyncProvider,
): Promise<DailySummaryResult> {
  // Auto-sync data sources if sync provider is available
  if (sync) {
    await Promise.all([
      sync.syncOuraIfNeeded(user, 'tags'),
      sync.syncOuraIfNeeded(user, 'sessions'),
      sync.syncRescueTimeIfNeeded(user),
      sync.syncCalendarsIfNeeded(user),
    ])
  }

  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  const end = new Date(date)
  end.setHours(23, 59, 59, 999)

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
  ])

  // Calculate heart rate stats
  const heartRates = heartRateData.map(([, value]) => value)
  const heartRateStats: HeartRateStats | null =
    heartRates.length > 0 ?
      {
        avg: Math.round(heartRates.reduce((a, b) => a + b, 0) / heartRates.length),
        count: heartRates.length,
        max: Math.max(...heartRates),
        min: Math.min(...heartRates),
      }
    : null

  // Get steps - prefer aggregate (deduplicated) over summing raw records
  const stepsAggregate = await getDailyAggregateValue(user, 'steps', date)
  const totalSteps =
    stepsAggregate !== null ? stepsAggregate : stepsData.reduce((sum, [, value]) => sum + value, 0)

  // Calculate productivity summary
  const productivitySummary: ProductivitySummary | null =
    productivity.length > 0 ?
      productivity.reduce(
        (acc, record) => {
          acc.totalDurationSec += record.durationSec
          if (record.productivity !== undefined && record.productivity !== null) {
            if (record.productivity >= 1) acc.productiveSec += record.durationSec
            if (record.productivity >= 2) acc.veryProductiveSec += record.durationSec
            if (record.productivity <= -1) acc.distractingSec += record.durationSec
          }
          return acc
        },
        { distractingSec: 0, productiveSec: 0, totalDurationSec: 0, veryProductiveSec: 0 },
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

  const ouraScores: OuraScores | null =
    hasAnyOuraData ?
      {
        cardiovascularAge: cardiovascularAgeData?.[0]?.[1] ?? null,
        readinessScore: readinessScoreData?.[0]?.[1] ?? null,
        resilienceScore: resilienceScoreData?.[0]?.[1] ?? null,
        sleepScore: sleepScoreData?.[0]?.[1] ?? null,
      }
    : null

  // Get user's HR zones for exercise session HR zone calculation
  const { zones: hrZones } = await getEffectiveHrZones(user)

  // Compute HR zones for exercise sessions
  const exerciseSessionsWithHrZones: SessionSummary[] = await Promise.all(
    exerciseSessions.map(async (s) => {
      const sessionSummary: SessionSummary = {
        data: s.data,
        duration:
          s.endTime ? Math.round((s.endTime.getTime() - s.startTime.getTime()) / 1000 / 60) : undefined,
        endTime: s.endTime?.toISOString(),
        startTime: s.startTime.toISOString(),
        title: s.title,
      }

      // Only compute HR zones for sessions with end time
      if (s.endTime) {
        const sessionHrData = await getTimeSeries(user, 'heart_rate', s.startTime, s.endTime)
        if (sessionHrData.length > 0) {
          sessionSummary.hrZoneSecs = computeHrZoneSecs(sessionHrData, hrZones)
        }
      }

      return sessionSummary
    }),
  )

  return {
    date: date.toISOString().split('T')[0],
    exerciseSessions: exerciseSessionsWithHrZones,
    heartRate: heartRateStats,
    ouraScores,
    places: placeVisits.map((p) => ({
      address: p.address,
      detectedLocationId: p.detectedLocationId,
      duration: p.durationMinutes,
      endTime: p.endTime.toISOString(),
      lat: p.lat,
      lon: p.lon,
      name: p.name,
      source: p.source,
      startTime: p.startTime.toISOString(),
    })),
    productivity: productivitySummary,
    sleepSessions: sleepSessions.map((s) => ({
      data: s.data,
      duration: s.endTime ? Math.round((s.endTime.getTime() - s.startTime.getTime()) / 1000 / 60) : undefined,
      endTime: s.endTime?.toISOString(),
      startTime: s.startTime.toISOString(),
    })),
    steps: { total: totalSteps },
    tags: tags.map((t) => ({
      endTime: t.endTime?.toISOString(),
      startTime: t.startTime.toISOString(),
      tag: t.tag,
    })),
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
      changeFromPreviousPeriodPercent: null, // Could compute if needed
      completenessPercent: hrData.length > 0 ? 100 : 0,
      count: hrData.length > 0 ? 1 : 0, // Treat as single aggregated value
      max: Math.round(totalSecs * 100) / 100,
      metric,
      min: Math.round(totalSecs * 100) / 100,
      outliers: undefined,
      stddev: 0,
      trendPerDay: null,
      unit: metricUnits[metric],
    }
  })
}

/**
 * Get aggregated statistics for a time period.
 */
// eslint-disable-next-line max-lines-per-function -- TODO: refactor
export async function getPeriodSummary(
  user: string,
  metrics: string[],
  start: Date,
  end: Date,
): Promise<PeriodSummaryResult> {
  // Separate HR zone metrics from regular metrics
  const regularMetrics = metrics.filter((m) => !isHrZoneMetric(m as MetricType))
  const hrZoneMetricsRequested = metrics.filter((m) => isHrZoneMetric(m as MetricType)) as MetricType[]

  // Calculate period length for previous period comparison
  const periodMs = end.getTime() - start.getTime()
  const prevStart = new Date(start.getTime() - periodMs)
  const prevEnd = new Date(start.getTime() - 1)

  // Fetch current and previous period stats in parallel (for regular metrics)
  const [currentStats, previousStats, dailyAggregates, hrZoneStats] = await Promise.all([
    getTimeSeriesStats(user, regularMetrics, start, end),
    getTimeSeriesStats(user, regularMetrics, prevStart, prevEnd),
    getDailyAggregates(user, regularMetrics, start, end),
    computeHrZoneStats(user, hrZoneMetricsRequested, start, end),
  ])

  // Calculate days in period for completeness calculation
  const daysInPeriod = Math.ceil(periodMs / (1000 * 60 * 60 * 24))

  // Build response with trends and completeness for regular metrics
  const metricsWithTrends: PeriodMetricStats[] = currentStats.map((stat) => {
    const prevStat = previousStats.find((p) => p.metric === stat.metric)
    const dailyData = dailyAggregates.filter((d) => d.metric === stat.metric)

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
      changeFromPreviousPeriodPercent:
        changeFromPrevious !== null ? Math.round(changeFromPrevious * 10) / 10 : null,
      completenessPercent: completeness,
      count: stat.count,
      max: Math.round(stat.max * 100) / 100,
      metric: stat.metric,
      min: Math.round(stat.min * 100) / 100,
      outliers: outliers.length > 0 ? outliers : undefined,
      stddev: Math.round(stat.stddev * 100) / 100,
      trendPerDay: trend !== null ? Math.round(trend * 1000) / 1000 : null,
      unit: stat.unit,
    }
  })

  // Add regular metrics with no data in current period
  const missingRegularMetrics = regularMetrics.filter((m) => !currentStats.some((s) => s.metric === m))
  for (const metric of missingRegularMetrics) {
    metricsWithTrends.push({
      avg: 0,
      changeFromPreviousPeriodPercent: null,
      completenessPercent: 0,
      count: 0,
      max: 0,
      metric,
      min: 0,
      outliers: undefined,
      stddev: 0,
      trendPerDay: null,
      unit: metricUnits[metric as MetricType] ?? '',
    })
  }

  // Add HR zone stats
  metricsWithTrends.push(...hrZoneStats)

  return {
    end: end.toISOString(),
    metrics: metricsWithTrends,
    periodDays: daysInPeriod,
    start: start.toISOString(),
  }
}

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
  if (sync) {
    await Promise.all([sync.syncOuraIfNeeded(user, 'tags'), sync.syncCalendarsIfNeeded(user)])
  }

  const tags = await getTags(user, start, end)
  return tags.map((t) => ({
    endTime: t.endTime?.toISOString(),
    startTime: t.startTime.toISOString(),
    tag: t.tag,
  }))
}

/**
 * Activity query result with formatted timestamps.
 */
export interface ActivityResult {
  startTime: string
  endTime?: string
  duration?: number // minutes
  activityType: string
  title?: string
  source: string
  data?: Record<string, unknown>
  hrZoneSecs?: HrZoneSecs
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
  // Auto-sync Oura sessions if meditation is requested
  if (sync && types.includes('meditation')) {
    await sync.syncOuraIfNeeded(user, 'sessions')
  }

  const activities = await getActivities(user, types, start, end)

  // Get HR zones only if exercise activities are included
  const includesExercise = types.includes('exercise')
  const hrZones = includesExercise ? (await getEffectiveHrZones(user)).zones : null

  return Promise.all(
    activities.map(async (a) => {
      const result: ActivityResult = {
        activityType: a.activityType,
        data: a.data,
        duration:
          a.endTime ? Math.round((a.endTime.getTime() - a.startTime.getTime()) / 1000 / 60) : undefined,
        endTime: a.endTime?.toISOString(),
        source: a.source,
        startTime: a.startTime.toISOString(),
        title: a.title,
      }

      // Compute HR zones for exercise activities with end time
      if (hrZones && a.activityType === 'exercise' && a.endTime) {
        const hrData = await getTimeSeries(user, 'heart_rate', a.startTime, a.endTime)
        if (hrData.length > 0) {
          result.hrZoneSecs = computeHrZoneSecs(hrData, hrZones)
        }
      }

      return result
    }),
  )
}

/**
 * Productivity record with formatted timestamps.
 */
export interface ProductivityResult {
  startTime: string
  endTime: string
  activity: string
  category?: string
  productivity?: number
  durationSec: number
}

/**
 * Query productivity data for a time range.
 * @param sync Optional sync provider to auto-refresh stale data before querying
 */
export async function queryProductivity(
  user: string,
  start: Date,
  end: Date,
  sync?: SyncProvider,
): Promise<ProductivityResult[]> {
  if (sync) {
    await sync.syncRescueTimeIfNeeded(user)
  }

  const productivity = await getProductivity(user, start, end)
  return productivity.map((p) => ({
    activity: p.activity,
    category: p.category,
    durationSec: p.durationSec,
    endTime: p.endTime.toISOString(),
    productivity: p.productivity,
    startTime: p.startTime.toISOString(),
  }))
}

/**
 * Query locations/places for a time range.
 */
export async function queryLocations(user: string, start: Date, end: Date): Promise<PlaceSummary[]> {
  const visits = await getPlaceVisits(user, start, end)
  return visits.map((p) => ({
    address: p.address,
    detectedLocationId: p.detectedLocationId,
    duration: p.durationMinutes,
    endTime: p.endTime.toISOString(),
    lat: p.lat,
    lon: p.lon,
    name: p.name,
    source: p.source,
    startTime: p.startTime.toISOString(),
  }))
}
