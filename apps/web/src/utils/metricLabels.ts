import { builtinDashboardMetrics, metricLabels } from '@aurboda/api-spec'

/**
 * Friendly metric display names live in `@aurboda/api-spec` (the single source
 * shared with the backend server-side chart renderer). Re-exported here so the
 * existing web import path keeps working.
 */
export { getMetricDisplayName, metricLabels } from '@aurboda/api-spec'

/**
 * Built-in dashboard metrics with their display names.
 */
export const builtinDashboardMetricOptions = builtinDashboardMetrics.map((m) => ({
  label: metricLabels[m] ?? m,
  value: m,
}))
