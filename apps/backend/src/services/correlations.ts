/* eslint-disable max-lines -- TODO: refactor - split into correlations/ modules */
/**
 * Correlation analysis services for health data.
 *
 * Provides statistical analysis of correlations between HRV/HR and various
 * activity sources (RescueTime, locations, tags, activities).
 */

import type { MetricType } from '@aurboda/api-spec'

import { getActivities, getProductivity, getTags, getTimeSeries, getTimeSeriesStats } from '../db/index.ts'
import { getPlaceVisits } from './locations.ts'
import { queryMetrics, type SyncProvider } from './queries.ts'

// ============================================================================
// Types
// ============================================================================

/** HRV statistics for a context/activity */
export interface HrvStats {
  mean_hrv: number | null
  stddev_hrv: number | null
  mean_hr: number | null
  stddev_hr: number | null
  sample_minutes: number
  sample_count: number
}

/** HRV stats with baseline comparison */
export interface HrvStatsWithDelta extends HrvStats {
  hrv_delta_from_baseline: number | null
  hr_delta_from_baseline: number | null
}

/** Baseline statistics result */
export interface BaselineResult {
  hrv: {
    avg7day: number | null
    avg30day: number | null
    trend_percent: number | null
  }
  resting_hr: {
    avg7day: number | null
    avg30day: number | null
    trend_percent: number | null
  }
  period: {
    start: string
    end: string
  }
}

/** Correlation by productivity category */
export interface ProductivityCorrelation extends HrvStatsWithDelta {
  category: string
  /** Pearson correlation between productivity score and HRV (-1 to 1) */
  correlation_coefficient: number | null
}

/** Correlation by location */
export interface LocationCorrelation extends HrvStatsWithDelta {
  location_name: string
  visit_count: number
}

/** Correlation by activity type */
export interface ActivityCorrelation extends HrvStatsWithDelta {
  activity_type: string
  occurrences: number
  avg_duration_min: number
}

/** Correlation by tag */
export interface TagCorrelation extends HrvStatsWithDelta {
  tag: string
  occurrences: number
}

/** Movement state correlation */
export interface MovementCorrelation extends HrvStatsWithDelta {
  state: 'sedentary' | 'walking' | 'post_exercise_30min'
}

/** Full HRV-activities correlation result */
export interface HrvActivitiesResult {
  period: {
    start: string
    end: string
    days: number
  }
  baseline: HrvStats
  correlations: {
    productivity: ProductivityCorrelation[]
    locations: LocationCorrelation[]
    activities: ActivityCorrelation[]
    tags: TagCorrelation[]
  }
}

/** Time window stats for activity impact */
export interface TimeWindowStats {
  mean: number | null
  stddev: number | null
  sample_count: number
}

/** Activity impact timeline result */
export interface ActivityImpactResult {
  activity: string
  activity_type: 'productivity_category' | 'productivity_app' | 'location' | 'tag' | 'activity_type'
  occurrences: number
  avg_duration_min: number
  hrv_timeline: {
    before30min: TimeWindowStats
    before15min: TimeWindowStats
    during: TimeWindowStats
    after15min: TimeWindowStats
    after30min: TimeWindowStats
  }
  hr_timeline: {
    before30min: TimeWindowStats
    before15min: TimeWindowStats
    during: TimeWindowStats
    after15min: TimeWindowStats
    after30min: TimeWindowStats
  }
}

/** Lag window result for event probability */
export interface LagWindowResult {
  probability: number
  relative_risk: number
  occurrences: number
}

/** Event probability result */
export interface EventProbabilityResult {
  trigger: {
    type: 'activity' | 'tag'
    value: string
  }
  outcome: {
    type: 'tag'
    pattern: string
  }
  period: {
    start: string
    end: string
  }
  baseline: {
    probability: number
    description: string
  }
  post_trigger: Record<string, LagWindowResult>
  sample_size: {
    trigger_events: number
    outcome_events: number
    days_analyzed: number
  }
  statistical_significance: {
    chi_squared: number | null
    p_value: number | null
  }
}

// ============================================================================
// Generic Correlation Types
// ============================================================================

/** Trigger condition for generic correlation */
export interface TriggerCondition {
  type: 'activity' | 'tag' | 'productivity_category' | 'productivity_app'
  pattern: string
  /** Minimum count within the window (default: 1) */
  min_count?: number
  /** Rolling window in days for counting (default: 1) */
  window_days?: number
}

/** Tag outcome configuration */
export interface TagOutcome {
  type: 'tag'
  pattern: string
}

/** Metric outcome configuration */
export interface MetricOutcome {
  type: 'metric'
  /** Metric name (validated at API level) */
  metric: string
  /** Aggregation method for multiple values (default: 'mean') */
  aggregation?: 'mean' | 'min' | 'max' | 'last'
}

/** Productivity outcome configuration */
export interface ProductivityOutcome {
  type: 'productivity'
  /** Category to measure time in */
  category?: string
  /** Specific app to measure time in */
  app?: string
}

export type OutcomeConfig = TagOutcome | MetricOutcome | ProductivityOutcome

/** Result for tag outcomes in lag windows */
export interface TagLagResult {
  probability: number
  relative_risk: number
  occurrences: number
}

/** Result for metric outcomes in lag windows */
export interface MetricLagResult {
  mean: number | null
  stddev: number | null
  sample_count: number
  delta_from_baseline: number | null
}

/** Result for productivity outcomes in lag windows */
export interface ProductivityLagResult {
  total_minutes: number
  avg_minutes_per_day: number
  delta_from_baseline: number | null
}

export type LagResult = TagLagResult | MetricLagResult | ProductivityLagResult

/** Baseline stats for metric outcomes */
export interface MetricBaseline {
  mean: number | null
  stddev: number | null
  sample_count: number
}

/** Baseline stats for productivity outcomes */
export interface ProductivityBaseline {
  avg_minutes_per_day: number
  total_minutes: number
}

/** Baseline stats for tag outcomes */
export interface TagBaseline {
  probability: number
  description: string
}

export type BaselineStats = MetricBaseline | ProductivityBaseline | TagBaseline

