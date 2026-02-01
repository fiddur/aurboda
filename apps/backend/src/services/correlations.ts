/**
 * Correlation analysis services for health data.
 *
 * Provides statistical analysis of correlations between HRV/HR and various
 * activity sources (RescueTime, locations, tags, activities).
 */

import { getActivities, getProductivity, getTags, getTimeSeries, getTimeSeriesStats } from '../db'
import { getPlaceVisits } from './locations'
import { SyncProvider } from './queries'

// ============================================================================
// Types
// ============================================================================

/** HRV statistics for a context/activity */
export interface HrvStats {
  meanHrv: number | null
  stddevHrv: number | null
  meanHr: number | null
  stddevHr: number | null
  sampleMinutes: number
  sampleCount: number
}

/** HRV stats with baseline comparison */
export interface HrvStatsWithDelta extends HrvStats {
  hrvDeltaFromBaseline: number | null
  hrDeltaFromBaseline: number | null
}

/** Baseline statistics result */
export interface BaselineResult {
  hrv: {
    avg7day: number | null
    avg30day: number | null
    trendPercent: number | null
  }
  restingHr: {
    avg7day: number | null
    avg30day: number | null
    trendPercent: number | null
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
  correlationCoefficient: number | null
}

/** Correlation by location */
export interface LocationCorrelation extends HrvStatsWithDelta {
  locationName: string
  visitCount: number
}

/** Correlation by activity type */
export interface ActivityCorrelation extends HrvStatsWithDelta {
  activityType: string
  occurrences: number
  avgDurationMin: number
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
  sampleCount: number
}

/** Activity impact timeline result */
export interface ActivityImpactResult {
  activity: string
  activityType: 'productivity_category' | 'productivity_app' | 'location' | 'tag' | 'activity_type'
  occurrences: number
  avgDurationMin: number
  hrvTimeline: {
    before30min: TimeWindowStats
    before15min: TimeWindowStats
    during: TimeWindowStats
    after15min: TimeWindowStats
    after30min: TimeWindowStats
  }
  hrTimeline: {
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
  relativeRisk: number
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
  postTrigger: Record<string, LagWindowResult>
  sampleSize: {
    triggerEvents: number
    outcomeEvents: number
    daysAnalyzed: number
  }
  statisticalSignificance: {
    chiSquared: number | null
    pValue: number | null
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
  meanHr: mean(hrValues),
  meanHrv: mean(hrvValues),
  sampleCount: hrvValues.length,
  sampleMinutes: Math.round(durationMinutes),
  stddevHr: stddev(hrValues),
  stddevHrv: stddev(hrvValues),
})

/**
 * Add baseline delta to HRV stats.
 */
const addBaselineDelta = (stats: HrvStats, baseline: HrvStats): HrvStatsWithDelta => ({
  ...stats,
  hrDeltaFromBaseline:
    stats.meanHr !== null && baseline.meanHr !== null ?
      Math.round((stats.meanHr - baseline.meanHr) * 10) / 10
    : null,
  hrvDeltaFromBaseline:
    stats.meanHrv !== null && baseline.meanHrv !== null ?
      Math.round((stats.meanHrv - baseline.meanHrv) * 10) / 10
    : null,
})

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Get personal rolling baseline for HRV and resting HR.
 */
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

  // Fetch all stats in parallel
  const [hrvStats7day, hrvStats30day, hrvStatsPrev30day, hrStats7day, hrStats30day, hrStatsPrev30day] =
    await Promise.all([
      getTimeSeriesStats(user, ['hrv_rmssd'], start7day, end7day),
      getTimeSeriesStats(user, ['hrv_rmssd'], start30day, end30day),
      getTimeSeriesStats(user, ['hrv_rmssd'], prevStart30day, prevEnd30day),
      getTimeSeriesStats(user, ['resting_heart_rate'], start7day, end7day),
      getTimeSeriesStats(user, ['resting_heart_rate'], start30day, end30day),
      getTimeSeriesStats(user, ['resting_heart_rate'], prevStart30day, prevEnd30day),
    ])

