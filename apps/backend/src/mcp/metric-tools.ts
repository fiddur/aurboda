/**
 * MCP metric management tools.
 */
import { customMetricDefinitionSchema } from '@aurboda/api-spec'
import { z } from 'zod'
import { addCustomMetric, addMetric, deleteCustomMetric, getCustomMetrics } from '../services/mutations'
import { errorResponse, jsonResponse, type McpServer, metricDescription, parseOptionalDate } from './helpers'

export const registerMetricTools = (server: McpServer, user: string) => {
  // Tool: add_metric
  server.tool(
    'add_metric',
    'Add a manual health metric measurement. Use this to log data not captured automatically.',
    {
      metric: z.string().describe(metricDescription),
      time: z
        .string()
        .optional()
        .describe('Measurement time in ISO 8601 format. Defaults to current time if omitted.'),
      value: z.number().describe('The metric value (e.g., 72 for heart rate, 75.5 for weight)'),
    },
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
    {
      description: z.string().optional().describe('Human-readable description of the metric'),
      max_value: z.number().optional().describe('Maximum allowed value for validation'),
      min_value: z.number().optional().describe('Minimum allowed value for validation'),
      name: z
        .string()
        .describe(
          'Metric name (lowercase letters, numbers, underscores). Must not conflict with built-in metrics.',
        ),
      unit: z.string().describe('Unit of measurement (e.g., "score", "mg", "count")'),
    },
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
}