/** Generic correlation result */
export interface GenericCorrelationResult {
  triggers: TriggerCondition[]
  outcome: OutcomeConfig
  period: {
    start: string
    end: string
    days: number
  }
  /** Number of windows where all trigger conditions were met */
  windows_matched: number
  /** Baseline statistics (periods without triggers) */
  baseline: BaselineStats
  /** Results for each lag window */
  post_trigger: Record<string, LagResult>
  statistical_significance: {
    chi_squared: number | null
    p_value: number | null
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate mean of an array of numbers.
 */
const mean = (values: number[]): number | null => {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * Calculate standard deviation of an array of numbers.
 */
const stddev = (values: number[]): number | null => {
  if (values.length < 2) return null
  const avg = mean(values)!
  const squareDiffs = values.map((v) => (v - avg) ** 2)
  return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / (values.length - 1))
}

/**
 * Calculate Pearson correlation coefficient between two arrays.
 */
const pearsonCorrelation = (x: number[], y: number[]): number | null => {
  if (x.length !== y.length || x.length < 3) return null

  const n = x.length
  const meanX = mean(x)!
  const meanY = mean(y)!

  let numerator = 0
  let denomX = 0
  let denomY = 0

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX
    const dy = y[i] - meanY
    numerator += dx * dy
    denomX += dx * dx
    denomY += dy * dy
  }

  const denominator = Math.sqrt(denomX * denomY)
  if (denominator === 0) return null

  return numerator / denominator
}

/**
 * Calculate chi-squared statistic and approximate p-value for 2x2 contingency table.
 */
const chiSquaredTest = (
  observed: [[number, number], [number, number]],
): { chiSquared: number; pValue: number } | null => {
  const [[a, b], [c, d]] = observed
  const total = a + b + c + d

  if (total === 0) return null

  // Expected values
  const rowTotals = [a + b, c + d]
  const colTotals = [a + c, b + d]

  const expected = [
    [(rowTotals[0] * colTotals[0]) / total, (rowTotals[0] * colTotals[1]) / total],
    [(rowTotals[1] * colTotals[0]) / total, (rowTotals[1] * colTotals[1]) / total],
  ]

  // Chi-squared statistic
  let chiSquared = 0
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      if (expected[i][j] > 0) {
        chiSquared += (observed[i][j] - expected[i][j]) ** 2 / expected[i][j]
      }
    }
  }

  // Approximate p-value using chi-squared distribution with 1 df
  // Using approximation: p ≈ exp(-0.5 * chi^2) for chi^2 > 3
  // More accurate approximation for 1 df
  const pValue = chiSquared > 0 ? Math.exp(-0.5 * chiSquared) : 1

  return { chiSquared, pValue }
}

/**
 * Get HRV/HR data points that fall within a time range.
 */
const getDataInRange = (data: [Date, number][], start: Date, end: Date): number[] => {
  return data.filter(([time]) => time >= start && time <= end).map(([, value]) => value)
}

/**
 * Calculate HRV stats from raw data arrays.
 */
const calculateHrvStats = (hrvValues: number[], hrValues: number[], durationMinutes: number): HrvStats => ({
  mean_hr: mean(hrValues),
  mean_hrv: mean(hrvValues),
  sample_count: hrvValues.length,
  sample_minutes: Math.round(durationMinutes),
  stddev_hr: stddev(hrValues),
  stddev_hrv: stddev(hrvValues),
})

/**
 * Add baseline delta to HRV stats.
 */
const addBaselineDelta = (stats: HrvStats, baseline: HrvStats): HrvStatsWithDelta => ({
  ...stats,
  hr_delta_from_baseline:
    stats.mean_hr !== null && baseline.mean_hr !== null
      ? Math.round((stats.mean_hr - baseline.mean_hr) * 10) / 10
      : null,
  hrv_delta_from_baseline:
    stats.mean_hrv !== null && baseline.mean_hrv !== null
      ? Math.round((stats.mean_hrv - baseline.mean_hrv) * 10) / 10
      : null,
})

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Get personal rolling baseline for HRV and resting HR.
 */
// eslint-disable-next-line complexity -- TODO: refactor
export async function getBaseline(user: string, referenceDate?: Date): Promise<BaselineResult> {
  const now = referenceDate ?? new Date()

  // Calculate date ranges
  const end7day = new Date(now)
  end7day.setHours(23, 59, 59, 999)
  const start7day = new Date(now)
  start7day.setDate(start7day.getDate() - 7)
  start7day.setHours(0, 0, 0, 0)

  const end30day = new Date(now)
  end30day.setHours(23, 59, 59, 999)
  const start30day = new Date(now)
  start30day.setDate(start30day.getDate() - 30)
  start30day.setHours(0, 0, 0, 0)

  // Previous 30-day period for trend calculation
  const prevStart30day = new Date(start30day)
  prevStart30day.setDate(prevStart30day.getDate() - 30)
  const prevEnd30day = new Date(start30day)
  prevEnd30day.setMilliseconds(-1)

  // Compute average from sleep HRV data (contextual metric, not stored directly)
  const getSleepHrvAvg = async (start: Date, end: Date): Promise<number | null> => {
    const result = await queryMetrics(user, 'hrv_sleep', start, end)
    if (result.count === 0) return null
    const sum = result.data.reduce((acc, d) => acc + d.value, 0)
    return sum / result.count
  }

  // Fetch sleep HRV and resting HR stats in parallel
  const [hrvAvg7day, hrvAvg30day, hrvAvgPrev30day, hrStats7day, hrStats30day, hrStatsPrev30day] =
    await Promise.all([
      getSleepHrvAvg(start7day, end7day),
      getSleepHrvAvg(start30day, end30day),
      getSleepHrvAvg(prevStart30day, prevEnd30day),
      getTimeSeriesStats(user, ['resting_heart_rate'], start7day, end7day),
      getTimeSeriesStats(user, ['resting_heart_rate'], start30day, end30day),
      getTimeSeriesStats(user, ['resting_heart_rate'], prevStart30day, prevEnd30day),
    ])

  // Calculate trends
  const hrvTrend =
    hrvAvg30day !== null && hrvAvgPrev30day !== null
      ? ((hrvAvg30day - hrvAvgPrev30day) / hrvAvgPrev30day) * 100
      : null

  const hrTrend =
    hrStats30day[0]?.avg && hrStatsPrev30day[0]?.avg
      ? ((hrStats30day[0].avg - hrStatsPrev30day[0].avg) / hrStatsPrev30day[0].avg) * 100
      : null

  return {
    hrv: {
      avg7day: hrvAvg7day !== null ? Math.round(hrvAvg7day * 10) / 10 : null,
      avg30day: hrvAvg30day !== null ? Math.round(hrvAvg30day * 10) / 10 : null,
      trend_percent: hrvTrend !== null ? Math.round(hrvTrend * 10) / 10 : null,
    },
    period: {
      end: end30day.toISOString(),
      start: start30day.toISOString(),
    },
    resting_hr: {
      avg7day: hrStats7day[0]?.avg ? Math.round(hrStats7day[0].avg * 10) / 10 : null,
      avg30day: hrStats30day[0]?.avg ? Math.round(hrStats30day[0].avg * 10) / 10 : null,
      trend_percent: hrTrend !== null ? Math.round(hrTrend * 10) / 10 : null,
    },
  }
}

