/**
 * MCP metric management tools.
 */
import {
  addCustomMetricBodySchema,
  addMetricBodySchema,
  customMetricDefinitionSchema,
  updateCustomMetricBodySchema,
} from '@aurboda/api-spec'
import { z } from 'zod'
import {
  addCustomMetric,
  addMetric,
  deleteCustomMetric,
  deleteMetric,
  deleteMetricData,
  getCustomMetrics,
  updateCustomMetric,
} from '../services/mutations'
import { errorResponse, jsonResponse, type McpServer, metricDescription, parseOptionalDate } from './helpers'

// eslint-disable-next-line max-lines-per-function -- tool registrations are inherently long
export const registerMetricTools = (server: McpServer, user: string) => {
  // Tool: add_metric
  server.tool(
    'add_metric',
    'Add a manual health metric measurement. Use this to log data not captured automatically.',
    { ...addMetricBodySchema.shape },
    async ({ metric, time, value }) => {
      const measurementTime = time ? parseOptionalDate(time) : new Date()
      if (!measurementTime) {
        return errorResponse('Invalid time format. Use ISO 8601 format.')
      }

      const result = await addMetric(user, { metric, time: measurementTime, value })
      if (!result.success) {
        return errorResponse(result.error ?? 'Failed to add metric')
      }
      return jsonResponse(result)
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
    'Delete a single manual metric measurement by metric name and time. Only manual entries can be deleted.',
    {
      metric: z.string().describe(metricDescription),
      time: z.string().describe('Measurement time in ISO 8601 format (must match exactly)'),
    },
    async ({ metric, time }) => {
      const measurementTime = parseOptionalDate(time)
      if (!measurementTime) {
        return errorResponse('Invalid time format. Use ISO 8601 format.')
      }

      const result = await deleteMetric(user, metric, measurementTime)
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
}
