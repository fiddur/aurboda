export type ImpactMetric = 'hrv' | 'hr' | 'stress'

export const IMPACT_METRICS: readonly ImpactMetric[] = ['hrv', 'hr', 'stress']

/** An extra metric drawn beside the three, labelled for the legend and summary. */
export interface ImpactExtra {
  metric: string
  label: string
}

/** Line colours for the extras in the order they are ticked; distinct from HRV green, HR red and stress orange. */
export const EXTRA_METRIC_COLORS = ['#8b5cf6', '#0ea5e9', '#ec4899', '#64748b'] as const

export const extraMetricColor = (index: number): string =>
  EXTRA_METRIC_COLORS[index % EXTRA_METRIC_COLORS.length]
