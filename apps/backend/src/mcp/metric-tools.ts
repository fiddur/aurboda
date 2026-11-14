import {
  addCustomMetricBodySchema,
  addMetricBodySchema,
  bulkMetricItemSchema,
  customMetricDefinitionSchema,
  metricCatalogQuerySchema,
  recalculateCaloriesBodySchema,
  tzSchema,
  updateCustomMetricBodySchema,
} from '@aurboda/api-spec'
import { z } from 'zod'

import { auditError, auditInfo } from '../services/audit-log.ts'
import { computeAndStoreCalories, computeAndStoreCaloriesAll } from '../services/calorie-computation.ts'
import { listMetricCatalog, mergeCustomMetricService } from '../services/custom-metrics.ts'
import { findCatalogMetric, getCatalogMetric, loadMetricCatalog } from '../services/metric-catalog.ts'
import {
  addCustomMetric,
  addMetric,
  bulkAddMetrics,
  deleteCustomMetric,
  deleteMetric,
  deleteMetricData,
  getCustomMetrics,
  updateCustomMetric,
} from '../services/mutations.ts'
import {
  errorResponse,
  jsonResponse,
  type McpServer,
  metricDescription,
  parseOptionalDate,
  tzJsonResponse,
} from './helpers.ts'

const catalogAliasHint = (name: string): string | undefined => {
  const catalog = loadMetricCatalog()
  if (getCatalogMetric(catalog, name)) return undefined
  const entry = findCatalogMetric(catalog, name)
  return entry
    ? `"${name}" is the built-in metric "${entry.name}" (stored in ${entry.unit}): use that name with add_metric, which adds it on first use.`
    : undefined
}

