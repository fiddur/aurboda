/**
 * Shared colour palette and legend for breakdown (multi-series) charts, used by
 * both the Chart Explorer page and the dashboard chart widgets so the series
 * colours stay consistent between them.
 */
import type { BarSeriesData } from './BarChart'

import './breakdown.css'

export const SERIES_COLORS = [
  '#8b5cf6',
  '#f97316',
  '#22c55e',
  '#3b82f6',
  '#ef4444',
  '#f59e0b',
  '#ec4899',
  '#14b8a6',
]

/** One coloured bar series per breakdown series, a bucket without the series at 0; null without a breakdown. */
export const breakdownBarSeries = (
  series: string[] | undefined,
  buckets: { bucket_start: string; series: Record<string, number> }[] | undefined,
): BarSeriesData[] | null =>
  series && series.length > 0 && buckets
    ? series.map((name, i) => ({
        color: SERIES_COLORS[i % SERIES_COLORS.length],
        data: buckets.map((b) => ({ bucket_start: b.bucket_start, value: b.series[name] ?? 0 })),
        name,
      }))
    : null

export function BreakdownLegend({ series }: { series: string[] }) {
  return (
    <div class="breakdown-legend">
      {series.map((name, i) => (
        <span key={name} class="breakdown-legend-item">
          <span
            class="breakdown-legend-dot"
            style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }}
          />
          {name}
        </span>
      ))}
    </div>
  )
}
