import type { ImpactBucket, ImpactFilter, ImpactGroup, WindowEffect } from '@aurboda/api-spec'

import {
  impactDurationBucketsError,
  impactTimeBucketsError,
  parseImpactBucketLimits,
} from '@aurboda/api-spec'

import type { MetricDirection } from './effects'

import { IMPACT_METRICS, type ImpactExtra, type ImpactMetric } from '../../components/charts/impactMetrics'
import { METRIC_LABELS, metricDirection, NO_EFFECT } from './metrics'

export const MIN_CHART_OCCURRENCES = 3
export const MAX_CHART_GROUPS = 8

export const isFilterKeyOn = (filters: readonly ImpactFilter[], dimension: string, key: string): boolean =>
  filters.some((f) => f.dimension === dimension && f.keys.includes(key))

export const withoutDimension = (filters: readonly ImpactFilter[], dimension: string): ImpactFilter[] =>
  filters.filter((f) => f.dimension !== dimension)

/** Adds or removes a key, dropping a filter left without keys; the filters keep their order. */
export const toggleFilterKey = (
  filters: readonly ImpactFilter[],
  dimension: string,
  key: string,
): ImpactFilter[] => {
  if (!filters.some((f) => f.dimension === dimension)) return [...filters, { dimension, keys: [key] }]
  return filters.flatMap((f) => {
    if (f.dimension !== dimension) return [f]
    const keys = f.keys.includes(key) ? f.keys.filter((k) => k !== key) : [...f.keys, key]
    return keys.length > 0 ? [{ dimension, keys }] : []
  })
}

export const parseLimitsInput = (
  text: string,
  kind: 'duration' | 'time_of_day',
): { limits: number[] } | { error: string } => {
  const limits = parseImpactBucketLimits(text)
  if (limits === null) return { error: 'Give at least one limit' }
  const error = kind === 'duration' ? impactDurationBucketsError(limits) : impactTimeBucketsError(limits)
  return error === null ? { limits } : { error }
}

export const formatLimits = (limits: readonly number[]): string => limits.join(', ')

export const chartableGroups = (groups: readonly ImpactGroup[]): ImpactGroup[] =>
  groups.filter((g) => g.occurrences >= MIN_CHART_OCCURRENCES).slice(0, MAX_CHART_GROUPS)

export interface BreakdownMetricOption {
  key: string
  label: string
}

/** The shown metrics, the three in canonical order then the extras, as the chart's metric choices. */
export const breakdownMetricOptions = (
  metrics: readonly ImpactMetric[],
  extras: readonly ImpactExtra[],
): BreakdownMetricOption[] => [
  ...IMPACT_METRICS.filter((m) => metrics.includes(m)).map((m) => ({ key: m, label: METRIC_LABELS[m] })),
  ...extras.map(({ label, metric }) => ({ key: metric, label })),
]

export const resolveBreakdownMetric = (
  requested: string,
  options: readonly BreakdownMetricOption[],
): string => {
  if (options.some((o) => o.key === requested)) return requested
  if (options.some((o) => o.key === 'stress')) return 'stress'
  return options[0]?.key ?? ''
}

/** What `ImpactGroup` and `ActivityImpactData` share: a timeline and the paired effects. */
export interface ImpactSlice {
  timeline: ImpactBucket[]
  hr_effect: WindowEffect
  hrv_effect: WindowEffect
  stress_effect: WindowEffect
  metric_effects?: Record<string, WindowEffect>
}

export interface MetricAccessors {
  during: (slice: ImpactSlice) => number | null
  effect: (slice: ImpactSlice) => WindowEffect
  series: (slice: ImpactSlice) => (number | null)[]
  decimals: number
  direction: MetricDirection
}

const FIXED: Record<ImpactMetric, { decimals: number; direction: MetricDirection }> = {
  hr: { decimals: 0, direction: 'down' },
  hrv: { decimals: 1, direction: 'up' },
  stress: { decimals: 0, direction: 'down' },
}

const isImpactMetric = (key: string): key is ImpactMetric =>
  (IMPACT_METRICS as readonly string[]).includes(key)

const bucketMean = (bucket: ImpactBucket, key: string): number | null =>
  isImpactMetric(key) ? bucket[key].mean : (bucket.metrics?.[key]?.mean ?? null)

export const metricAccessors = (key: string): MetricAccessors => {
  const series = (slice: ImpactSlice) => slice.timeline.map((b) => bucketMean(b, key))
  const during = (slice: ImpactSlice) => {
    const bucket = slice.timeline.find((b) => b.phase === 'during')
    return bucket ? bucketMean(bucket, key) : null
  }
  if (isImpactMetric(key)) {
    const effectKey = `${key}_effect` as const
    return { ...FIXED[key], during, effect: (slice) => slice[effectKey], series }
  }
  return {
    decimals: 1,
    direction: metricDirection(key),
    during,
    effect: (slice) => slice.metric_effects?.[key] ?? NO_EFFECT,
    series,
  }
}

export const describeFilterCount = (kept: number, total: number): string => {
  const noun = total === 1 ? 'session' : 'sessions'
  return kept === total ? `${total} ${noun}` : `${kept} of ${total} ${noun}`
}