/**
 * Get HRV/HR correlations with different activity types.
 */
// eslint-disable-next-line complexity -- TODO: refactor
export async function getHrvActivitiesCorrelation(
  user: string,
  periodDays: number = 30,
  sync?: SyncProvider,
): Promise<HrvActivitiesResult> {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date()
  start.setDate(start.getDate() - periodDays)
  start.setHours(0, 0, 0, 0)

  // Auto-sync if provider available
  if (sync) {
    await Promise.all([
      sync.syncOuraIfNeeded(user, 'tags'),
      sync.syncOuraIfNeeded(user, 'sessions'),
      sync.syncRescueTimeIfNeeded(user),
      sync.syncCalendarsIfNeeded(user),
    ])
  }

  // Fetch all data in parallel
  const [hrvData, hrData, productivity, locations, activities, tags] = await Promise.all([
    getTimeSeries(user, 'hrv_rmssd', start, end),
    getTimeSeries(user, 'heart_rate', start, end),
    getProductivity(user, start, end),
    getPlaceVisits(user, start, end),
    getActivities(user, ['exercise', 'meditation', 'nap'], start, end),
    getTags(user, start, end),
  ])

  // Calculate baseline stats
  const baselineHrvValues = hrvData.map(([, v]) => v)
  const baselineHrValues = hrData.map(([, v]) => v)
  const totalMinutes = periodDays * 24 * 60
  const baseline = calculateHrvStats(baselineHrvValues, baselineHrValues, totalMinutes)

  // === Productivity correlations by category ===
  const productivityByCategory = new Map<
    string,
    { hrvValues: number[]; hrValues: number[]; minutes: number; scores: number[] }
  >()

  for (const record of productivity) {
    const category = record.resolved_category?.join(' > ') || record.category || 'Uncategorized'
    if (!productivityByCategory.has(category)) {
      productivityByCategory.set(category, { hrValues: [], hrvValues: [], minutes: 0, scores: [] })
    }
    const cat = productivityByCategory.get(category)!
    cat.minutes += record.duration_sec / 60

    // Get HRV/HR during this productivity window
    const hrvInWindow = getDataInRange(hrvData, record.start_time, record.end_time)
    const hrInWindow = getDataInRange(hrData, record.start_time, record.end_time)
    cat.hrvValues.push(...hrvInWindow)
    cat.hrValues.push(...hrInWindow)

    if (record.productivity !== undefined && record.productivity !== null) {
      // Add productivity score for correlation calculation - one score per HRV value
      cat.scores.push(...hrvInWindow.map(() => record.productivity!))
    }
  }

  const productivityCorrelations: ProductivityCorrelation[] = []
  for (const [category, data] of productivityByCategory) {
    if (data.minutes < 10) continue // Skip categories with < 10 min data

    const stats = calculateHrvStats(data.hrvValues, data.hrValues, data.minutes)
    const statsWithDelta = addBaselineDelta(stats, baseline)

    // Calculate correlation between productivity score and HRV
    const correlation =
      data.scores.length >= 3 && data.hrvValues.length === data.scores.length
        ? pearsonCorrelation(data.scores, data.hrvValues)
        : null

    productivityCorrelations.push({
      ...statsWithDelta,
      category,
      correlation_coefficient: correlation !== null ? Math.round(correlation * 100) / 100 : null,
    })
  }

  // Sort by sample minutes descending
  productivityCorrelations.sort((a, b) => b.sample_minutes - a.sample_minutes)

  // === Location correlations ===
  const locationByName = new Map<
    string,
    { hrvValues: number[]; hrValues: number[]; minutes: number; visits: number }
  >()

  for (const visit of locations) {
    const name = visit.name || 'Unknown'
    if (!locationByName.has(name)) {
      locationByName.set(name, { hrValues: [], hrvValues: [], minutes: 0, visits: 0 })
    }
    const loc = locationByName.get(name)!
    loc.minutes += visit.duration_minutes
    loc.visits++

    const hrvInWindow = getDataInRange(hrvData, visit.start_time, visit.end_time)
    const hrInWindow = getDataInRange(hrData, visit.start_time, visit.end_time)
    loc.hrvValues.push(...hrvInWindow)
    loc.hrValues.push(...hrInWindow)
  }

  const locationCorrelations: LocationCorrelation[] = []
  for (const [name, data] of locationByName) {
    if (data.minutes < 30) continue // Skip locations with < 30 min

    const stats = calculateHrvStats(data.hrvValues, data.hrValues, data.minutes)
    const statsWithDelta = addBaselineDelta(stats, baseline)

    locationCorrelations.push({
      ...statsWithDelta,
      location_name: name,
      visit_count: data.visits,
    })
  }

  locationCorrelations.sort((a, b) => b.sample_minutes - a.sample_minutes)

  // === Activity correlations ===
  const activityByType = new Map<
    string,
    { hrvValues: number[]; hrValues: number[]; minutes: number; count: number }
  >()

  for (const activity of activities) {
    const type = activity.activity_type
    if (!activityByType.has(type)) {
      activityByType.set(type, { count: 0, hrValues: [], hrvValues: [], minutes: 0 })
    }
    const act = activityByType.get(type)!
    act.count++

    if (activity.end_time) {
      const durationMin = (activity.end_time.getTime() - activity.start_time.getTime()) / 1000 / 60
      act.minutes += durationMin

      const hrvInWindow = getDataInRange(hrvData, activity.start_time, activity.end_time)
      const hrInWindow = getDataInRange(hrData, activity.start_time, activity.end_time)
      act.hrvValues.push(...hrvInWindow)
      act.hrValues.push(...hrInWindow)
    }
  }

  const activityCorrelations: ActivityCorrelation[] = []
  for (const [type, data] of activityByType) {
    if (data.count < 1) continue

    const stats = calculateHrvStats(data.hrvValues, data.hrValues, data.minutes)
    const statsWithDelta = addBaselineDelta(stats, baseline)

    activityCorrelations.push({
      ...statsWithDelta,
      activity_type: type,
      avg_duration_min: data.count > 0 ? Math.round(data.minutes / data.count) : 0,
      occurrences: data.count,
    })
  }

  activityCorrelations.sort((a, b) => b.occurrences - a.occurrences)

  // === Tag correlations ===
  const tagByName = new Map<
    string,
    { hrvValues: number[]; hrValues: number[]; minutes: number; count: number }
  >()

  for (const tag of tags) {
    const name = tag.tag
    if (!tagByName.has(name)) {
      tagByName.set(name, { count: 0, hrValues: [], hrvValues: [], minutes: 0 })
    }
    const t = tagByName.get(name)!
    t.count++

    // For tags, look at a window around the tag time (30 min before and after)
    const windowStart = new Date(tag.start_time.getTime() - 30 * 60 * 1000)
    const windowEnd = tag.end_time ?? new Date(tag.start_time.getTime() + 30 * 60 * 1000)
    const durationMin = (windowEnd.getTime() - tag.start_time.getTime()) / 1000 / 60
    t.minutes += durationMin

    const hrvInWindow = getDataInRange(hrvData, windowStart, windowEnd)
    const hrInWindow = getDataInRange(hrData, windowStart, windowEnd)
    t.hrvValues.push(...hrvInWindow)
    t.hrValues.push(...hrInWindow)
  }

  const tagCorrelations: TagCorrelation[] = []
  for (const [name, data] of tagByName) {
    if (data.count < 2) continue // Skip tags with < 2 occurrences

    const stats = calculateHrvStats(data.hrvValues, data.hrValues, data.minutes)
    const statsWithDelta = addBaselineDelta(stats, baseline)

    tagCorrelations.push({
      ...statsWithDelta,
      occurrences: data.count,
      tag: name,
    })
  }

  tagCorrelations.sort((a, b) => b.occurrences - a.occurrences)

  return {
    baseline,
    correlations: {
      activities: activityCorrelations,
      locations: locationCorrelations,
      productivity: productivityCorrelations,
      tags: tagCorrelations,
    },
    period: {
      days: periodDays,
      end: end.toISOString(),
      start: start.toISOString(),
    },
  }
}

