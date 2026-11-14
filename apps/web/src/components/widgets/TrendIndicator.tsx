import type { MetricBetter } from '@aurboda/api-spec'

import { trendArrow, trendLabel, trendTone, trendToneClass } from './trend'

interface TrendIndicatorProps {
  value: number | null
  better?: MetricBetter
}

export function TrendIndicator({ value, better = 'neutral' }: TrendIndicatorProps) {
  if (value === null) return null

  const tone = trendTone(value, better)
  const label = trendLabel(value, tone)

  return (
    <span class={`trend-indicator ${trendToneClass[tone]}`} role="img" aria-label={label} title={label}>
      {trendArrow(value)} {Math.abs(value).toFixed(1)}%
    </span>
  )
}
