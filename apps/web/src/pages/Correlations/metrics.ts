import type { ProductivityCorrelationCoefficients } from '@aurboda/api-spec'

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

/** The shown metrics as prose, in canonical order: "HRV, heart rate and stress", "HRV and stress", "stress". */
export const describeMetrics = (
  metrics: readonly ImpactMetric[],
  style: 'short' | 'long' = 'short',
): string => {
  const phrases = style === 'long' ? LONG_PHRASES : SHORT_PHRASES
  return joinWithAnd(IMPACT_METRICS.filter((m) => metrics.includes(m)).map((m) => phrases[m]))
}

/** Toggles a metric, keeping canonical order; the last shown metric stays on. */
export const toggleMetric = (metrics: readonly ImpactMetric[], metric: ImpactMetric): ImpactMetric[] => {
  const next = metrics.includes(metric) ? metrics.filter((m) => m !== metric) : [...metrics, metric]
  return next.length === 0 ? [...metrics] : IMPACT_METRICS.filter((m) => next.includes(m))
}

const R_LABELS: Record<ImpactMetric, string> = { hr: 'HR', hrv: 'HRV', stress: 'Stress' }

const COEFFICIENT_KEYS: Record<ImpactMetric, keyof ProductivityCorrelationCoefficients> = {
  hr: 'heart_rate',
  hrv: 'hrv_rmssd',
  stress: 'stress_level',
}

const formatR = (r: number): string => (r < 0 ? `−${Math.abs(r).toFixed(2)}` : r.toFixed(2))

/** "r HRV 0.12 · HR −0.05 · Stress 0.20" for the shown metrics that have an r; undefined when none has. */
export const describeProductivityR = (
  coefficients: ProductivityCorrelationCoefficients,
  metrics: readonly ImpactMetric[],
): string | undefined => {
  const parts = IMPACT_METRICS.filter((m) => metrics.includes(m)).flatMap((m) => {
    const r = coefficients[COEFFICIENT_KEYS[m]]
    return r === null ? [] : [`${R_LABELS[m]} ${formatR(r)}`]
  })
  return parts.length > 0 ? `r ${parts.join(' · ')}` : undefined
}
