import {
  activityTypes,
  activityTypeSchema,
  dateOnlySchema,
  endDateTimeQuerySchema,
  exerciseTypeNames,
  getExerciseTypeValue,
  hrZoneThresholdsSchema,
  isValidExerciseType,
  isValidMetric,
  latWithValidationSchema,
  lonWithValidationSchema,
  MetricType,
  startDateTimeQuerySchema,
  syncProviderSchema,
  validMetrics,
} from '@aurboda/api-spec'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { randomUUID } from 'crypto'
import { Request, Response, Router } from 'express'
import { z } from 'zod'
import { Auth } from './auth'
import { getAllSyncStates, getDetectedLocations as getStoredDetectedLocations } from './db'
import { DEFAULT_SESSION_INACTIVITY_MS, McpSessionStore } from './mcp-session-store'
import { ouraClient } from './oura'
import { syncAllOuraData } from './oura-sync'
import { syncRescueTimeData } from './rescuetime-sync'
import {
  getActivityImpact,
  getBaseline,
  getEventProbability,
  getHrvActivitiesCorrelation,
} from './services/correlations'
import { getGoalsProgress } from './services/goals'
import {
  deleteNamedLocation,
  getDetectedLocations,
  getNamedLocations,
  insertNamedLocation,
  updateNamedLocation,
} from './services/locations'
import { addActivity, addMetric, addTag, deleteTag } from './services/mutations'
import {
  getDailySummary,
  getPeriodSummary,
  queryActivities,
  queryLocations,
  queryMetrics,
  queryProductivity,
  queryTags,
  SyncProvider,
} from './services/queries'
import { getSettings, getSettingsResponse, validateAndUpdateSettings } from './services/settings'

interface McpSession {
  transport: StreamableHTTPServerTransport
  server: McpServer
  user: string
}

type OuraClientType = ReturnType<typeof ouraClient>

// ============================================================================
// MCP-specific input schemas (reusing fields from api-spec)
// ============================================================================

// Common time range schema for MCP queries
const mcpTimeRangeSchema = {
  end: endDateTimeQuerySchema,
  start: startDateTimeQuerySchema,
}

// Metric name description using validMetrics from api-spec
const metricDescription = `Metric name. Valid metrics: ${validMetrics.join(', ')}`

/**
 * Create an MCP router with optional session persistence.
 *
 * When a sessionStore is provided, sessions are persisted to the database
 * and can survive backend restarts. When a client reconnects with a
 * previously-issued session ID, the session is lazily restored.
 */