/**
 * Get HRV timeline before/during/after a specific activity type.
 */
// eslint-disable-next-line complexity -- TODO: refactor
export async function getActivityImpact(
  user: string,
  activity: string,
  activityType: 'productivity_category' | 'productivity_app' | 'location' | 'tag' | 'activity_type',
  windowMinutes: number = 30,
  periodDays: number = 90,
  sync?: SyncProvider,
): Promise<ActivityImpactResult> {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date()
  start.setDate(start.getDate() - periodDays)
  start.setHours(0, 0, 0, 0)

  // Auto-sync if provider available
  if (sync) {
    await Promise.all([
      sync.syncOuraIfNeeded(user, 'tags'),
      sync.syncOuraIfNeeded(user, 'sessions'),
      sync.syncRescueTimeIfNeeded(user),
      sync.syncCalendarsIfNeeded(user),
    ])
  }

  // Fetch HRV/HR data
  const [hrvData, hrData] = await Promise.all([
    getTimeSeries(user, 'hrv_rmssd', start, end),
    getTimeSeries(user, 'heart_rate', start, end),
  ])

  // Find activity occurrences based on type
  interface ActivityWindow {
    startTime: Date
    endTime: Date
    durationMin: number
  }
  const occurrences: ActivityWindow[] = []

  if (activityType === 'productivity_category' || activityType === 'productivity_app') {
    const productivity = await getProductivity(user, start, end)
    for (const record of productivity) {
      const resolvedCatStr = record.resolved_category?.join(' > ')
      const matches =
        activityType === 'productivity_category'
          ? resolvedCatStr?.toLowerCase() === activity.toLowerCase() ||
            record.category?.toLowerCase() === activity.toLowerCase()
          : record.activity.toLowerCase().includes(activity.toLowerCase())

      if (matches) {
        occurrences.push({
          durationMin: record.duration_sec / 60,
          endTime: record.end_time,
          startTime: record.start_time,
        })
      }
    }
  } else if (activityType === 'location') {
    const locations = await getPlaceVisits(user, start, end)
    for (const visit of locations) {
      if (visit.name.toLowerCase().includes(activity.toLowerCase())) {
        occurrences.push({
          durationMin: visit.duration_minutes,
          endTime: visit.end_time,
          startTime: visit.start_time,
        })
      }
    }
  } else if (activityType === 'tag') {
    const tags = await getTags(user, start, end)
    for (const tag of tags) {
      if (tag.tag.toLowerCase().includes(activity.toLowerCase())) {
        const endTime = tag.end_time ?? new Date(tag.start_time.getTime() + 5 * 60 * 1000) // Default 5 min for point tags
        occurrences.push({
          durationMin: (endTime.getTime() - tag.start_time.getTime()) / 1000 / 60,
          endTime,
          startTime: tag.start_time,
        })
      }
    }
  } else if (activityType === 'activity_type') {
    const activities = await getActivities(
      user,
      [activity as 'exercise' | 'meditation' | 'nap' | 'sleep'],
      start,
      end,
    )
    for (const act of activities) {
      if (act.end_time) {
        occurrences.push({
          durationMin: (act.end_time.getTime() - act.start_time.getTime()) / 1000 / 60,
          endTime: act.end_time,
          startTime: act.start_time,
        })
      }
    }
  }

  // Collect HRV/HR for each time window
  const windows = {
    after15min: { hr: [] as number[], hrv: [] as number[] },
    after30min: { hr: [] as number[], hrv: [] as number[] },
    before15min: { hr: [] as number[], hrv: [] as number[] },
    before30min: { hr: [] as number[], hrv: [] as number[] },
    during: { hr: [] as number[], hrv: [] as number[] },
  }

  let totalDurationMin = 0

  for (const occ of occurrences) {
    totalDurationMin += occ.durationMin

    // Before 30 min (from -30 to -15)
    const before30Start = new Date(occ.startTime.getTime() - windowMinutes * 60 * 1000)
    const before30End = new Date(occ.startTime.getTime() - (windowMinutes / 2) * 60 * 1000)
    windows.before30min.hrv.push(...getDataInRange(hrvData, before30Start, before30End))
    windows.before30min.hr.push(...getDataInRange(hrData, before30Start, before30End))

    // Before 15 min (from -15 to 0)
    const before15Start = new Date(occ.startTime.getTime() - (windowMinutes / 2) * 60 * 1000)
    windows.before15min.hrv.push(...getDataInRange(hrvData, before15Start, occ.startTime))
    windows.before15min.hr.push(...getDataInRange(hrData, before15Start, occ.startTime))

    // During
    windows.during.hrv.push(...getDataInRange(hrvData, occ.startTime, occ.endTime))
    windows.during.hr.push(...getDataInRange(hrData, occ.startTime, occ.endTime))

    // After 15 min (from end to +15)
    const after15End = new Date(occ.endTime.getTime() + (windowMinutes / 2) * 60 * 1000)
    windows.after15min.hrv.push(...getDataInRange(hrvData, occ.endTime, after15End))
    windows.after15min.hr.push(...getDataInRange(hrData, occ.endTime, after15End))

    // After 30 min (from +15 to +30)
    const after30End = new Date(occ.endTime.getTime() + windowMinutes * 60 * 1000)
    windows.after30min.hrv.push(...getDataInRange(hrvData, after15End, after30End))
    windows.after30min.hr.push(...getDataInRange(hrData, after15End, after30End))
  }

  const calculateWindowStats = (values: number[]): TimeWindowStats => ({
    mean: mean(values) !== null ? Math.round(mean(values)! * 10) / 10 : null,
    sample_count: values.length,
    stddev: stddev(values) !== null ? Math.round(stddev(values)! * 10) / 10 : null,
  })

  return {
    activity,
    activity_type: activityType,
    avg_duration_min: occurrences.length > 0 ? Math.round(totalDurationMin / occurrences.length) : 0,
    hr_timeline: {
      after15min: calculateWindowStats(windows.after15min.hr),
      after30min: calculateWindowStats(windows.after30min.hr),
      before15min: calculateWindowStats(windows.before15min.hr),
      before30min: calculateWindowStats(windows.before30min.hr),
      during: calculateWindowStats(windows.during.hr),
    },
    hrv_timeline: {
      after15min: calculateWindowStats(windows.after15min.hrv),
      after30min: calculateWindowStats(windows.after30min.hrv),
      before15min: calculateWindowStats(windows.before15min.hrv),
      before30min: calculateWindowStats(windows.before30min.hrv),
      during: calculateWindowStats(windows.during.hrv),
    },
    occurrences: occurrences.length,
  }
}

