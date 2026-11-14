import { getMetricBetter, type CustomMetricDefinition, type MetricBetter } from '@aurboda/api-spec'

export type TrendTone = 'better' | 'worse' | 'neutral'

export const trendTone = (value: number, better: MetricBetter): TrendTone => {
  if (value === 0 || better === 'neutral') return 'neutral'
  return value > 0 === (better === 'higher') ? 'better' : 'worse'
}

export const trendToneClass: Record<TrendTone, string> = {
  better: 'trend-positive',
  neutral: 'trend-neutral',
  worse: 'trend-negative',
}

export const trendArrow = (value: number): string => (value > 0 ? '↑' : value < 0 ? '↓' : '→')

/** What the colour says, in words: "12.0% lower, better". */
export const trendLabel = (
  value: number,
  tone: TrendTone,
  amount = `${Math.abs(value).toFixed(1)}%`,
): string => {
  const direction = value > 0 ? `${amount} higher` : value < 0 ? `${amount} lower` : 'unchanged'
  return tone === 'neutral' ? direction : `${direction}, ${tone}`
}

/** Dashboard pseudo-metrics answered from a stored metric. */
const pseudoMetrics: Record<string, string> = {
  hrv_7day: 'hrv_rmssd',
  hrv_30day: 'hrv_rmssd',
  rhr_7day: 'resting_heart_rate',
  rhr_30day: 'resting_heart_rate',
  zone2_weekly: 'hr_zone_2_sec',
}

export const isPseudoMetric = (metric: string): boolean => metric in pseudoMetrics

/** A widget's `trend_inverse: true` overrides the metric's own direction with "lower is better". */
export const widgetMetricBetter = (
  metric: string,
  customMetrics: CustomMetricDefinition[] = [],
  trendInverse?: boolean,
): MetricBetter => (trendInverse ? 'lower' : getMetricBetter(pseudoMetrics[metric] ?? metric, customMetrics))