export const registerMetricTools = (server: McpServer, user: string) => {
  server.tool(
    'add_metric',
    'Add a manual health metric measurement. Use this to log data not captured automatically. metric may also be a name or alias from list_metric_catalog (lab values, circumferences, body composition), which is added as a custom metric on first use. Pass unit when the value is not in the unit the metric is stored in: an accepted unit is converted, any other unit is refused.',
    { ...addMetricBodySchema.shape, tz: tzSchema },
    async ({ metric, time, unit, value, tz }) => {
      const measurementTime = time ? parseOptionalDate(time) : new Date()
      if (!measurementTime) {
        return errorResponse('Invalid time format. Use ISO 8601 format.')
      }

      const result = await addMetric(user, { metric, time: measurementTime, unit, value })
      if (!result.success) {
        return errorResponse(result.error ?? 'Failed to add metric')
      }
      return tzJsonResponse(result, tz)
    },
  )

  server.tool(
    'add_metrics_bulk',
    'Bulk insert metric data points for efficient batch imports. Accepts up to 10,000 items per call. Each item requires metric, value, and time. An item metric may be a name or alias from list_metric_catalog, added as a custom metric on first use; an item unit is converted to the unit the metric is stored in when it is accepted, and refused otherwise. Items with validation errors are skipped (not inserted), and their errors are returned separately.',
    {
      data: z.array(bulkMetricItemSchema).min(1).max(10_000).describe('Array of metric data points'),
      source: z
        .string()
        .min(1)
        .max(50)
        .optional()
        .describe('Default data source for all items (defaults to "aurboda")'),
      tz: tzSchema,
    },
    async ({ data, source, tz }) => {
      const items = data.map((item) => ({
        metric: item.metric,
        source: item.source,
        time: parseOptionalDate(item.time) ?? new Date(),
        unit: item.unit,
        value: item.value,
      }))

      const invalidTime = data.findIndex((item) => parseOptionalDate(item.time) === null)
      if (invalidTime !== -1) {
        return errorResponse(`Invalid time format at index ${invalidTime}. Use ISO 8601 format.`)
      }

      const result = await bulkAddMetrics(user, items, source)
      return tzJsonResponse(result, tz)
    },
  )

  server.tool(
    'add_custom_metric',
    "Register a new custom metric type. Custom metrics allow tracking data not covered by built-in metrics. Set include_in_daily_summary=true to surface entries and the latest value in get_daily_summary. Set aggregation='sum' for amounts (a dose, steps) so trends count days without samples as 0; the default 'avg' is for levels (weight, HR).",
    {
      ...addCustomMetricBodySchema.shape,
      separate_metric: z
        .boolean()
        .optional()
        .describe(
          'Create the metric even when its name is an alias of a built-in catalogue metric (e.g. `ldl`, which is `ldl_cholesterol`)',
        ),
    },
    async ({
      aggregation,
      description,
      include_in_daily_summary,
      max_value,
      min_value,
      name,
      separate_metric,
      unit,
    }) => {
      const hint = catalogAliasHint(name)
      if (hint && separate_metric !== true) {
        return errorResponse(`${hint} Pass separate_metric: true to create a separate custom metric anyway.`)
      }

      const definition = {
        ...(aggregation !== undefined ? { aggregation } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(include_in_daily_summary !== undefined ? { include_in_daily_summary } : {}),
        ...(max_value !== undefined ? { max_value } : {}),
        ...(min_value !== undefined ? { min_value } : {}),
        name,
        unit,
      }

      const parsed = customMetricDefinitionSchema.safeParse(definition)
      if (!parsed.success) {
        return errorResponse(`Invalid custom metric: ${parsed.error.issues.map((i) => i.message).join(', ')}`)
      }

      const result = await addCustomMetric(user, parsed.data)
      if (!result.success) {
        return errorResponse(result.error ?? 'Failed to add custom metric')
      }
      return jsonResponse(result)
    },
  )

  server.tool(
    'list_metric_catalog',
    "List Aurboda's built-in metrics for lab values, circumferences and body composition, each with the unit it is stored in and the units it accepts (`units`, with the conversion to the stored unit). `in_use` says whether the user already has a metric of that name and `in_use_unit` its unit, which wins over the catalogue's. A metric not in use is added the first time add_metric or a report entry uses its name or an alias. Check here before creating a custom metric.",
    { ...metricCatalogQuerySchema.shape },
    async ({ q }) => jsonResponse(await listMetricCatalog(user, q)),
  )

  server.tool(
    'list_custom_metrics',
    'List all registered custom metric types for the user.',
    {},
    async () => {
      const metrics = await getCustomMetrics(user)
      return jsonResponse({ data: metrics, success: true })
    },
  )

  server.tool(
    'delete_custom_metric',
    'Delete a custom metric type. Existing data for the metric is preserved.',
    {
      name: z.string().describe('The name of the custom metric to delete'),
    },
    async ({ name }) => {
      const result = await deleteCustomMetric(user, name)
      return jsonResponse(result)
    },
  )

  server.tool(
    'update_custom_metric',
    'Update an existing custom metric definition. Only provided fields are changed. Set min_value/max_value to null to clear them. Toggle include_in_daily_summary to surface or hide this metric in get_daily_summary. aggregation sets the metric kind (sum: amount, avg: level).',
    {
      name: z.string().describe('The name of the custom metric to update'),
      ...updateCustomMetricBodySchema.shape,
    },
    async ({ aggregation, description, include_in_daily_summary, max_value, min_value, name, unit }) => {
      const updates = {
        ...(aggregation !== undefined ? { aggregation } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(include_in_daily_summary !== undefined ? { include_in_daily_summary } : {}),
        ...(max_value !== undefined ? { maxValue: max_value } : {}),
        ...(min_value !== undefined ? { minValue: min_value } : {}),
        ...(unit !== undefined ? { unit } : {}),
      }

      const result = await updateCustomMetric(user, name, updates)
      if (!result.success) {
        return errorResponse(result.error ?? 'Failed to update custom metric')
      }
      return jsonResponse(result)
    },
  )

  server.tool(
    'delete_metric',
    'Delete a single metric measurement by metric name, time, and source (soft delete). Works for any source.',
    {
      metric: z.string().describe(metricDescription),
      source: z
        .string()
        .describe('Data source of the measurement (e.g. manual, oura, garmin, health_connect)'),
      time: z.string().describe('Measurement time in ISO 8601 format (must match exactly)'),
    },
    async ({ metric, source, time }) => {
      const measurementTime = parseOptionalDate(time)
      if (!measurementTime) {
        return errorResponse('Invalid time format. Use ISO 8601 format.')
      }

      const result = await deleteMetric(user, metric, measurementTime, source)
      return jsonResponse(result)
    },
  )

  server.tool(
    'delete_metric_data',
    'Delete all manual measurements for a metric. Only manual entries are deleted; synced data is preserved.',
    {
      metric: z.string().describe(metricDescription),
    },
    async ({ metric }) => {
      const result = await deleteMetricData(user, metric)
      return jsonResponse(result)
    },
  )

  server.tool(
    'recalculate_calories',
    'Recalculate calories burned from HR data for a time range. Requires sex and birth_date in settings. Uses weight from Health Connect and VO2 max (measured or age/sex fallback). Omit start/end to recompute all historical data. Full recomputes run asynchronously and return immediately.',
    {
      ...recalculateCaloriesBodySchema.shape,
      end: z.string().optional(),
      start: z.string().optional(),
      tz: tzSchema,
    },
    async ({ start, end, tz }) => {
      if (!start || !end) {
        // Full recompute runs async — fire and forget, return immediately
        computeAndStoreCaloriesAll(user).then(
          (result) =>
            auditInfo(user, 'data', `Async calorie recompute done: ${result.points_stored} points`, {
              days: result.days_processed,
            }),
          (error) => auditError(user, 'data', 'Async calorie recompute failed', { error: String(error) }),
        )
        return tzJsonResponse(
          { started: true, message: 'Full calorie recomputation started in background' },
          tz,
        )
      }
      const result = await computeAndStoreCalories(user, new Date(start), new Date(end))
      return tzJsonResponse({ ...result, success: true }, tz)
    },
  )

  server.tool(
    'merge_custom_metric',
    'Merge a custom metric into another metric (built-in or custom). All time_series data points are reassigned to the target metric and the source custom metric definition is deleted. Duplicate data points (same time + source) are skipped.',
    {
      source: z.string().describe('Name of the custom metric to merge away'),
      target: z.string().describe('Name of the target metric to merge into (built-in or custom)'),
    },
    async ({ source, target }) => {
      const result = await mergeCustomMetricService(user, source, target)
      if (!result.success) {
        return errorResponse(result.error ?? 'Failed to merge custom metric')
      }
      return jsonResponse(result)
    },
  )
}
