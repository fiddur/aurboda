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

export type ImpactAxisSide = 'left' | 'right' | 'outer-right'

/** HRV keeps the left axis and heart rate the right; stress takes whichever is free, else a second right axis. */
export const impactAxisSides = (
  drawn: readonly ImpactMetric[],
): Partial<Record<ImpactMetric, ImpactAxisSide>> => {
  const hrv = drawn.includes('hrv')
  const hr = drawn.includes('hr')
  return {
    ...(hrv ? { hrv: 'left' } : {}),
    ...(hr ? { hr: 'right' } : {}),
    ...(drawn.includes('stress') ? { stress: !hrv ? 'left' : !hr ? 'right' : 'outer-right' } : {}),
  }
}