export function createMcpRouter(
  auth: Auth,
  oura?: OuraClientType,
  sync?: SyncProvider,
  options?: { sessionStore?: McpSessionStore; cleanupIntervalMs?: number },
): Router {
  const router = Router()
  const sessions = new Map<string, McpSession>()
  const sessionStore = options?.sessionStore
  const cleanupIntervalMs = options?.cleanupIntervalMs ?? 60 * 60 * 1000 // Default: 1 hour

  const getAuthenticatedUser = (req: Request): string | null => {
    const authHeader = req.headers.authorization
    if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      return null
    }
    try {
      const token = authHeader.slice('Bearer '.length)
      return auth.getUsernameFromToken(token)
    } catch {
      return null
    }
  }

  // Helper to create JSON text response
  const jsonResponse = (data: unknown) => ({
    content: [{ text: JSON.stringify(data, null, 2), type: 'text' as const }],
  })

  // Helper to create error response
  const errorResponse = (message: string) => ({
    content: [{ text: message, type: 'text' as const }],
  })

  // Helper to parse optional ISO date string (for fields using plain z.string())
  // Note: Fields using startDateTimeQuerySchema/endDateTimeQuerySchema are already
  // validated by zod, so they can be converted directly with new Date()
  const parseOptionalDate = (dateStr: string): Date | null => {
    const date = new Date(dateStr)
    return isNaN(date.getTime()) ? null : date
  }

  const createMcpServer = (user: string): McpServer => {
    const server = new McpServer({
      name: 'aurboda',
      version: '1.0.0',
    })

    // ========================================================================
    // Query Tools
    // ========================================================================

    // Tool: query_metrics
    server.tool(
      'query_metrics',
      'Query health metrics for a time range. Returns time series data with timestamps and values.',
      {
        ...mcpTimeRangeSchema,
        metric: z.string().describe(metricDescription),
      },
      async ({ end, metric, start }) => {
        if (!isValidMetric(metric)) {
          return errorResponse(`Invalid metric "${metric}". Valid metrics are: ${validMetrics.join(', ')}`)
        }

        // Dates are pre-validated by zod schema (startDateTimeQuerySchema/endDateTimeQuerySchema)
        const result = await queryMetrics(user, metric, new Date(start), new Date(end))
        return jsonResponse(result)
      },
    )

    // Tool: get_daily_summary
    server.tool(
      'get_daily_summary',
      'Get a comprehensive summary of health data for a specific day including heart rate, steps, sleep, exercise, tags, productivity, and visited places. Also includes Oura scores (sleep_score, readiness_score, resilience_score, cardiovascular_age) when available.',
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
        ...mcpTimeRangeSchema,
        metrics: z
          .array(z.string())
          .describe(`Metrics to include. Valid metrics: ${validMetrics.join(', ')}`),
      },
      async ({ end, metrics, start }) => {
        const invalidMetrics = metrics.filter((m) => !isValidMetric(m))
        if (invalidMetrics.length > 0) {
          return errorResponse(
            `Invalid metrics: ${invalidMetrics.join(', ')}. Valid metrics are: ${validMetrics.join(', ')}`,
          )
        }

        // Dates are pre-validated by zod schema
        const validatedMetrics = metrics as MetricType[]
        const summary = await getPeriodSummary(user, validatedMetrics, new Date(start), new Date(end))
        return jsonResponse(summary)
      },
    )

    // Tool: query_tags
    server.tool(
      'query_tags',
      'Query tags/labels for a time range. Returns all tags with start times, optional end times, and tag text.',
      mcpTimeRangeSchema,
      async ({ end, start }) => {
        // Dates are pre-validated by zod schema
        const tags = await queryTags(user, new Date(start), new Date(end), sync)
        return jsonResponse({ data: tags, success: true })
      },
    )

    // Tool: query_activities
    server.tool(
      'query_activities',
      'Query activities (sleep, exercise, meditation, nap) for a time range. Returns activity sessions with duration, HR zones for exercise, and other metadata.',
      {
        ...mcpTimeRangeSchema,
        types: z
          .array(activityTypeSchema)
          .optional()
          .describe('Activity types to include. Defaults to all types (sleep, exercise, meditation, nap).'),
      },
      async ({ end, start, types }) => {
        // Dates are pre-validated by zod schema
        // Use activityTypes from api-spec to avoid hardcoded values
        const requestedTypes = types ?? [...activityTypes]
        const activities = await queryActivities(user, requestedTypes, new Date(start), new Date(end), sync)
        return jsonResponse({ data: activities, success: true })
      },
    )

    // Tool: query_productivity
    server.tool(
      'query_productivity',
      'Query productivity data (from RescueTime) for a time range. Returns application/website usage with productivity scores.',
      mcpTimeRangeSchema,
      async ({ end, start }) => {
        // Dates are pre-validated by zod schema
        const productivity = await queryProductivity(user, new Date(start), new Date(end), sync)
        return jsonResponse({ data: productivity, success: true })
      },
    )

    // Tool: query_locations
    server.tool(
      'query_locations',
      'Query location/place visits for a time range. Returns places visited with names, coordinates, duration, and source (named, detected, or owntracks).',
      mcpTimeRangeSchema,
      async ({ end, start }) => {
        // Dates are pre-validated by zod schema
        const places = await queryLocations(user, new Date(start), new Date(end))
        return jsonResponse({ data: places, success: true })
      },
    )

    // ========================================================================
    // Tag Management Tools
    // ========================================================================

    // Tool: add_tag
    server.tool(
      'add_tag',
      'Add a manual tag/label to mark an activity or event. Tags can have a start time and optional end time.',
      {
        end_time: z
          .string()
          .optional()
          .describe('Optional end time in ISO 8601 format. Omit for point-in-time tags.'),
        merge_span: z
          .number()
          .int()
          .positive()
          .max(3600)
          .optional()
          .describe(
            'If provided, merge with existing tag of same name if its end_time (or start_time for point-in-time tags) is within this many seconds of new start_time. Max 3600.',
          ),
        start_time: startDateTimeQuerySchema.describe(
          'Start time in ISO 8601 format (e.g., 2024-01-15T14:30:00Z)',
        ),
        tag: z.string().describe('The tag/label text (e.g., "coffee", "meditation", "headache")'),
      },
      async ({ end_time, merge_span, start_time, tag }) => {
        // start_time is pre-validated by zod schema
        const startDate = new Date(start_time)

        // end_time uses plain z.string() so needs manual validation
        let endDate: Date | undefined
        if (end_time) {
          const parsed = parseOptionalDate(end_time)
          if (!parsed) {
            return errorResponse('Invalid end_time format. Use ISO 8601 format.')
          }
          endDate = parsed
        }

        const result = await addTag(user, {
          endTime: endDate,
          mergeSpan: merge_span,
          startTime: startDate,
          tag,
        })
        return jsonResponse(result)
      },
    )

    // Tool: delete_tag
    server.tool(
      'delete_tag',
      'Delete a tag by its external ID. Returns success if the tag was found and deleted.',
      {
        external_id: z.string().describe('The external ID of the tag to delete'),
      },
      async ({ external_id }) => {
        const result = await deleteTag(user, external_id)
        return jsonResponse(result)
      },
    )

    // ========================================================================
    // Metric Management Tools
    // ========================================================================

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
        if (!isValidMetric(metric)) {
          return errorResponse(`Invalid metric "${metric}". Valid metrics are: ${validMetrics.join(', ')}`)
        }

        // time uses plain z.string() so needs manual validation
        const measurementTime = time ? parseOptionalDate(time) : new Date()
        if (!measurementTime) {
          return errorResponse('Invalid time format. Use ISO 8601 format.')
        }

        const result = await addMetric(user, { metric, time: measurementTime, value })
        return jsonResponse(result)
      },
    )

    // ========================================================================
    // Activity Management Tools
    // ========================================================================

    // Tool: add_activity
    server.tool(
      'add_activity',
      'Add an activity session (exercise, meditation, nap). Use this to log workouts or other activities.',
      {
        activity_type: activityTypeSchema.describe(
          `Type of activity. Valid types: ${activityTypes.join(', ')}`,
        ),
        end_time: endDateTimeQuerySchema.describe('End time in ISO 8601 format (e.g., 2024-03-15T11:45:00Z)'),
        exercise_type: z
          .string()
          .optional()
          .describe(
            `Exercise type name (e.g., "weightlifting", "running"). Only for exercise activities. Valid types: ${exerciseTypeNames.slice(0, 10).join(', ')}...`,
          ),
        notes: z
          .string()
          .optional()
          .describe(
            'Activity notes. For workouts, use format: "Exercise Name: reps×weight, reps×weight" per line.',
          ),
        start_time: startDateTimeQuerySchema.describe(
          'Start time in ISO 8601 format (e.g., 2024-03-15T10:30:00Z)',
        ),
        title: z.string().optional().describe('Activity title (e.g., "Upper body", "Morning meditation")'),
      },
      async ({ activity_type, end_time, exercise_type, notes, start_time, title }) => {
        // Dates are pre-validated by zod schema
        const startDate = new Date(start_time)
        const endDate = new Date(end_time)

        // Validate and convert exercise_type name to value
        let data: Record<string, unknown> | undefined
        if (exercise_type !== undefined) {
          if (!isValidExerciseType(exercise_type)) {
            return errorResponse(
              `Invalid exercise_type "${exercise_type}". Valid types include: ${exerciseTypeNames.slice(0, 15).join(', ')}...`,
            )
          }
          data = {
            exerciseType: getExerciseTypeValue(exercise_type),
            exerciseTypeName: exercise_type,
          }
        }

        const result = await addActivity(user, {
          activityType: activity_type,
          data,
          endTime: endDate,
          notes,
          startTime: startDate,
          title,
        })

        if (!result.success) {
          return errorResponse(result.error ?? 'Failed to add activity')
        }

        return jsonResponse(result)
      },
    )

    // ========================================================================
    // Sync Tools
    // ========================================================================

    // Tool: sync_oura
    server.tool(
      'sync_oura',
      'Sync data from Oura Ring API. Fetches cardiovascular age, readiness, resilience, sleep scores, meditation sessions, and tags.',
      {
        full_resync: z
          .boolean()
          .optional()
          .describe(
            'If true, fetches all historical data (default 90 days). Otherwise, fetches only since last sync.',
          ),
        start_date: z
          .string()
          .optional()
          .describe('Optional start date for sync in YYYY-MM-DD format. Only used with full_resync.'),
      },
      async ({ full_resync, start_date }) => {
        if (!oura) {
          return errorResponse('Oura integration is not configured on this server.')
        }

        try {
          const results = await syncAllOuraData(user, oura, {
            fullResync: full_resync,
            startDate: start_date ? new Date(start_date) : undefined,
          })

          const summary = results.map((r) => ({
            dataType: r.dataType,
            error: r.error,
            recordsProcessed: r.recordsProcessed,
            status: r.status,
          }))

          return jsonResponse({ results: summary, success: true })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          return jsonResponse({ error: message, success: false })
        }
      },
    )

    // Tool: sync_rescuetime
    server.tool(
      'sync_rescuetime',
      'Sync productivity data from RescueTime API. Fetches application and website usage with productivity scores.',
      {
        full_resync: z
          .boolean()
          .optional()
          .describe(
            'If true, fetches all historical data (default 30 days). Otherwise, fetches only since last sync.',
          ),
        start_date: z
          .string()
          .optional()
          .describe('Optional start date for sync in YYYY-MM-DD format. Only used with full_resync.'),
      },
      async ({ full_resync, start_date }) => {
        const settings = await getSettings(user)
        if (!settings.rescueTimeKey) {
          return errorResponse('RescueTime API key is not configured in user settings.')
        }

        try {
          const result = await syncRescueTimeData(user, settings.rescueTimeKey, {
            fullResync: full_resync,
            startDate: start_date ? new Date(start_date) : undefined,
          })

          return jsonResponse({
            error: result.error,
            recordsProcessed: result.recordsProcessed,
            status: result.status,
            success: result.status === 'success',
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          return jsonResponse({ error: message, success: false })
        }
      },
    )

    // Tool: get_sync_status
    server.tool(
      'get_sync_status',
      'Get the current sync status for Oura and RescueTime data sources. Shows last sync time, status, and any errors.',
      {
        provider: syncProviderSchema.optional().describe('Which provider to check. Defaults to "all".'),
      },
      async ({ provider = 'all' }) => {
        try {
          const states: Record<string, unknown[]> = {}

          if (provider === 'all' || provider === 'oura') {
            states.oura = await getAllSyncStates(user, 'oura')
          }

          if (provider === 'all' || provider === 'rescuetime') {
            states.rescuetime = await getAllSyncStates(user, 'rescuetime')
          }

          return jsonResponse({ states, success: true })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          return jsonResponse({ error: message, success: false })
        }
      },
    )

    // ========================================================================
    // User Settings Tools
    // ========================================================================

    // Tool: get_user_settings
    server.tool(
      'get_user_settings',
      'Get user settings including birth date and effective HR zones. HR zones are used to calculate time spent in different heart rate zones during exercise.',
      {},
      async () => {
        const result = await getSettingsResponse(user)
        return jsonResponse(result)
      },
    )

    // Tool: update_user_settings
    server.tool(
      'update_user_settings',
      'Update user settings. Can set birth date (for age-based HR zones) and/or custom HR zone thresholds.',
      {
        birth_date: z
          .string()
          .nullable()
          .optional()
          .describe('Birth date in YYYY-MM-DD format. Set to null to clear.'),
        hr_zone_start: hrZoneThresholdsSchema
          .nullable()
          .optional()
          .describe('Custom HR zone start thresholds. Values must be ascending. Set to null to clear.'),
      },
      async ({ birth_date, hr_zone_start }) => {
        const result = await validateAndUpdateSettings(user, {
          birthDate: birth_date,
          hrZoneStart: hr_zone_start,
        })
        return jsonResponse(result)
      },
    )

    // Tool: get_goal_progress
    server.tool(
      'get_goal_progress',
      'Get progress toward all user goals. Returns current value, min/max targets, and how much will be lost when the oldest day exits the rolling window.',
      {},
      async () => {
        const goals = await getGoalsProgress(user)
        return jsonResponse({ goals, success: true })
      },
    )

    // ========================================================================
    // Location Tools
    // ========================================================================

    // Tool: get_named_locations
    server.tool(
      'get_named_locations',
      'List all named locations. These are user-defined places with names and coordinates.',
      {},
      async () => {
        const locations = await getNamedLocations(user)
        return jsonResponse({ data: locations, success: true })
      },
    )

    // Tool: get_detected_locations
    server.tool(
      'get_detected_locations',
      'Get frequently visited locations that are not yet named. Detects places where user spent 60+ minutes. Returns coordinates, visit count, and total time spent.',
      {
        ...mcpTimeRangeSchema,
        min_duration: z.number().optional().describe('Minimum stay duration in minutes. Defaults to 60.'),
      },
      async ({ end, min_duration, start }) => {
        // Dates are pre-validated by zod schema
        const detected = await getDetectedLocations(user, {
          end: new Date(end),
          minDurationMinutes: min_duration,
          start: new Date(start),
        })

        return jsonResponse({ data: detected, success: true })
      },
    )

    // Tool: get_stored_detected_locations
    server.tool(
      'get_stored_detected_locations',
      'Get stored detected locations with geocoded addresses. These are locations that have been previously detected and stored in the database.',
      {},
      async () => {
        const detected = await getStoredDetectedLocations(user)
        // JSON.stringify automatically converts Date objects to ISO strings
        return jsonResponse({ data: detected, success: true })
      },
    )

    // Tool: add_named_location
    server.tool(
      'add_named_location',
      'Create a named location. Use this to save a frequently visited place with a name.',
      {
        lat: latWithValidationSchema.describe('Latitude of the location (-90 to 90)'),
        lon: lonWithValidationSchema.describe('Longitude of the location (-180 to 180)'),
        name: z.string().describe('Name for the location (e.g., "Home", "Office", "Gym")'),
        radius: z.number().optional().describe('Radius in meters. Defaults to 200.'),
      },
      async ({ lat, lon, name, radius }) => {
        // lat/lon are pre-validated by zod schema (latWithValidationSchema/lonWithValidationSchema)
        const location = await insertNamedLocation(user, { lat, lon, name, radius })
        return jsonResponse({ data: location, success: true })
      },
    )

    // Tool: update_named_location
    server.tool(
      'update_named_location',
      'Update an existing named location. Can change name, coordinates, or radius.',
      {
        id: z.string().describe('The ID of the named location to update'),
        lat: z.number().optional().describe('New latitude (-90 to 90). Must be provided with lon.'),
        lon: z.number().optional().describe('New longitude (-180 to 180). Must be provided with lat.'),
        name: z.string().optional().describe('New name for the location'),
        radius: z.number().optional().describe('New radius in meters'),
      },
      async ({ id, lat, lon, name, radius }) => {
        if ((lat !== undefined && lon === undefined) || (lon !== undefined && lat === undefined)) {
          return errorResponse('lat and lon must be provided together.')
        }

        if (lat !== undefined && (lat < -90 || lat > 90)) {
          return errorResponse('Invalid latitude. Must be between -90 and 90.')
        }
        if (lon !== undefined && (lon < -180 || lon > 180)) {
          return errorResponse('Invalid longitude. Must be between -180 and 180.')
        }

        const location = await updateNamedLocation(user, id, { lat, lon, name, radius })
        if (!location) {
          return jsonResponse({ error: 'Named location not found', success: false })
        }
        return jsonResponse({ data: location, success: true })
      },
    )

    // Tool: delete_named_location
    server.tool(
      'delete_named_location',
      'Delete a named location by its ID.',
      {
        id: z.string().describe('The ID of the named location to delete'),
      },
      async ({ id }) => {
        const deleted = await deleteNamedLocation(user, id)
        if (!deleted) {
          return jsonResponse({ error: 'Named location not found', success: false })
        }
        return jsonResponse({ success: true })
      },
    )

    // Tool: promote_detected_location
    server.tool(
      'promote_detected_location',
      'Create a named location from detected coordinates. Use after get_detected_locations to save a frequently visited place.',
      {
        lat: latWithValidationSchema.describe('Latitude from detected location'),
        lon: lonWithValidationSchema.describe('Longitude from detected location'),
        name: z.string().describe('Name for the location'),
        radius: z.number().optional().describe('Radius in meters. Uses suggested radius if not provided.'),
      },
      async ({ lat, lon, name, radius }) => {
        const location = await insertNamedLocation(user, { lat, lon, name, radius })
        return jsonResponse({ data: location, success: true })
      },
    )

    // ========================================================================
    // Correlation Analysis Tools
    // ========================================================================

    // Tool: get_baseline
    server.tool(
      'get_baseline',
      'Get HRV baseline statistics (7-day and 30-day averages). Returns mean HRV (rmssd) and resting heart rate with trend percentage.',
      {
        reference_date: dateOnlySchema
          .optional()
          .describe('Reference date for baseline calculation in YYYY-MM-DD format. Defaults to today.'),
      },
      async ({ reference_date }) => {
        const referenceDate = reference_date ? new Date(reference_date) : undefined
        const baseline = await getBaseline(user, referenceDate)
        return jsonResponse({ data: baseline, success: true })
      },
    )

    // Tool: get_hrv_activities_correlation
    server.tool(
      'get_hrv_activities_correlation',
      'Get HRV correlations with various activities. Returns Pearson correlation coefficients between HRV and productivity, locations, activities, and tags.',
      {
        period_days: z.number().int().optional().describe('Number of days to analyze. Defaults to 30.'),
      },
      async ({ period_days }) => {
        const periodDays = period_days ?? 30
        const correlations = await getHrvActivitiesCorrelation(user, periodDays, sync)
        return jsonResponse({ data: correlations, success: true })
      },
    )

    // Tool: get_activity_impact
    server.tool(
      'get_activity_impact',
      'Get the impact of a specific activity/tag on HRV and heart rate. Compares metric values before, during, and after the activity using time windows.',
      {
        activity: z
          .string()
          .describe('The activity or tag name to analyze (e.g., "gym", "coffee", "meditation")'),
        activity_type: z
          .enum(['productivity_category', 'productivity_app', 'location', 'tag', 'activity_type'])
          .describe('Type of activity to search for'),
        period_days: z.number().int().optional().describe('Number of days to analyze. Defaults to 90.'),
        window_minutes: z
          .number()
          .int()
          .optional()
          .describe('Minutes to analyze before/after the activity. Defaults to 30.'),
      },
      async ({ activity, activity_type, period_days, window_minutes }) => {
        const periodDays = period_days ?? 90
        const windowMinutes = window_minutes ?? 30

        const impact = await getActivityImpact(user, activity, activity_type, windowMinutes, periodDays, sync)
        return jsonResponse({ data: impact, success: true })
      },
    )

    // Tool: get_event_probability
    server.tool(
      'get_event_probability',
      'Get the probability correlation between two events. Analyzes whether one event (trigger) increases or decreases the probability of another event (outcome) occurring within specified time windows. Uses chi-squared test for statistical significance.',
      {
        lag_windows: z
          .array(z.string())
          .optional()
          .describe(
            'Time windows to analyze (e.g., ["12h", "24h", "36h", "48h"]). Uses hours (h) or days (d).',
          ),
        outcome_pattern: z
          .string()
          .describe('Regex pattern for outcome tags (e.g., "headache|migraine", "good_sleep")'),
        period_days: z.number().int().optional().describe('Number of days to analyze. Defaults to 365.'),
        trigger_type: z.enum(['activity', 'tag']).describe('Type of trigger event'),
        trigger_value: z
          .string()
          .describe('Trigger activity type or tag pattern (e.g., "exercise", "gym", "coffee")'),
      },
      async ({ lag_windows, outcome_pattern, period_days, trigger_type, trigger_value }) => {
        const probability = await getEventProbability(
          user,
          { type: trigger_type, value: trigger_value },
          { pattern: outcome_pattern, type: 'tag' },
          lag_windows ?? ['12h', '24h', '36h', '48h'],
          period_days ?? 365,
          sync,
        )
        return jsonResponse({ data: probability, success: true })
      },
    )

    return server
  }

  // Helper to restore a session from the store (lazy restoration after restart)
  const restoreSessionFromStore = async (user: string, sessionId: string): Promise<McpSession | null> => {
    if (!sessionStore) {
      console.log('[MCP] restoreSessionFromStore: no sessionStore configured')
      return null
    }

    console.log(`[MCP] restoreSessionFromStore: attempting to restore session ${sessionId} for user ${user}`)
    const record = await sessionStore.get(user, sessionId)
    if (!record) {
      console.log(`[MCP] restoreSessionFromStore: session ${sessionId} not found in store`)
      return null
    }
    if (record.username !== user) {
      console.log(
        `[MCP] restoreSessionFromStore: session ${sessionId} belongs to ${record.username}, not ${user}`,
      )
      return null
    }

    // Check if session is expired (older than 7 days by default)
    const maxAge = DEFAULT_SESSION_INACTIVITY_MS
    const age = Date.now() - record.lastActivity.getTime()
    console.log(
      `[MCP] restoreSessionFromStore: session ${sessionId} age=${age}ms, maxAge=${maxAge}ms, lastActivity=${record.lastActivity.toISOString()}`,
    )
    if (age > maxAge) {
      // Session expired - clean it up
      console.log(`[MCP] restoreSessionFromStore: session ${sessionId} expired, deleting`)
      await sessionStore.delete(user, sessionId)
      return null
    }

    // Recreate the McpServer and transport
    console.log(`[MCP] restoreSessionFromStore: recreating McpServer for session ${sessionId}`)
    const server = createMcpServer(user)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
    })

    await server.connect(transport)

    const session: McpSession = { server, transport, user }
    sessions.set(sessionId, session)

    console.log(`[MCP] restoreSessionFromStore: session ${sessionId} restored successfully`)
    return session
  }

  // Periodic cleanup of in-memory sessions that have no recent activity
  // This runs on an interval to free memory from abandoned sessions
  let cleanupTimer: ReturnType<typeof setInterval> | undefined
  if (sessionStore) {
    cleanupTimer = setInterval(async () => {
      const now = Date.now()
      for (const [sessionId, session] of sessions) {
        // Check store for last activity
        const record = await sessionStore.get(session.user, sessionId)
        if (!record || now - record.lastActivity.getTime() > DEFAULT_SESSION_INACTIVITY_MS) {
          // Close and remove stale session
          await session.server.close()
          sessions.delete(sessionId)
          if (record) {
            await sessionStore.delete(session.user, sessionId)
          }
        }
      }
    }, cleanupIntervalMs)

    // Don't let the timer prevent process exit
    cleanupTimer.unref()
  }

  // POST /mcp - Handle JSON-RPC requests
  router.post('/', async (req: Request, res: Response) => {
    const user = getAuthenticatedUser(req)
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const sessionId = req.headers['mcp-session-id'] as string | undefined
    console.log(
      `[MCP] POST request: user=${user}, sessionId=${sessionId ?? 'none'}, hasStore=${!!sessionStore}`,
    )

    let session: McpSession | undefined

    if (sessionId && sessions.has(sessionId)) {
      // Session is in memory
      console.log(`[MCP] POST: session ${sessionId} found in memory`)
      session = sessions.get(sessionId)!
      if (session.user !== user) {
        res.status(403).json({ error: 'Session belongs to different user' })
        return
      }
    } else if (sessionId && sessionStore) {
      // Session not in memory - try to restore from store
      console.log(`[MCP] POST: session ${sessionId} not in memory, attempting restore from store`)
      try {
        const restored = await restoreSessionFromStore(user, sessionId)
        if (restored) {
          session = restored
        }
      } catch (err) {
        console.error(`[MCP] POST: error restoring session ${sessionId}:`, err)
        // Continue to create new session
      }
    }

    if (!session) {
      // Create new session - generate ID first so transport and our map use the same one
      const newSessionId = randomUUID()
      console.log(`[MCP] POST: creating new session ${newSessionId} for user ${user}`)
      const server = createMcpServer(user)
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
      })

      await server.connect(transport)

      session = { server, transport, user }
      sessions.set(newSessionId, session)

      // Persist to store if available
      if (sessionStore) {
        console.log(`[MCP] POST: saving new session ${newSessionId} to store`)
        try {
          await sessionStore.save(user, newSessionId)
        } catch (err) {
          console.error(`[MCP] POST: error saving session ${newSessionId}:`, err)
          // Continue without persistence
        }
      }
    }

    await session.transport.handleRequest(req, res)

    // Update last activity in store
    if (sessionStore && sessionId) {
      try {
        await sessionStore.touch(user, sessionId)
      } catch (err) {
        console.error(`[MCP] POST: error touching session ${sessionId}:`, err)
      }
    }
  })

  // GET /mcp - SSE stream for server notifications
  router.get('/', async (req: Request, res: Response) => {
    const user = getAuthenticatedUser(req)
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const sessionId = req.headers['mcp-session-id'] as string | undefined

    if (!sessionId) {
      res.status(400).json({ error: 'Invalid or missing session ID' })
      return
    }

    let session = sessions.get(sessionId)

    // Try to restore from store if not in memory
    if (!session && sessionStore) {
      session = (await restoreSessionFromStore(user, sessionId)) ?? undefined
    }

    if (!session) {
      res.status(400).json({ error: 'Invalid or missing session ID' })
      return
    }

    if (session.user !== user) {
      res.status(403).json({ error: 'Session belongs to different user' })
      return
    }

    await session.transport.handleRequest(req, res)

    // Update last activity in store
    if (sessionStore) {
      await sessionStore.touch(user, sessionId)
    }
  })

  // DELETE /mcp - End session
  router.delete('/', async (req: Request, res: Response) => {
    const user = getAuthenticatedUser(req)
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const sessionId = req.headers['mcp-session-id'] as string | undefined

    if (!sessionId) {
      res.status(400).json({ error: 'Invalid or missing session ID' })
      return
    }

    let session = sessions.get(sessionId)

    // Try to restore from store if not in memory (so we can properly close it)
    if (!session && sessionStore) {
      session = (await restoreSessionFromStore(user, sessionId)) ?? undefined
    }

    if (!session) {
      res.status(400).json({ error: 'Invalid or missing session ID' })
      return
    }

    if (session.user !== user) {
      res.status(403).json({ error: 'Session belongs to different user' })
      return
    }

    await session.transport.handleRequest(req, res)
    await session.server.close()
    sessions.delete(sessionId)

    // Also delete from store
    if (sessionStore) {
      await sessionStore.delete(user, sessionId)
    }
  })

  return router
}
