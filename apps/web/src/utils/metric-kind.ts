import type { MetricAggregation } from '@aurboda/api-spec'

export const METRIC_KIND_OPTIONS: { label: string; value: MetricAggregation }[] = [
  { label: 'Level — average (weight, waist, HR)', value: 'avg' },
  { label: 'Amount — sum (a dose, steps)', value: 'sum' },
]

export const metricKindLabel = (aggregation: MetricAggregation | undefined): string =>
  aggregation === 'sum' ? 'Amount (sum)' : 'Level (average)'
