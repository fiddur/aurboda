import {
  type CustomMetricDefinition,
  cumulativeMetrics,
  getMetricUnit,
  type ImpactMetricOption,
  isValidMetricOrCustom,
  metricLabels,
} from '@aurboda/api-spec'

import { getDailySampleCounts } from '../../db/index.ts'
import { getCustomMetrics } from '../custom-metrics.ts'

export const MIN_IMPACT_METRIC_DAYS = 3
/**
 * Coverage, not sample count: a metric recorded only during workouts or sleep can have thousands
 * of samples a day yet leave every before/after window empty. 48 quarter hours is half the day.
 */
export const MIN_IMPACT_QUARTER_HOURS_PER_DAY = 48
export const FIXED_IMPACT_METRICS = ['hrv_rmssd', 'heart_rate', 'stress_level']

export interface DailySampleCount {
  metric: string
  day: string
  count: number
  quarter_hours: number
}

const median = (values: number[]): number => {
  const sorted = values.toSorted((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const words = (name: string): string =>
  name
    .split('_')
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

export const impactMetricLabel = (metric: string): string => metricLabels[metric] ?? words(metric)

export const selectImpactMetrics = (
  counts: DailySampleCount[],
  customMetrics: CustomMetricDefinition[],
): ImpactMetricOption[] => {
  const excluded = new Set<string>([...cumulativeMetrics, ...FIXED_IMPACT_METRICS])
  const perDay = new Map<string, { counts: number[]; quarterHours: number[] }>()
  for (const { count, metric, quarter_hours } of counts) {
    if (count <= 0 || excluded.has(metric) || !isValidMetricOrCustom(metric, customMetrics)) continue
    const days = perDay.getOrInsertComputed(metric, () => ({ counts: [], quarterHours: [] }))
    days.counts.push(count)
    days.quarterHours.push(quarter_hours)
  }
  return [...perDay]
    .filter(([, days]) => days.counts.length >= MIN_IMPACT_METRIC_DAYS)
    .filter(([, days]) => median(days.quarterHours) >= MIN_IMPACT_QUARTER_HOURS_PER_DAY)
    .map(([metric, days]) => ({
      coverage_hours_per_day: Math.round((median(days.quarterHours) / 4) * 10) / 10,
      label: impactMetricLabel(metric),
      metric,
      samples_per_day: Math.round(median(days.counts)),
      unit: getMetricUnit(metric, customMetrics) ?? null,
    }))
    .toSorted(
      (a, b) =>
        b.coverage_hours_per_day - a.coverage_hours_per_day ||
        b.samples_per_day - a.samples_per_day ||
        a.metric.localeCompare(b.metric),
    )
}

export const getImpactMetrics = async (
  user: string,
  periodDays: number = 30,
): Promise<ImpactMetricOption[]> => {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date()
  start.setDate(start.getDate() - periodDays)
  start.setHours(0, 0, 0, 0)
  const [counts, customMetrics] = await Promise.all([
    getDailySampleCounts(user, start, end),
    getCustomMetrics(user),
  ])
  return selectImpactMetrics(counts, customMetrics)
}