/**
 * Get probability of outcome event after trigger event (for discrete event correlation).
 */
// eslint-disable-next-line complexity -- TODO: refactor
export async function getEventProbability(
  user: string,
  trigger: { type: 'activity' | 'tag'; value: string },
  outcome: { type: 'tag'; pattern: string },
  lagWindows: string[] = ['12h', '24h', '36h', '48h'],
  periodDays: number = 365,
  sync?: SyncProvider,
): Promise<EventProbabilityResult> {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date()
  start.setDate(start.getDate() - periodDays)
  start.setHours(0, 0, 0, 0)

  // Auto-sync if provider available
  if (sync) {
    await Promise.all([
      sync.syncOuraIfNeeded(user, 'tags'),
      sync.syncOuraIfNeeded(user, 'sessions'),
      sync.syncCalendarsIfNeeded(user),
    ])
  }

  // Parse outcome pattern as regex
  const outcomeRegex = new RegExp(outcome.pattern, 'i')

  // Get trigger events
  let triggerEvents: Date[] = []

  if (trigger.type === 'tag') {
    const tags = await getTags(user, start, end)
    triggerEvents = tags
      .filter((t) => t.tag.toLowerCase().includes(trigger.value.toLowerCase()))
      .map((t) => t.start_time)
  } else if (trigger.type === 'activity') {
    const activities = await getActivities(
      user,
      [trigger.value as 'exercise' | 'meditation' | 'nap' | 'sleep'],
      start,
      end,
    )
    triggerEvents = activities.map((a) => a.start_time)
  }

  // Get all outcome events (tags matching pattern)
  const allTags = await getTags(user, start, end)
  const outcomeEvents = allTags.filter((t) => outcomeRegex.test(t.tag)).map((t) => t.start_time)

  // Calculate baseline probability (outcome on any given day)
  const daysWithOutcome = new Set<string>()
  for (const event of outcomeEvents) {
    daysWithOutcome.add(event.toISOString().split('T')[0])
  }
  const baselineProbability = daysWithOutcome.size / periodDays

  // Calculate probability for each lag window
  const postTrigger: Record<string, LagWindowResult> = {}

  for (const lag of lagWindows) {
    // Parse lag (e.g., "24h" -> 24 hours)
    const lagMatch = lag.match(/^(\d+)([hd])$/)
    if (!lagMatch) continue

    const lagValue = parseInt(lagMatch[1], 10)
    const lagUnit = lagMatch[2]
    const lagMs = lagUnit === 'h' ? lagValue * 60 * 60 * 1000 : lagValue * 24 * 60 * 60 * 1000

    // Count outcomes within lag window after each trigger
    let outcomesAfterTrigger = 0
    const triggersWithOutcome = new Set<number>()

    for (let i = 0; i < triggerEvents.length; i++) {
      const triggerTime = triggerEvents[i]
      const windowEnd = new Date(triggerTime.getTime() + lagMs)

      for (const outcomeTime of outcomeEvents) {
        if (outcomeTime > triggerTime && outcomeTime <= windowEnd) {
          outcomesAfterTrigger++
          triggersWithOutcome.add(i)
          break // Only count first outcome per trigger
        }
      }
    }

    const probability = triggerEvents.length > 0 ? triggersWithOutcome.size / triggerEvents.length : 0
    const relativeRisk = baselineProbability > 0 ? probability / baselineProbability : 0

    postTrigger[lag] = {
      occurrences: outcomesAfterTrigger,
      probability: Math.round(probability * 100) / 100,
      relative_risk: Math.round(relativeRisk * 100) / 100,
    }
  }

  // Calculate chi-squared for overall significance (using 24h window as primary)
  const primaryLag = postTrigger['24h'] ?? postTrigger[lagWindows[0]]
  let chiSquaredResult: { chiSquared: number; pValue: number } | null = null

  if (primaryLag && triggerEvents.length > 0) {
    // Build 2x2 contingency table: trigger (yes/no) x outcome within window (yes/no)
    const triggersWithOutcome24h = Math.round(primaryLag.probability * triggerEvents.length)
    const triggersWithoutOutcome = triggerEvents.length - triggersWithOutcome24h
    const nonTriggersWithOutcome = daysWithOutcome.size - triggersWithOutcome24h
    const nonTriggersWithoutOutcome = periodDays - triggerEvents.length - nonTriggersWithOutcome

    chiSquaredResult = chiSquaredTest([
      [triggersWithOutcome24h, triggersWithoutOutcome],
      [Math.max(0, nonTriggersWithOutcome), Math.max(0, nonTriggersWithoutOutcome)],
    ])
  }

  return {
    baseline: {
      description: 'P(outcome on any given day)',
      probability: Math.round(baselineProbability * 100) / 100,
    },
    outcome: {
      pattern: outcome.pattern,
      type: outcome.type,
    },
    period: {
      end: end.toISOString(),
      start: start.toISOString(),
    },
    post_trigger: postTrigger,
    sample_size: {
      days_analyzed: periodDays,
      outcome_events: outcomeEvents.length,
      trigger_events: triggerEvents.length,
    },
    statistical_significance: {
      chi_squared:
        chiSquaredResult?.chiSquared !== undefined
          ? Math.round(chiSquaredResult.chiSquared * 100) / 100
          : null,
      p_value:
        chiSquaredResult?.pValue !== undefined ? Math.round(chiSquaredResult.pValue * 1000) / 1000 : null,
    },
    trigger: {
      type: trigger.type,
      value: trigger.value,
    },
  }
}