  // Calculate trends
  const hrvTrend =
    hrvStats30day[0]?.avg && hrvStatsPrev30day[0]?.avg ?
      ((hrvStats30day[0].avg - hrvStatsPrev30day[0].avg) / hrvStatsPrev30day[0].avg) * 100
    : null

  const hrTrend =
    hrStats30day[0]?.avg && hrStatsPrev30day[0]?.avg ?
      ((hrStats30day[0].avg - hrStatsPrev30day[0].avg) / hrStatsPrev30day[0].avg) * 100
    : null

  return {
    hrv: {
      avg7day: hrvStats7day[0]?.avg ? Math.round(hrvStats7day[0].avg * 10) / 10 : null,
      avg30day: hrvStats30day[0]?.avg ? Math.round(hrvStats30day[0].avg * 10) / 10 : null,
      trendPercent: hrvTrend !== null ? Math.round(hrvTrend * 10) / 10 : null,
    },
    period: {
      end: end30day.toISOString(),
      start: start30day.toISOString(),
    },
    restingHr: {
      avg7day: hrStats7day[0]?.avg ? Math.round(hrStats7day[0].avg * 10) / 10 : null,
      avg30day: hrStats30day[0]?.avg ? Math.round(hrStats30day[0].avg * 10) / 10 : null,
      trendPercent: hrTrend !== null ? Math.round(hrTrend * 10) / 10 : null,
    },
  }
}

/**
 * Get HRV/HR correlations with different activity types.
 */
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
    const category = record.category || 'Uncategorized'
    if (!productivityByCategory.has(category)) {
      productivityByCategory.set(category, { hrValues: [], hrvValues: [], minutes: 0, scores: [] })
    }
    const cat = productivityByCategory.get(category)!
    cat.minutes += record.durationSec / 60

    // Get HRV/HR during this productivity window
    const hrvInWindow = getDataInRange(hrvData, record.startTime, record.endTime)
    const hrInWindow = getDataInRange(hrData, record.startTime, record.endTime)
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
      data.scores.length >= 3 && data.hrvValues.length === data.scores.length ?
        pearsonCorrelation(data.scores, data.hrvValues)
      : null

