/**
 * MCP query tools - read-only data retrieval.
 */
import {
  activityTypes,
  activityTypeSchema,
  bucketSizeSchema,
  dateOnlySchema,
  isValidMetricOrCustom,
  type MetricType,
  timeRangeQuerySchema,
  validMetrics,
} from '@aurboda/api-spec'
import { z } from 'zod'
import { getCustomMetrics } from '../services/mutations'
import {
  getDailySummary,
  getPeriodSummary,
  queryActivities,
  queryLocations,
  queryMetrics,
  queryMetricsBucketed,
  queryProductivity,
  queryTags,
} from '../services/queries'
import { errorResponse, jsonResponse, type McpServer, metricDescription, type SyncProvider } from './helpers'

export const registerQueryTools = (server: McpServer, user: string, sync?: SyncProvider) => {
  // Tool: query_metrics
  server.tool(
    'query_metrics',
    'Query health metrics for a time range. Returns time series data with timestamps and values.',
    {
      ...timeRangeQuerySchema.shape,
      metric: z.string().describe(metricDescription),
    },
    async ({ end, metric, start }) => {
      const customMetrics = await getCustomMetrics(user)
      if (!isValidMetricOrCustom(metric, customMetrics)) {
        const customNames = customMetrics.map((m) => m.name)
        const allMetrics = [...validMetrics, ...customNames]
        return errorResponse(`Invalid metric "${metric}". Valid metrics are: ${allMetrics.join(', ')}`)
      }

      const result = await queryMetrics(user, metric, new Date(start), new Date(end), customMetrics)
      return jsonResponse(result)
    },
  )

  // Tool: query_metrics_bucketed
  server.tool(
    'query_metrics_bucketed',
    `Query pre-aggregated health metrics in time buckets. Returns buckets with min/max/avg/count for each metric.
Much more efficient than query_metrics for analysis - returns ~96 buckets for a day (15m intervals) instead of 30,000+ individual samples.
Cumulative metrics (steps, calories, etc.) also include a 'sum' field.

If metrics is omitted, returns ALL metrics with data in the time range.
Use exclude to skip specific metrics when fetching all.

Bucket size format: {number}{unit} where unit is s (seconds), m (minutes), h (hours), d (days), M (months).
Examples: 10s, 5m, 1h, 1d, 1M

Use cases:
- Daily timeline analysis: "Show me HR/HRV patterns across the day"
- Sleep quality analysis: "How did my HRV change during sleep?"
- Exercise response: "Compare pre/during/post exercise HR"
- Multi-day trends: "What's my average resting HR this week?" (use 1d bucket)
- All metrics overview: Omit metrics param to get everything`,
    {
      ...timeRangeQuerySchema.shape,
      bucket: bucketSizeSchema,
      exclude: z.array(z.string()).optional().describe('Metrics to exclude (useful when fetching all)'),
      metrics: z
        .array(z.string())
        .optional()
        .describe(`Metrics to include (omit for all). Valid built-in metrics: ${validMetrics.join(', ')}`),
    },
    async ({ bucket, end, exclude, metrics, start }) => {
      const customMetrics = await getCustomMetrics(user)

      // Validate specified metrics if provided
      if (metrics) {
        const invalidMetrics = metrics.filter((m) => !isValidMetricOrCustom(m, customMetrics))
        if (invalidMetrics.length > 0) {
          const customNames = customMetrics.map((m) => m.name)
          const allMetrics = [...validMetrics, ...customNames]
          return errorResponse(
            `Invalid metrics: ${invalidMetrics.join(', ')}. Valid metrics are: ${allMetrics.join(', ')}`,
          )
        }
      }

      const result = await queryMetricsBucketed(
        user,
        metrics as MetricType[] | undefined,
        new Date(start),
        new Date(end),
        bucket,
        { customMetrics, exclude },
      )
      return jsonResponse(result)
    },
  )

  // Tool: get_daily_summary
  server.tool(
    'get_daily_summary',
    'Get a comprehensive summary of health data for a specific day including heart rate, steps, sleep, exercise, tags, productivity, and visited places. Also includes Oura scores (sleep_score, readiness_score, resilience_score, cardiovascular_age) when available.\n\nSleep sessions are disambiguated: `primary_sleep` is the session the user woke up from on this date (following Oura convention), `evening_sleep` is the session started this evening that continues to the next day. Each sleep session includes `sleep_date` (the date it belongs to, using wake-up convention) and `sleep_location` (best-guess location). The `oura_scores.sleep_score` evaluates the `primary_sleep` session.',
    {
      date: dateOnlySchema.describe('Date in YYYY-MM-DD format (e.g., 2024-01-15)'),
    },
    async ({ date }) => {
      const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
      if (!dateMatch) {
        return errorResponse('Invalid date format. Use YYYY-MM-DD format.')
      }

      const dateObj = new Date(date)
      if (isNaN(dateObj.getTime())) {
        return errorResponse('Invalid date.')
      }

      const summary = await getDailySummary(user, dateObj, sync)
      return jsonResponse(summary)
    },
  )

  // Tool: query_period_summary
  server.tool(
    'query_period_summary',
    'Get aggregated statistics for a time period. Returns min/max/avg/stddev for each metric, trend compared to previous period, and data completeness.',
    {
      ...timeRangeQuerySchema.shape,
      metrics: z.array(z.string()).describe(`Metrics to include. Valid metrics: ${validMetrics.join(', ')}`),
    },
    async ({ end, metrics, start }) => {
      const customMetrics = await getCustomMetrics(user)
      const invalidMetrics = metrics.filter((m) => !isValidMetricOrCustom(m, customMetrics))
      if (invalidMetrics.length > 0) {
        const customNames = customMetrics.map((m) => m.name)
        const allMetrics = [...validMetrics, ...customNames]
        return errorResponse(
          `Invalid metrics: ${invalidMetrics.join(', ')}. Valid metrics are: ${allMetrics.join(', ')}`,
        )
      }

      const summary = await getPeriodSummary(user, metrics as string[], new Date(start), new Date(end))
      return jsonResponse(summary)
    },
  )

  // Tool: query_tags
  server.tool(
    'query_tags',
    'Query tags/labels for a time range. Returns all tags with start times, optional end times, and tag text.',
    { ...timeRangeQuerySchema.shape },
    async ({ end, start }) => {
      const tags = await queryTags(user, new Date(start), new Date(end), sync)
      return jsonResponse({ data: tags, success: true })
    },
  )

  // Tool: query_activities
  server.tool(
    'query_activities',
    'Query activities (sleep, exercise, meditation, nap, rest) for a time range. Returns activity sessions with duration, HR zones for exercise, and other metadata.',
    {
      ...timeRangeQuerySchema.shape,
      types: z
        .array(activityTypeSchema)
        .optional()
        .describe(
          'Activity types to include. Defaults to all types (sleep, exercise, meditation, nap, rest).',
        ),
    },
    async ({ end, start, types }) => {
      const requestedTypes = types ?? [...activityTypes]
      const activities = await queryActivities(user, requestedTypes, new Date(start), new Date(end), sync)
      return jsonResponse({ data: activities, success: true })
    },
  )

  // Tool: query_productivity
  server.tool(
    'query_productivity',
    'Query productivity data (from RescueTime) for a time range. Returns application/website usage with productivity scores.',
    { ...timeRangeQuerySchema.shape },
    async ({ end, start }) => {
      const productivity = await queryProductivity(user, new Date(start), new Date(end), sync)
      return jsonResponse({ data: productivity, success: true })
    },
  )

  // Tool: query_locations
  server.tool(
    'query_locations',
    'Query location/place visits for a time range. Returns places visited with names, coordinates, duration, and source (named, detected, or owntracks).',
    { ...timeRangeQuerySchema.shape },
    async ({ end, start }) => {
      const places = await queryLocations(user, new Date(start), new Date(end))
      return jsonResponse({ data: places, success: true })
    },
  )
}
