/**
 * Shared trend arrow used by metric and sparkline cards.
 */
interface TrendIndicatorProps {
  value: number | null
  inverse?: boolean
}

export function TrendIndicator({ value, inverse = false }: TrendIndicatorProps) {
  if (value === null) return null

  const isPositive = inverse ? value < 0 : value > 0
  const arrow = value > 0 ? '↑' : value < 0 ? '↓' : '→'
  const className = isPositive ? 'trend-positive' : value === 0 ? 'trend-neutral' : 'trend-negative'

  return (
    <span class={`trend-indicator ${className}`}>
      {arrow} {Math.abs(value).toFixed(1)}%
    </span>
  )
}