// ============================================================================
// Generic Correlation Function
// ============================================================================

/** Parse lag window string (e.g., "24h", "7d") to milliseconds */
const parseLagWindow = (lag: string): number | null => {
  const match = lag.match(/^(\d+)([hd])$/)
  if (!match) return null

  const value = parseInt(match[1], 10)
  const unit = match[2]
  return unit === 'h' ? value * 60 * 60 * 1000 : value * 24 * 60 * 60 * 1000
}

/** Get the day string (YYYY-MM-DD) for a date */
const getDayString = (date: Date): string => date.toISOString().split('T')[0]

/** Check if a string matches a pattern (case-insensitive) */
const matchesPattern = (value: string, pattern: string): boolean => {
  try {
    const regex = new RegExp(pattern, 'i')
    return regex.test(value)
  } catch {
    // Fall back to simple includes
    return value.toLowerCase().includes(pattern.toLowerCase())
  }
}

interface EventWithTime {
  time: Date
  type: 'activity' | 'tag' | 'productivity_category' | 'productivity_app'
  value: string
}

/**
 * Generic correlation analysis supporting compound triggers and multiple outcome types.
 *
 * This function allows correlating multiple trigger conditions (AND logic) with
 * various outcome types (tags, metrics, productivity time).
 *
 * Examples:
 * - "Does meditation correlate with more productive time?"
 * - "When I exercise 3x and tag FatCoffee 5x in a week, does my weight change?"
 */
