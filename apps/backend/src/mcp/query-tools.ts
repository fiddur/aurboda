/**
 * MCP query tools - read-only data retrieval.
 */
import {
  activityTypeSchema,
  bucketSizeSchema,
  dateOnlySchema,
  type MetricType,
  timeRangeQuerySchema,
  tzSchema,
  validMetrics,
} from '@aurboda/api-spec'
import { z } from 'zod'

import { getCustomMetrics } from '../services/mutations.ts'
import {
  getDailySummary,
  getPeriodSummary,
  queryActivities,
  queryLocations,
  queryMetrics,
  queryMetricsBucketed,
  queryProductivity,
  queryTags,
} from '../services/queries.ts'
import {
  errorResponse,
  type McpServer,
  metricDescription,
  type SyncProvider,
  tzJsonResponse,
} from './helpers.ts'

export const registerQueryTools = (server: McpServer, user: string, sync?: SyncProvider) => {
  // Tool: query_metrics
  server.tool(
    'query_metrics',
    'Query health metrics for a time range. Returns time series data with timestamps and values.',
    {
      ...timeRangeQuerySchema.shape,
      metric: z.string().describe(metricDescription),
      tz: tzSchema,
    },
    async ({ end, metric, start, tz }) => {
      const customMetrics = await getCustomMetrics(user)

      const result = await queryMetrics(user, metric, new Date(start), new Date(end), customMetrics)
      return tzJsonResponse(result, tz)
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
      tz: tzSchema,
    },
    async ({ bucket, end, exclude, metrics, start, tz }) => {
      const customMetrics = await getCustomMetrics(user)

      const result = await queryMetricsBucketed(
        user,
        metrics as MetricType[] | undefined,
        new Date(start),
        new Date(end),
        bucket,
        { customMetrics, exclude, tz },
      )
      return tzJsonResponse(result, tz)
    },
  )

  // Tool: get_daily_summary
  server.tool(
    'get_daily_summary',
    'Get a comprehensive summary of health data for a specific day including heart rate, steps, sleep, exercise, meals, tags, productivity, and visited places. Also includes Oura scores (sleep_score, readiness_score, resilience_score, cardiovascular_age) when available.\n\nExercise sessions include a human-readable `exercise_type` name (e.g., "yoga", "running", "weightlifting").\n\nMeals include macros (calories, protein, carbs, fat, fiber) and food item names.\n\nSleep sessions are disambiguated: `primary_sleep` is the session the user woke up from on this date (following Oura convention), `evening_sleep` is the session started this evening that continues to the next day. Each sleep session includes `sleep_date` (the date it belongs to, using wake-up convention) and `sleep_location` (best-guess location). The `oura_scores.sleep_score` evaluates the `primary_sleep` session.',
    {
      date: dateOnlySchema.describe('Date in YYYY-MM-DD format (e.g., 2024-01-15)'),
      tz: tzSchema,
    },
    async ({ date, tz }) => {
      const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
      if (!dateMatch) {
        return errorResponse('Invalid date format. Use YYYY-MM-DD format.')
      }

      const dateObj = new Date(date)
      if (isNaN(dateObj.getTime())) {
        return errorResponse('Invalid date.')
      }

      const summary = await getDailySummary(user, dateObj, sync, tz)
      return tzJsonResponse(summary, tz)
    },
  )

  // Tool: query_period_summary
  server.tool(
    'query_period_summary',
    'Get aggregated statistics for a time period. Returns min/max/avg/stddev for each metric, trend compared to previous period, and data completeness.',
    {
      ...timeRangeQuerySchema.shape,
      metrics: z.array(z.string()).describe(`Metrics to include. Valid metrics: ${validMetrics.join(', ')}`),
      tz: tzSchema,
    },
    async ({ end, metrics, start, tz }) => {
      const summary = await getPeriodSummary(user, metrics as string[], new Date(start), new Date(end))
      return tzJsonResponse(summary, tz)
    },
  )

  // Tool: query_tags
  server.tool(
    'query_tags',
    'Query tags/labels for a time range. Returns all tags with start times, optional end times, and tag text.',
    { ...timeRangeQuerySchema.shape, tz: tzSchema },
    async ({ end, start, tz }) => {
      const tags = await queryTags(user, new Date(start), new Date(end), sync)
      return tzJsonResponse({ data: tags, success: true }, tz)
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
      tz: tzSchema,
    },
    async ({ end, start, types, tz }) => {
      const { getAllActivityTypeNames } = await import('../db/activities.ts')
      const requestedTypes = types ?? (await getAllActivityTypeNames(user))
      const activities = await queryActivities(user, requestedTypes, new Date(start), new Date(end), sync)
      return tzJsonResponse({ data: activities, success: true }, tz)
    },
  )

  // Tool: query_productivity
  server.tool(
    'query_productivity',
    'Query productivity data (from RescueTime) for a time range. Returns application/website usage with productivity scores.',
    { ...timeRangeQuerySchema.shape, tz: tzSchema },
    async ({ end, start, tz }) => {
      const productivity = await queryProductivity(user, new Date(start), new Date(end), sync)
      return tzJsonResponse({ data: productivity, success: true }, tz)
    },
  )

  // Tool: query_productivity_bucketed
  server.tool(
    'query_productivity_bucketed',
    'Query screentime/productivity data bucketed by time interval, grouped by category. Returns stacked duration per category per bucket. Useful for visualizing time spent on different activities over time.',
    {
      bucket: bucketSizeSchema,
      end: timeRangeQuerySchema.shape.end,
      start: timeRangeQuerySchema.shape.start,
      tz: tzSchema,
    },
    async ({ bucket, end, start, tz }) => {
      const { interval, ms: bucketMs } = (await import('../services/queries.ts')).parseBucketSize(bucket)
      const { assembleScreentimeBuckets } = await import('../services/queries.ts')
      const rows = await (
        await import('../db/index.ts')
      ).getProductivityBucketed(user, new Date(start), new Date(end), interval, tz)

      const buckets = assembleScreentimeBuckets(rows, bucketMs)
      return tzJsonResponse({ bucket, buckets, end, start, success: true }, tz)
    },
  )

  // Tool: query_locations
  server.tool(
    'query_locations',
    'Query location/place visits for a time range. Returns places visited with names, coordinates, duration, and source (named, detected, or owntracks).',
    { ...timeRangeQuerySchema.shape, tz: tzSchema },
    async ({ end, start, tz }) => {
      const places = await queryLocations(user, new Date(start), new Date(end))
      return tzJsonResponse({ data: places, success: true }, tz)
    },
  )
}
