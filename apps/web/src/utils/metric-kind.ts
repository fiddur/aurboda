import type { MetricAggregation, MetricBetter } from '@aurboda/api-spec'

export const METRIC_KIND_OPTIONS: { label: string; value: MetricAggregation }[] = [
  { label: 'Level — average (weight, waist, HR)', value: 'avg' },
  { label: 'Amount — sum (a dose, steps)', value: 'sum' },
]

export const metricKindLabel = (aggregation: MetricAggregation | undefined): string =>
  aggregation === 'sum' ? 'Amount (sum)' : 'Level (average)'

export const METRIC_BETTER_OPTIONS: { label: string; value: MetricBetter }[] = [
  { label: 'Trend — neither better nor worse', value: 'neutral' },
  { label: 'Trend — higher is better', value: 'higher' },
  { label: 'Trend — lower is better', value: 'lower' },
]

export const metricBetterLabel = (better: MetricBetter | undefined): string =>
  better === 'higher' ? 'Higher is better' : better === 'lower' ? 'Lower is better' : 'Neutral'

export const metricBetterOf = (metric: { better?: MetricBetter }): MetricBetter => metric.better ?? 'neutral'