// eslint-disable-next-line complexity -- TODO: refactor
export async function getGenericCorrelation(
  user: string,
  triggers: TriggerCondition[],
  outcome: OutcomeConfig,
  lagWindows: string[] = ['24h', '48h', '7d'],
  periodDays: number = 90,
  sync?: SyncProvider,
): Promise<GenericCorrelationResult> {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date()
  start.setDate(start.getDate() - periodDays)
  start.setHours(0, 0, 0, 0)

  // Auto-sync if provider available
  if (sync) {
    await Promise.all([
      sync.syncOuraIfNeeded(user, 'tags'),
      sync.syncOuraIfNeeded(user, 'sessions'),
      sync.syncRescueTimeIfNeeded(user),
      sync.syncCalendarsIfNeeded(user),
    ])
  }

  // Determine which data we need based on triggers and outcome
  const needsActivities = triggers.some((t) => t.type === 'activity') || (outcome.type === 'tag' && false) // activities for triggers
  const needsTags = triggers.some((t) => t.type === 'tag') || outcome.type === 'tag'
  const needsProductivity =
    triggers.some((t) => t.type === 'productivity_category' || t.type === 'productivity_app') ||
    outcome.type === 'productivity'
  const needsMetrics = outcome.type === 'metric'

  // Fetch data in parallel
  const [activities, tags, productivity, metricData] = await Promise.all([
    needsActivities
      ? getActivities(user, ['exercise', 'meditation', 'nap', 'sleep'], start, end)
      : Promise.resolve([]),
    needsTags ? getTags(user, start, end) : Promise.resolve([]),
    needsProductivity ? getProductivity(user, start, end) : Promise.resolve([]),
    needsMetrics && outcome.type === 'metric'
      ? getTimeSeries(user, outcome.metric as MetricType, start, end)
      : Promise.resolve([] as [Date, number][]),
  ])

  // Build a list of all trigger events with timestamps
  const triggerEvents: EventWithTime[] = []

  for (const trigger of triggers) {
    if (trigger.type === 'activity') {
      for (const act of activities) {
        if (matchesPattern(act.activity_type, trigger.pattern)) {
          triggerEvents.push({
            time: act.start_time,
            type: 'activity',
            value: act.activity_type,
          })
        }
      }
    } else if (trigger.type === 'tag') {
      for (const tag of tags) {
        if (matchesPattern(tag.tag, trigger.pattern)) {
          triggerEvents.push({
            time: tag.start_time,
            type: 'tag',
            value: tag.tag,
          })
        }
      }
    } else if (trigger.type === 'productivity_category') {
      for (const prod of productivity) {
        const resolvedCatStr = prod.resolved_category?.join(' > ')
        const catStr = resolvedCatStr || prod.category
        if (catStr && matchesPattern(catStr, trigger.pattern)) {
          triggerEvents.push({
            time: prod.start_time,
            type: 'productivity_category',
            value: catStr,
          })
        }
      }
    } else if (trigger.type === 'productivity_app') {
      for (const prod of productivity) {
        if (matchesPattern(prod.activity, trigger.pattern)) {
          triggerEvents.push({
            time: prod.start_time,
            type: 'productivity_app',
            value: prod.activity,
          })
        }
      }
    }
  }

  // Check if this is a "simple" trigger setup (single trigger with default counts)
  // For simple triggers, we use actual event times; for compound, we use day-based windows
  const isSimpleTrigger =
    triggers.length === 1 && (triggers[0].min_count ?? 1) === 1 && (triggers[0].window_days ?? 1) === 1

  // Find windows where ALL trigger conditions are met
  const matchedWindowEnds: Date[] = []
  const unmatchedDays: string[] = []

  if (isSimpleTrigger) {
    // Simple case: use actual trigger event times
    const trigger = triggers[0]
    const matchingEvents = triggerEvents.filter(
      (e) => e.type === trigger.type && matchesPattern(e.value, trigger.pattern),
    )

    // Use each trigger event time as a matched window
    for (const event of matchingEvents) {
      if (event.time >= start && event.time <= end) {
        matchedWindowEnds.push(event.time)
      }
    }

    // Track days without triggers for baseline
    const daysWithTriggers = new Set(matchingEvents.map((e) => getDayString(e.time)))
    for (let dayOffset = 0; dayOffset < periodDays; dayOffset++) {
      const day = new Date(start)
      day.setDate(day.getDate() + dayOffset)
      const dayStr = getDayString(day)
      if (!daysWithTriggers.has(dayStr)) {
        unmatchedDays.push(dayStr)
      }
    }
  } else {
    // Compound case: iterate through each day and check if all conditions are met
    for (let dayOffset = 0; dayOffset < periodDays; dayOffset++) {
      const windowEnd = new Date(start)
      windowEnd.setDate(windowEnd.getDate() + dayOffset)
      windowEnd.setHours(23, 59, 59, 999)

      let allConditionsMet = true

      for (const trigger of triggers) {
        const windowDays = trigger.window_days ?? 1
        const minCount = trigger.min_count ?? 1

        const windowStart = new Date(windowEnd)
        windowStart.setDate(windowStart.getDate() - windowDays + 1)
        windowStart.setHours(0, 0, 0, 0)

        // Count events matching this trigger in the window
        const count = triggerEvents.filter((e) => {
          if (e.type !== trigger.type) return false
          if (!matchesPattern(e.value, trigger.pattern)) return false
          return e.time >= windowStart && e.time <= windowEnd
        }).length

        if (count < minCount) {
          allConditionsMet = false
          break
        }
      }

      if (allConditionsMet && triggers.length > 0) {
        matchedWindowEnds.push(windowEnd)
      } else {
        unmatchedDays.push(getDayString(windowEnd))
      }
    }
  }

  // Calculate outcomes for each lag window
  const postTrigger: Record<string, LagResult> = {}

  // Get outcome events/data for tag outcomes
  const outcomeTagEvents =
    outcome.type === 'tag'
      ? tags.filter((t) => matchesPattern(t.tag, outcome.pattern)).map((t) => t.start_time)
      : []

  for (const lag of lagWindows) {
    const lagMs = parseLagWindow(lag)
    if (lagMs === null) continue

    if (outcome.type === 'tag') {
      // Count how many matched windows had the outcome tag within the lag window
      let windowsWithOutcome = 0

      for (const windowEnd of matchedWindowEnds) {
        const lagEnd = new Date(windowEnd.getTime() + lagMs)

        const hasOutcome = outcomeTagEvents.some((t) => t > windowEnd && t <= lagEnd)
        if (hasOutcome) windowsWithOutcome++
      }

      const probability = matchedWindowEnds.length > 0 ? windowsWithOutcome / matchedWindowEnds.length : 0

      // Calculate baseline probability (outcome on days without triggers)
      const daysWithOutcome = new Set(outcomeTagEvents.map(getDayString))
      const baselineDaysWithOutcome = unmatchedDays.filter((d) => daysWithOutcome.has(d)).length
      const baselineProbability =
        unmatchedDays.length > 0 ? baselineDaysWithOutcome / unmatchedDays.length : 0
      const relativeRisk = baselineProbability > 0 ? probability / baselineProbability : 0

      postTrigger[lag] = {
        occurrences: windowsWithOutcome,
        probability: Math.round(probability * 100) / 100,
        relative_risk: Math.round(relativeRisk * 100) / 100,
      }
    } else if (outcome.type === 'metric') {
      // Collect metric values within the lag window after each matched window
      const valuesAfterTrigger: number[] = []

      for (const windowEnd of matchedWindowEnds) {
        const lagEnd = new Date(windowEnd.getTime() + lagMs)

        const valuesInWindow = metricData
          .filter(([time]) => time > windowEnd && time <= lagEnd)
          .map(([, value]) => value)

        valuesAfterTrigger.push(...valuesInWindow)
      }

      const meanAfter = mean(valuesAfterTrigger)
      const stddevAfter = stddev(valuesAfterTrigger)

      // Calculate baseline (values on days without triggers)
      const unmatchedDaysSet = new Set(unmatchedDays)
      const baselineValues = metricData
        .filter(([time]) => unmatchedDaysSet.has(getDayString(time)))
        .map(([, value]) => value)

      const baselineMean = mean(baselineValues)
      const delta =
        meanAfter !== null && baselineMean !== null
          ? Math.round((meanAfter - baselineMean) * 100) / 100
          : null

      postTrigger[lag] = {
        delta_from_baseline: delta,
        mean: meanAfter !== null ? Math.round(meanAfter * 100) / 100 : null,
        sample_count: valuesAfterTrigger.length,
        stddev: stddevAfter !== null ? Math.round(stddevAfter * 100) / 100 : null,
      }
    } else if (outcome.type === 'productivity') {
      // Sum time in the specified category/app within the lag window
      let totalMinutes = 0
      let daysCounted = 0

      for (const windowEnd of matchedWindowEnds) {
        const lagEnd = new Date(windowEnd.getTime() + lagMs)
        daysCounted++

        for (const prod of productivity) {
          if (prod.start_time <= windowEnd || prod.start_time > lagEnd) continue

          const prodCatStr = prod.resolved_category?.join(' > ') || prod.category
          const matchesCategory =
            !outcome.category || (prodCatStr && matchesPattern(prodCatStr, outcome.category))
          const matchesApp = !outcome.app || matchesPattern(prod.activity, outcome.app)

          if (matchesCategory && matchesApp) {
            totalMinutes += prod.duration_sec / 60
          }
        }
      }

      // Calculate baseline
      const lagDays = lagMs / (24 * 60 * 60 * 1000)
      let baselineTotalMinutes = 0
      let baselineDays = 0
      const unmatchedDaysSet = new Set(unmatchedDays)

      for (const prod of productivity) {
        const dayStr = getDayString(prod.start_time)
        if (!unmatchedDaysSet.has(dayStr)) continue

        const matchesCategory =
          !outcome.category || (prod.category && matchesPattern(prod.category, outcome.category))
        const matchesApp = !outcome.app || matchesPattern(prod.activity, outcome.app)

        if (matchesCategory && matchesApp) {
          baselineTotalMinutes += prod.duration_sec / 60
        }
      }
      baselineDays = unmatchedDays.length

      const avgMinutesPerDay = daysCounted > 0 ? totalMinutes / (daysCounted * lagDays) : 0
      const baselineAvgMinutes = baselineDays > 0 ? baselineTotalMinutes / baselineDays : 0
      const delta =
        avgMinutesPerDay > 0 && baselineAvgMinutes > 0
          ? Math.round((avgMinutesPerDay - baselineAvgMinutes) * 100) / 100
          : null

      postTrigger[lag] = {
        avg_minutes_per_day: Math.round(avgMinutesPerDay * 100) / 100,
        delta_from_baseline: delta,
        total_minutes: Math.round(totalMinutes * 100) / 100,
      }
    }
  }

  // Calculate baseline stats
  let baseline: BaselineStats

  if (outcome.type === 'tag') {
    const daysWithOutcome = new Set(outcomeTagEvents.map(getDayString))
    const probability = periodDays > 0 ? daysWithOutcome.size / periodDays : 0

    baseline = {
      description: 'P(outcome on any given day)',
      probability: Math.round(probability * 100) / 100,
    }
  } else if (outcome.type === 'metric') {
    const unmatchedDaysSet = new Set(unmatchedDays)
    const baselineValues = metricData
      .filter(([time]) => unmatchedDaysSet.has(getDayString(time)))
      .map(([, value]) => value)

    baseline = {
      mean: mean(baselineValues) !== null ? Math.round(mean(baselineValues)! * 100) / 100 : null,
      sample_count: baselineValues.length,
      stddev: stddev(baselineValues) !== null ? Math.round(stddev(baselineValues)! * 100) / 100 : null,
    }
  } else {
    // productivity
    let baselineTotalMinutes = 0
    const unmatchedDaysSet = new Set(unmatchedDays)

    for (const prod of productivity) {
      const dayStr = getDayString(prod.start_time)
      if (!unmatchedDaysSet.has(dayStr)) continue

      const matchesCategory =
        !outcome.category || (prod.category && matchesPattern(prod.category, outcome.category))
      const matchesApp = !outcome.app || matchesPattern(prod.activity, outcome.app)

      if (matchesCategory && matchesApp) {
        baselineTotalMinutes += prod.duration_sec / 60
      }
    }

    const avgMinutesPerDay = unmatchedDays.length > 0 ? baselineTotalMinutes / unmatchedDays.length : 0

    baseline = {
      avg_minutes_per_day: Math.round(avgMinutesPerDay * 100) / 100,
      total_minutes: Math.round(baselineTotalMinutes * 100) / 100,
    }
  }

  // Calculate chi-squared for tag outcomes (using first lag window)
  let chiSquaredResult: { chiSquared: number; pValue: number } | null = null

  if (outcome.type === 'tag' && matchedWindowEnds.length > 0) {
    const primaryLag = postTrigger[lagWindows[0]] as TagLagResult | undefined
    if (primaryLag) {
      const triggersWithOutcome = Math.round(primaryLag.probability * matchedWindowEnds.length)
      const triggersWithoutOutcome = matchedWindowEnds.length - triggersWithOutcome

      const daysWithOutcome = new Set(outcomeTagEvents.map(getDayString))
      const nonTriggersWithOutcome = unmatchedDays.filter((d) => daysWithOutcome.has(d)).length
      const nonTriggersWithoutOutcome = unmatchedDays.length - nonTriggersWithOutcome

      chiSquaredResult = chiSquaredTest([
        [triggersWithOutcome, triggersWithoutOutcome],
        [Math.max(0, nonTriggersWithOutcome), Math.max(0, nonTriggersWithoutOutcome)],
      ])
    }
  }

  return {
    baseline,
    outcome,
    period: {
      days: periodDays,
      end: end.toISOString(),
      start: start.toISOString(),
    },
    post_trigger: postTrigger,
    statistical_significance: {
      chi_squared:
        chiSquaredResult?.chiSquared !== undefined
          ? Math.round(chiSquaredResult.chiSquared * 100) / 100
          : null,
      p_value:
        chiSquaredResult?.pValue !== undefined ? Math.round(chiSquaredResult.pValue * 1000) / 1000 : null,
    },
    triggers,
    windows_matched: matchedWindowEnds.length,
  }
}
