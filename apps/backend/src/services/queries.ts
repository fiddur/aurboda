/**
 * Query services for health data.
 *
 * These functions contain the business logic for querying health data.
 * They are used by both the MCP tools and the REST API.
 */

import {
  getActivities,
  getDailyAggregates,
  getDailyAggregateValue,
  getLocations,
  getProductivity,
  getSleepSessions,
  getTags,
  getTimeSeries,
  getTimeSeriesMultiMetric,
  getTimeSeriesStats,
} from '../db'
import { ActivityType, MetricType, metricUnits } from '../schema'
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
}

export interface MetricDataPoint {
  time: string
  value: number
}

export interface QueryMetricsResult {
  metric: MetricType
  unit: string
  count: number
  data: MetricDataPoint[]
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
  region: string
  startTime: string
  endTime: string
  duration: number // minutes
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
  metric: MetricType
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
 */
export async function queryMetrics(
  user: string,
  metric: MetricType,
  start: Date,
  end: Date,
): Promise<QueryMetricsResult> {
  const data = await getTimeSeries(user, metric, start, end)
  const unit = metricUnits[metric]

  return {
    count: data.length,
    data: data.map(([time, value]) => ({ time: time.toISOString(), value })),
    metric,
    unit,
  }
}

/**
 * Get a comprehensive summary of health data for a specific day.
 * @param sync Optional sync provider to auto-refresh stale data before querying
 */
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
    locations,
    ouraMetrics,
  ] = await Promise.all([
    getTimeSeries(user, 'heart_rate', start, end),
    getTimeSeries(user, 'steps', start, end),
    getSleepSessions(user, start, end),
    getActivities(user, 'exercise', start, end),
    getTags(user, start, end),
    getProductivity(user, start, end),
    getLocations(user, start, end),
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
    places: locations.places.map((p) => ({
      duration: Math.round((p.endTime.getTime() - p.startTime.getTime()) / 1000 / 60),
      endTime: p.endTime.toISOString(),
      region: p.region,
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
 * Get aggregated statistics for a time period.
 */
export async function getPeriodSummary(
  user: string,
  metrics: MetricType[],
  start: Date,
  end: Date,
): Promise<PeriodSummaryResult> {
  // Calculate period length for previous period comparison
  const periodMs = end.getTime() - start.getTime()
  const prevStart = new Date(start.getTime() - periodMs)
  const prevEnd = new Date(start.getTime() - 1)

  // Fetch current and previous period stats in parallel
  const [currentStats, previousStats, dailyAggregates] = await Promise.all([
    getTimeSeriesStats(user, metrics, start, end),
    getTimeSeriesStats(user, metrics, prevStart, prevEnd),
    getDailyAggregates(user, metrics, start, end),
  ])

  // Calculate days in period for completeness calculation
  const daysInPeriod = Math.ceil(periodMs / (1000 * 60 * 60 * 24))

  // Build response with trends and completeness
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

  // Add metrics with no data in current period
  const missingMetrics = metrics.filter((m) => !currentStats.some((s) => s.metric === m))
  for (const metric of missingMetrics) {
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
      unit: metricUnits[metric],
    })
  }

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
    await sync.syncOuraIfNeeded(user, 'tags')
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
  const { places } = await getLocations(user, start, end)
  return places.map((p) => ({
    duration: Math.round((p.endTime.getTime() - p.startTime.getTime()) / 1000 / 60),
    endTime: p.endTime.toISOString(),
    region: p.region,
    startTime: p.startTime.toISOString(),
  }))
}
