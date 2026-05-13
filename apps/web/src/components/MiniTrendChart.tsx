/**
 * Compact trend chart for meta pages — thin wrapper around TrendLineChart.
 */
import { TrendLineChart } from './charts/TrendLineChart'

export function MiniTrendChart({ data, color }: { data: { date: string; value: number }[]; color: string }) {
  return <TrendLineChart data={data} color={color} height={180} />
}
