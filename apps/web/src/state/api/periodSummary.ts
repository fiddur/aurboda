import type { PeriodMetricStats } from '@aurboda/api-spec'

/**
 * Read a numeric field from PeriodMetricStats, returning null when there is no
 * underlying data (count is 0). The backend emits zero-filled stats for
 * metrics that had no samples in the period, so a naive `stats.avg ?? null`
 * leaks `0` to the UI and renders "0.0" instead of "No data" (see #746).
 */
export const periodStatsValue = (
  stats: PeriodMetricStats | undefined,
  field: 'avg' | 'min' | 'max',
): number | null => {
  if (!stats || stats.count === 0) return null
  return stats[field]
}
