/**
 * Period summary query function.
 */

import type { PeriodMetricStats, PeriodSummaryResult } from './types.ts'

import { getDailyAggregates, getTimeSeries, getTimeSeriesStats } from '../../db/index.ts'
import { isContextualHrvMetric, isHrZoneMetric, type MetricType, metricUnits } from '../../schema.ts'
import { classifyHrvByContext, getHrvContextWindows, type HrvContext } from '../hrv-context.ts'
import { computeHrZoneSecs, getEffectiveHrZones } from '../settings.ts'
import { contextualHrvMetricToContext } from './metrics.ts'

export const emptyPeriodMetricStats = (metric: string): PeriodMetricStats => ({
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
