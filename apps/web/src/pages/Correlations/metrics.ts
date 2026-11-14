import type { ProductivityCorrelationCoefficients, WindowEffect } from '@aurboda/api-spec'

import type { MetricColumns } from './ContextTable'
import type { MetricDirection } from './effects'

import { IMPACT_METRICS, type ImpactMetric } from '../../components/charts/impactMetrics'

export const METRIC_LABELS: Record<ImpactMetric, string> = {
  hr: 'Heart rate',
  hrv: 'HRV',
  stress: 'Stress',
}

const SHORT_PHRASES: Record<ImpactMetric, string> = {
  hr: 'heart rate',
  hrv: 'HRV',
  stress: 'stress',
}

const LONG_PHRASES: Record<ImpactMetric, string> = {
  ...SHORT_PHRASES,
  hrv: 'heart rate variability (HRV)',
}

const joinWithAnd = (parts: string[]): string =>
  parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`

/** A metric label for running text: "Body Battery" reads "body battery", while "SpO2" and "VO2" keep their case. */
export const proseLabel = (label: string): string =>
  label
    .split(' ')
    .map((word) => (/^[A-Z][a-z]+$/.test(word) ? word.toLowerCase() : word))
    .join(' ')

/** The shown metrics as prose, the three in canonical order then the extras: "HRV, heart rate and body battery". */
export const describeMetrics = (
  metrics: readonly ImpactMetric[],
  style: 'short' | 'long' = 'short',
  extraLabels: readonly string[] = [],
): string => {
  const phrases = style === 'long' ? LONG_PHRASES : SHORT_PHRASES
  return joinWithAnd([
    ...IMPACT_METRICS.filter((m) => metrics.includes(m)).map((m) => phrases[m]),
    ...extraLabels.map(proseLabel),
  ])
}

/** Toggles a metric, keeping canonical order; the last shown metric, counting `othersShown` extras, stays on. */
export const toggleMetric = (
  metrics: readonly ImpactMetric[],
  metric: ImpactMetric,
  othersShown: number = 0,
): ImpactMetric[] => {
  const next = metrics.includes(metric) ? metrics.filter((m) => m !== metric) : [...metrics, metric]
  return next.length === 0 && othersShown === 0
    ? [...metrics]
    : IMPACT_METRICS.filter((m) => next.includes(m))
}

/** Orders extras as `available` lists them, then the rest alphabetically. */
export const orderExtras = (extras: readonly string[], available: readonly string[]): string[] =>
  extras.toSorted((a, b) => {
    const ia = available.indexOf(a)
    const ib = available.indexOf(b)
    if (ia >= 0 && ib >= 0) return ia - ib
    if (ia >= 0 || ib >= 0) return ia >= 0 ? -1 : 1
    return a.localeCompare(b)
  })

/** Toggles an extra metric; the last shown metric, counting `othersShown` of the three, stays on. */
export const toggleExtra = (
  extras: readonly string[],
  metric: string,
  othersShown: number,
  available: readonly string[],
): string[] => {
  const next = extras.includes(metric) ? extras.filter((m) => m !== metric) : [...extras, metric]
  return next.length === 0 && othersShown === 0 ? [...extras] : orderExtras(next, available)
}

const METRIC_DIRECTION: Record<string, MetricDirection> = {
  body_battery: 'up',
  heart_rate: 'down',
  resting_heart_rate: 'down',
  spo2: 'up',
  stress_level: 'down',
}

/** Which way is good for a metric; neutral where it is not known, so its changes are not coloured. */
export const metricDirection = (metric: string): MetricDirection =>
  METRIC_DIRECTION[metric] ?? (metric.startsWith('hrv_') ? 'up' : 'neutral')

export const NO_EFFECT: WindowEffect = {
  after_mean: null,
  before_mean: null,
  change: null,
  change_stddev: null,
  p_value: null,
  paired_occurrences: 0,
}

/** The context table columns of an extra metric, read from the row's `metrics`. */
export const extraMetricColumn = (metric: string, label: string): MetricColumns => ({
  decimals: 1,
  delta: (s) => s.metrics?.[metric]?.delta_from_baseline ?? null,
  direction: metricDirection(metric),
  effect: (s) => s.metrics?.[metric]?.effect ?? NO_EFFECT,
  key: metric,
  label,
  mean: (s) => s.metrics?.[metric]?.mean ?? null,
})

const R_LABELS: Record<ImpactMetric, string> = { hr: 'HR', hrv: 'HRV', stress: 'Stress' }

const COEFFICIENT_KEYS: Record<ImpactMetric, keyof ProductivityCorrelationCoefficients> = {
  hr: 'heart_rate',
  hrv: 'hrv_rmssd',
  stress: 'stress_level',
}

const formatR = (r: number): string => (r < 0 ? `−${Math.abs(r).toFixed(2)}` : r.toFixed(2))

/** "r HRV 0.12 · HR −0.05 · Body Battery 0.20" for the shown metrics that have an r; undefined when none has. */
export const describeProductivityR = (
  coefficients: ProductivityCorrelationCoefficients,
  metrics: readonly ImpactMetric[],
  extras: readonly { label: string; r: number | null | undefined }[] = [],
): string | undefined => {
  const parts = [
    ...IMPACT_METRICS.filter((m) => metrics.includes(m)).map((m) => ({
      label: R_LABELS[m],
      r: coefficients[COEFFICIENT_KEYS[m]],
    })),
    ...extras,
  ].flatMap(({ label, r }) => (r === null || r === undefined ? [] : [`${label} ${formatR(r)}`]))
  return parts.length > 0 ? `r ${parts.join(' · ')}` : undefined
}
