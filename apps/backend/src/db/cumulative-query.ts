/**
 * Helper for splitting metric queries by cumulative/non-cumulative type.
 *
 * Cumulative metrics (steps, distance, etc.) use only the aggregate source
 * to avoid mixing raw readings with deduplicated daily totals.
 */
import { cumulativeMetrics, type MetricType } from '@aurboda/api-spec'
import type { QueryResultRow } from 'pg'

/**
 * Split a list of metric names into cumulative and non-cumulative groups.
 */
export const splitMetricsByCumulative = (
  metrics: string[],
): { cumulative: string[]; nonCumulative: string[] } => ({
  cumulative: metrics.filter((m) => cumulativeMetrics.includes(m as MetricType)),
  nonCumulative: metrics.filter((m) => !cumulativeMetrics.includes(m as MetricType)),
})

interface SplitQueryOptions<T> {
  /** The metric names to query */
  metrics: string[]
  /** Shared query parameters after the metrics array (e.g. start, end dates) */
  params: unknown[]
  /** Extra parameters appended only to the cumulative query (e.g. source filter values) */
  cumulativeExtraParams?: unknown[]
  /** SQL for cumulative metrics (with source filter). $1 = metrics array, remaining = params + cumulativeExtraParams */
  sqlCumulative: string
  /** SQL for non-cumulative metrics (all sources). $1 = metrics array, remaining = params */
  sqlNonCumulative: string
  /** Map a database row to the result type */
  mapRow: (row: QueryResultRow) => T
  /** Execute a query and return rows */
  queryFn: (sql: string, params: unknown[]) => Promise<{ rows: QueryResultRow[] }>
}

/**
 * Run split queries for cumulative and non-cumulative metrics, combining results.
 *
 * The SQL templates should use $1 for the metrics array, with remaining placeholders
 * for the additional params (e.g. $2 for start, $3 for end). The cumulative SQL can
 * reference additional placeholders for cumulativeExtraParams.
 */
export const querySplitByCumulative = async <T>(options: SplitQueryOptions<T>): Promise<T[]> => {
  const { cumulative, nonCumulative } = splitMetricsByCumulative(options.metrics)
  const results: T[] = []

  if (cumulative.length > 0) {
    const extraParams = options.cumulativeExtraParams ?? []
    const result = await options.queryFn(options.sqlCumulative, [
      cumulative,
      ...options.params,
      ...extraParams,
    ])
    results.push(...result.rows.map(options.mapRow))
  }

  if (nonCumulative.length > 0) {
    const result = await options.queryFn(options.sqlNonCumulative, [nonCumulative, ...options.params])
    results.push(...result.rows.map(options.mapRow))
  }

  return results
}
