/**
 * MCP metric management tools.
 */
import {
  addCustomMetricBodySchema,
  addMetricBodySchema,
  bulkMetricItemSchema,
  customMetricDefinitionSchema,
  recalculateCaloriesBodySchema,
  tzSchema,
  updateCustomMetricBodySchema,
} from '@aurboda/api-spec'
import { z } from 'zod'

import { auditError, auditInfo } from '../services/audit-log.ts'
import { computeAndStoreCalories, computeAndStoreCaloriesAll } from '../services/calorie-computation.ts'
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

export const registerMetricTools = (server: McpServer, user: string) => {
  // Tool: add_metric
  server.tool(
    'add_metric',
    'Add a manual health metric measurement. Use this to log data not captured automatically.',
    { ...addMetricBodySchema.shape, tz: tzSchema },
    async ({ metric, time, value, tz }) => {
      const measurementTime = time ? parseOptionalDate(time) : new Date()
      if (!measurementTime) {
        return errorResponse('Invalid time format. Use ISO 8601 format.')
      }

      const result = await addMetric(user, { metric, time: measurementTime, value })
      if (!result.success) {
        return errorResponse(result.error ?? 'Failed to add metric')
      }
      return tzJsonResponse(result, tz)
    },
  )

  // Tool: add_metrics_bulk
  server.tool(
    'add_metrics_bulk',
    'Bulk insert metric data points for efficient batch imports. Accepts up to 10,000 items per call. Each item requires metric, value, and time. Items with validation errors are skipped (not inserted), and their errors are returned separately.',
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

  // Tool: add_custom_metric
  server.tool(
    'add_custom_metric',
    'Register a new custom metric type. Custom metrics allow tracking data not covered by built-in metrics.',
    { ...addCustomMetricBodySchema.shape },
    async ({ description, max_value, min_value, name, unit }) => {
      const definition = {
        ...(description !== undefined ? { description } : {}),
        ...(max_value !== undefined ? { maxValue: max_value } : {}),
        ...(min_value !== undefined ? { minValue: min_value } : {}),
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

  // Tool: list_custom_metrics
  server.tool(
    'list_custom_metrics',
    'List all registered custom metric types for the user.',
    {},
    async () => {
      const metrics = await getCustomMetrics(user)
      return jsonResponse({ data: metrics, success: true })
    },
  )

  // Tool: delete_custom_metric
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

  // Tool: update_custom_metric
  server.tool(
    'update_custom_metric',
    'Update an existing custom metric definition. Only provided fields are changed. Set min_value/max_value to null to clear them.',
    {
      name: z.string().describe('The name of the custom metric to update'),
      ...updateCustomMetricBodySchema.shape,
    },
    async ({ description, max_value, min_value, name, unit }) => {
      const updates = {
        ...(description !== undefined ? { description } : {}),
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

  // Tool: delete_metric
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

  // Tool: delete_metric_data
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

  // Tool: recalculate_calories
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
      const result = await computeAndStoreCalories(user, new Date(start), new Date(end), { force: true })
      return tzJsonResponse({ ...result, success: true }, tz)
    },
  )
}