    productivityCorrelations.push({
      ...statsWithDelta,
      category,
      correlationCoefficient: correlation !== null ? Math.round(correlation * 100) / 100 : null,
    })
  }

  // Sort by sample minutes descending
  productivityCorrelations.sort((a, b) => b.sampleMinutes - a.sampleMinutes)

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
    loc.minutes += visit.durationMinutes
    loc.visits++

    const hrvInWindow = getDataInRange(hrvData, visit.startTime, visit.endTime)
    const hrInWindow = getDataInRange(hrData, visit.startTime, visit.endTime)
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
      locationName: name,
      visitCount: data.visits,
    })
  }

  locationCorrelations.sort((a, b) => b.sampleMinutes - a.sampleMinutes)

  // === Activity correlations ===
  const activityByType = new Map<
    string,
    { hrvValues: number[]; hrValues: number[]; minutes: number; count: number }
  >()

  for (const activity of activities) {
    const type = activity.activityType
    if (!activityByType.has(type)) {
      activityByType.set(type, { count: 0, hrValues: [], hrvValues: [], minutes: 0 })
    }
    const act = activityByType.get(type)!
    act.count++

    if (activity.endTime) {
      const durationMin = (activity.endTime.getTime() - activity.startTime.getTime()) / 1000 / 60
      act.minutes += durationMin

      const hrvInWindow = getDataInRange(hrvData, activity.startTime, activity.endTime)
      const hrInWindow = getDataInRange(hrData, activity.startTime, activity.endTime)
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
      activityType: type,
      avgDurationMin: data.count > 0 ? Math.round(data.minutes / data.count) : 0,
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
    const windowStart = new Date(tag.startTime.getTime() - 30 * 60 * 1000)
    const windowEnd = tag.endTime ?? new Date(tag.startTime.getTime() + 30 * 60 * 1000)
    const durationMin = (windowEnd.getTime() - tag.startTime.getTime()) / 1000 / 60
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
      const matches =
        activityType === 'productivity_category' ?
          record.category?.toLowerCase() === activity.toLowerCase()
        : record.activity.toLowerCase().includes(activity.toLowerCase())

      if (matches) {
        occurrences.push({
          durationMin: record.durationSec / 60,
          endTime: record.endTime,
          startTime: record.startTime,
        })
      }
    }
  } else if (activityType === 'location') {
    const locations = await getPlaceVisits(user, start, end)
    for (const visit of locations) {
      if (visit.name.toLowerCase().includes(activity.toLowerCase())) {
        occurrences.push({
          durationMin: visit.durationMinutes,
          endTime: visit.endTime,
          startTime: visit.startTime,
        })
      }
    }
  } else if (activityType === 'tag') {
    const tags = await getTags(user, start, end)
    for (const tag of tags) {
      if (tag.tag.toLowerCase().includes(activity.toLowerCase())) {
        const endTime = tag.endTime ?? new Date(tag.startTime.getTime() + 5 * 60 * 1000) // Default 5 min for point tags
        occurrences.push({
          durationMin: (endTime.getTime() - tag.startTime.getTime()) / 1000 / 60,
          endTime,
          startTime: tag.startTime,
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
      if (act.endTime) {
        occurrences.push({
          durationMin: (act.endTime.getTime() - act.startTime.getTime()) / 1000 / 60,
          endTime: act.endTime,
          startTime: act.startTime,
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
    sampleCount: values.length,
    stddev: stddev(values) !== null ? Math.round(stddev(values)! * 10) / 10 : null,
  })

  return {
    activity,
    activityType,
    avgDurationMin: occurrences.length > 0 ? Math.round(totalDurationMin / occurrences.length) : 0,
    hrTimeline: {
      after15min: calculateWindowStats(windows.after15min.hr),
      after30min: calculateWindowStats(windows.after30min.hr),
      before15min: calculateWindowStats(windows.before15min.hr),
      before30min: calculateWindowStats(windows.before30min.hr),
      during: calculateWindowStats(windows.during.hr),
    },
    hrvTimeline: {
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
    await Promise.all([sync.syncOuraIfNeeded(user, 'tags'), sync.syncOuraIfNeeded(user, 'sessions')])
  }

  // Parse outcome pattern as regex
  const outcomeRegex = new RegExp(outcome.pattern, 'i')

  // Get trigger events
  let triggerEvents: Date[] = []

  if (trigger.type === 'tag') {
    const tags = await getTags(user, start, end)
    triggerEvents = tags
      .filter((t) => t.tag.toLowerCase().includes(trigger.value.toLowerCase()))
      .map((t) => t.startTime)
  } else if (trigger.type === 'activity') {
    const activities = await getActivities(
      user,
      [trigger.value as 'exercise' | 'meditation' | 'nap' | 'sleep'],
      start,
      end,
    )
    triggerEvents = activities.map((a) => a.startTime)
  }

  // Get all outcome events (tags matching pattern)
  const allTags = await getTags(user, start, end)
  const outcomeEvents = allTags.filter((t) => outcomeRegex.test(t.tag)).map((t) => t.startTime)

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
      relativeRisk: Math.round(relativeRisk * 100) / 100,
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
    postTrigger,
    sampleSize: {
      daysAnalyzed: periodDays,
      outcomeEvents: outcomeEvents.length,
      triggerEvents: triggerEvents.length,
    },
    statisticalSignificance: {
      chiSquared:
        chiSquaredResult?.chiSquared !== undefined ?
          Math.round(chiSquaredResult.chiSquared * 100) / 100
        : null,
      pValue:
        chiSquaredResult?.pValue !== undefined ? Math.round(chiSquaredResult.pValue * 1000) / 1000 : null,
    },
    trigger: {
      type: trigger.type,
      value: trigger.value,
    },
  }
}
