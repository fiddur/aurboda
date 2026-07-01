/**
 * Shared colour palette and legend for breakdown (multi-series) charts, used by
 * both the Chart Explorer page and the dashboard chart widgets so the series
 * colours stay consistent between them.
 */
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
