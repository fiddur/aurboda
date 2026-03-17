import type { QueryResultRow } from 'pg'

/**
 * Helper for splitting metric queries by cumulative/non-cumulative type.
 *
 * Cumulative metrics (steps, distance, etc.) use only trusted sources
 * to avoid mixing raw readings with deduplicated daily totals.
 *
 * Some cumulative metrics (like calories_active) are "aurboda-only":
 * when aurboda computes per-minute values, the health_connect_aggregate
 * daily totals must be excluded to avoid nonsense averages.
 */
import { aurbodaOnlyMetrics, cumulativeMetrics, type MetricType } from '@aurboda/api-spec'

/**
 * Split a list of metric names into three groups:
 * - aurbodaOnly: cumulative metrics that should use only the 'aurboda' source
 * - cumulative: other cumulative metrics that use standard cumulativeSources
 * - nonCumulative: metrics that use all sources
 */
export const splitMetricsByCumulative = (
  metrics: string[],
): { aurbodaOnly: string[]; cumulative: string[]; nonCumulative: string[] } => ({
  aurbodaOnly: metrics.filter(
    (m) => cumulativeMetrics.includes(m as MetricType) && aurbodaOnlyMetrics.includes(m as MetricType),
  ),
  cumulative: metrics.filter(
    (m) => cumulativeMetrics.includes(m as MetricType) && !aurbodaOnlyMetrics.includes(m as MetricType),
  ),
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
 *
 * Aurboda-only metrics reuse the cumulative SQL template but with ['aurboda'] as the
 * source filter instead of the standard cumulativeSources.
 */
export const querySplitByCumulative = async <T>(options: SplitQueryOptions<T>): Promise<T[]> => {
  const { aurbodaOnly, cumulative, nonCumulative } = splitMetricsByCumulative(options.metrics)
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

  if (aurbodaOnly.length > 0) {
    // Use the same cumulative SQL template but with 'aurboda' as the only source
    const extraParams = options.cumulativeExtraParams ?? []
    // Replace the cumulativeSources param with just ['aurboda']
    // The cumulativeExtraParams[0] is the sources array, so we override it
    const aurbodaExtraParams = extraParams.length > 0 ? [['aurboda'], ...extraParams.slice(1)] : [['aurboda']]
    const result = await options.queryFn(options.sqlCumulative, [
      aurbodaOnly,
      ...options.params,
      ...aurbodaExtraParams,
    ])
    results.push(...result.rows.map(options.mapRow))
  }

  if (nonCumulative.length > 0) {
    const result = await options.queryFn(options.sqlNonCumulative, [nonCumulative, ...options.params])
    results.push(...result.rows.map(options.mapRow))
  }

  return results
}
