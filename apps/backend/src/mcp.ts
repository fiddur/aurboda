import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { randomUUID } from 'crypto'
import { Request, Response, Router } from 'express'
import { z } from 'zod'
import { Auth } from './auth'
import { getAllSyncStates } from './db'
import { ouraClient } from './oura'
import { syncAllOuraData } from './oura-sync'
import { syncRescueTimeData } from './rescuetime-sync'
import { isValidMetric, MetricType, validMetrics } from './schema'
import {
  deleteNamedLocation,
  getDetectedLocations,
  getNamedLocations,
  insertNamedLocation,
  updateNamedLocation,
} from './services/locations'
import { addMetric, addTag, deleteTag } from './services/mutations'
import { getDailySummary, getPeriodSummary, queryMetrics, SyncProvider } from './services/queries'
import { getSettings, getSettingsResponse, validateAndUpdateSettings } from './services/settings'

interface McpSession {
  transport: StreamableHTTPServerTransport
  server: McpServer
  user: string
}

type OuraClientType = ReturnType<typeof ouraClient>

export function createMcpRouter(auth: Auth, oura?: OuraClientType, sync?: SyncProvider): Router {
  const router = Router()
  const sessions = new Map<string, McpSession>()

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

  const createMcpServer = (user: string): McpServer => {
    const server = new McpServer({
      name: 'aurboda',
      version: '1.0.0',
    })

    // Tool 1: query_metrics
    server.tool(
      'query_metrics',
      'Query health metrics for a time range. Returns time series data with timestamps and values.',
      {
        end: z.string().describe('End date/time in ISO 8601 format (e.g., 2024-01-15T23:59:59Z)'),
        metric: z.string().describe(`Metric name. Valid metrics: ${validMetrics.join(', ')}`),
        start: z.string().describe('Start date/time in ISO 8601 format (e.g., 2024-01-15T00:00:00Z)'),
      },
      async ({ end, metric, start }) => {
        if (!isValidMetric(metric)) {
          return {
            content: [
              {
                text: `Invalid metric "${metric}". Valid metrics are: ${validMetrics.join(', ')}`,
                type: 'text' as const,
              },
            ],
          }
        }

        const startDate = new Date(start)
        const endDate = new Date(end)

        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          return {
            content: [{ text: 'Invalid date format. Use ISO 8601 format.', type: 'text' as const }],
          }
        }

        const result = await queryMetrics(user, metric, startDate, endDate)

        return {
          content: [{ text: JSON.stringify(result, null, 2), type: 'text' as const }],
        }
      },
    )

    // Tool 2: get_daily_summary
    server.tool(
      'get_daily_summary',
      'Get a comprehensive summary of health data for a specific day including heart rate, steps, sleep, exercise, tags, productivity, and visited places. Also includes Oura scores (sleep_score, readiness_score, resilience_score, cardiovascular_age) when available.',
      {
        date: z.string().describe('Date in YYYY-MM-DD format (e.g., 2024-01-15)'),
      },
      async ({ date }) => {
        const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
        if (!dateMatch) {
          return {
            content: [{ text: 'Invalid date format. Use YYYY-MM-DD format.', type: 'text' as const }],
          }
        }

        const dateObj = new Date(date)
        if (isNaN(dateObj.getTime())) {
          return {
            content: [{ text: 'Invalid date.', type: 'text' as const }],
          }
        }

        const summary = await getDailySummary(user, dateObj, sync)

        return {
          content: [{ text: JSON.stringify(summary, null, 2), type: 'text' as const }],
        }
      },
    )

    // Tool 3: add_tag
    server.tool(
      'add_tag',
      'Add a manual tag/label to mark an activity or event. Tags can have a start time and optional end time.',
      {
        end_time: z
          .string()
          .optional()
          .describe('Optional end time in ISO 8601 format. Omit for point-in-time tags.'),
        start_time: z.string().describe('Start time in ISO 8601 format (e.g., 2024-01-15T14:30:00Z)'),
        tag: z.string().describe('The tag/label text (e.g., "coffee", "meditation", "headache")'),
      },
      async ({ end_time, start_time, tag }) => {
        const startDate = new Date(start_time)
        if (isNaN(startDate.getTime())) {
          return {
            content: [{ text: 'Invalid start_time format. Use ISO 8601 format.', type: 'text' as const }],
          }
        }

        let endDate: Date | undefined
        if (end_time) {
          endDate = new Date(end_time)
          if (isNaN(endDate.getTime())) {
            return {
              content: [{ text: 'Invalid end_time format. Use ISO 8601 format.', type: 'text' as const }],
            }
          }
        }

        const result = await addTag(user, { endTime: endDate, startTime: startDate, tag })

        return {
          content: [{ text: JSON.stringify(result, null, 2), type: 'text' as const }],
        }
      },
    )

    // Tool 4: delete_tag
    server.tool(
      'delete_tag',
      'Delete a tag by its external ID. Returns success if the tag was found and deleted.',
      {
        external_id: z.string().describe('The external ID of the tag to delete'),
      },
      async ({ external_id }) => {
        const result = await deleteTag(user, external_id)

        return {
          content: [{ text: JSON.stringify(result, null, 2), type: 'text' as const }],
        }
      },
    )

    // Tool 5: add_metric
    server.tool(
      'add_metric',
      'Add a manual health metric measurement. Use this to log data not captured automatically.',
      {
        metric: z.string().describe(`Metric name. Valid metrics: ${validMetrics.join(', ')}`),
        time: z
          .string()
          .optional()
          .describe('Measurement time in ISO 8601 format. Defaults to current time if omitted.'),
        value: z.number().describe('The metric value (e.g., 72 for heart rate, 75.5 for weight)'),
      },
      async ({ metric, time, value }) => {
        if (!isValidMetric(metric)) {
          return {
            content: [
              {
                text: `Invalid metric "${metric}". Valid metrics are: ${validMetrics.join(', ')}`,
                type: 'text' as const,
              },
            ],
          }
        }

        const measurementTime = time ? new Date(time) : new Date()
        if (isNaN(measurementTime.getTime())) {
          return {
            content: [{ text: 'Invalid time format. Use ISO 8601 format.', type: 'text' as const }],
          }
        }

        const result = await addMetric(user, { metric, time: measurementTime, value })

        return {
          content: [{ text: JSON.stringify(result, null, 2), type: 'text' as const }],
        }
      },
    )

    // Tool 5: sync_oura
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
          return {
            content: [{ text: 'Oura integration is not configured on this server.', type: 'text' as const }],
          }
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

          return {
            content: [
              {
                text: JSON.stringify({ results: summary, success: true }, null, 2),
                type: 'text' as const,
              },
            ],
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          return {
            content: [
              { text: JSON.stringify({ error: message, success: false }, null, 2), type: 'text' as const },
            ],
          }
        }
      },
    )

    // Tool 6: sync_rescuetime
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
          return {
            content: [
              { text: 'RescueTime API key is not configured in user settings.', type: 'text' as const },
            ],
          }
        }

        try {
          const result = await syncRescueTimeData(user, settings.rescueTimeKey, {
            fullResync: full_resync,
            startDate: start_date ? new Date(start_date) : undefined,
          })

          return {
            content: [
              {
                text: JSON.stringify(
                  {
                    error: result.error,
                    recordsProcessed: result.recordsProcessed,
                    status: result.status,
                    success: result.status === 'success',
                  },
                  null,
                  2,
                ),
                type: 'text' as const,
              },
            ],
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          return {
            content: [
              { text: JSON.stringify({ error: message, success: false }, null, 2), type: 'text' as const },
            ],
          }
        }
      },
    )

    // Tool 7: get_sync_status
    server.tool(
      'get_sync_status',
      'Get the current sync status for Oura and RescueTime data sources. Shows last sync time, status, and any errors.',
      {
        provider: z
          .enum(['oura', 'rescuetime', 'all'])
          .optional()
          .describe('Which provider to check. Defaults to "all".'),
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

          return {
            content: [{ text: JSON.stringify({ states, success: true }, null, 2), type: 'text' as const }],
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          return {
            content: [
              { text: JSON.stringify({ error: message, success: false }, null, 2), type: 'text' as const },
            ],
          }
        }
      },
    )

    // Tool 8: query_period_summary
    server.tool(
      'query_period_summary',
      'Get aggregated statistics for a time period. Returns min/max/avg/stddev for each metric, trend compared to previous period, and data completeness.',
      {
        end: z.string().describe('End date/time in ISO 8601 format (e.g., 2024-01-31T23:59:59Z)'),
        metrics: z
          .array(z.string())
          .describe(`Metrics to include. Valid metrics: ${validMetrics.join(', ')}`),
        start: z.string().describe('Start date/time in ISO 8601 format (e.g., 2024-01-01T00:00:00Z)'),
      },
      async ({ end, metrics, start }) => {
        // Validate dates
        const startDate = new Date(start)
        const endDate = new Date(end)

        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          return {
            content: [{ text: 'Invalid date format. Use ISO 8601 format.', type: 'text' as const }],
          }
        }

        // Validate metrics
        const invalidMetrics = metrics.filter((m) => !isValidMetric(m))
        if (invalidMetrics.length > 0) {
          return {
            content: [
              {
                text: `Invalid metrics: ${invalidMetrics.join(', ')}. Valid metrics are: ${validMetrics.join(', ')}`,
                type: 'text' as const,
              },
            ],
          }
        }

        const validatedMetrics = metrics as MetricType[]
        const summary = await getPeriodSummary(user, validatedMetrics, startDate, endDate)

        return {
          content: [{ text: JSON.stringify(summary, null, 2), type: 'text' as const }],
        }
      },
    )

    // Tool 9: get_user_settings
    server.tool(
      'get_user_settings',
      'Get user settings including birth date and effective HR zones. HR zones are used to calculate time spent in different heart rate zones during exercise.',
      {},
      async () => {
        const result = await getSettingsResponse(user)
        return {
          content: [{ text: JSON.stringify(result, null, 2), type: 'text' as const }],
        }
      },
    )

    // Tool 10: update_user_settings
    server.tool(
      'update_user_settings',
      'Update user settings. Can set birth date (for age-based HR zones) and/or custom HR zone thresholds.',
      {
        birth_date: z
          .string()
          .nullable()
          .optional()
          .describe('Birth date in YYYY-MM-DD format. Set to null to clear.'),
        hr_zone_start: z
          .object({
            1: z.number().describe('Zone 1 threshold (bpm)'),
            2: z.number().describe('Zone 2 threshold (bpm)'),
            3: z.number().describe('Zone 3 threshold (bpm)'),
            4: z.number().describe('Zone 4 threshold (bpm)'),
            5: z.number().describe('Zone 5 threshold (bpm)'),
          })
          .nullable()
          .optional()
          .describe('Custom HR zone start thresholds. Values must be ascending. Set to null to clear.'),
      },
      async ({ birth_date, hr_zone_start }) => {
        // Transform snake_case MCP params to camelCase for service
        const result = await validateAndUpdateSettings(user, {
          birthDate: birth_date,
          hrZoneStart: hr_zone_start,
        })
        return {
          content: [{ text: JSON.stringify(result, null, 2), type: 'text' as const }],
        }
      },
    )

    // Tool 11: get_named_locations
    server.tool(
      'get_named_locations',
      'List all named locations. These are user-defined places with names and coordinates.',
      {},
      async () => {
        const locations = await getNamedLocations(user)
        return {
          content: [
            { text: JSON.stringify({ data: locations, success: true }, null, 2), type: 'text' as const },
          ],
        }
      },
    )

    // Tool 12: get_detected_locations
    server.tool(
      'get_detected_locations',
      'Get frequently visited locations that are not yet named. Detects places where user spent 60+ minutes. Returns coordinates, visit count, and total time spent.',
      {
        end: z.string().describe('End date/time in ISO 8601 format (e.g., 2024-01-31T23:59:59Z)'),
        min_duration: z.number().optional().describe('Minimum stay duration in minutes. Defaults to 60.'),
        start: z.string().describe('Start date/time in ISO 8601 format (e.g., 2024-01-01T00:00:00Z)'),
      },
      async ({ end, min_duration, start }) => {
        const startDate = new Date(start)
        const endDate = new Date(end)

        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          return {
            content: [{ text: 'Invalid date format. Use ISO 8601 format.', type: 'text' as const }],
          }
        }

        const detected = await getDetectedLocations(user, {
          end: endDate,
          minDurationMinutes: min_duration,
          start: startDate,
        })

        return {
          content: [
            { text: JSON.stringify({ data: detected, success: true }, null, 2), type: 'text' as const },
          ],
        }
      },
    )

    // Tool 13: add_named_location
    server.tool(
      'add_named_location',
      'Create a named location. Use this to save a frequently visited place with a name.',
      {
        lat: z.number().describe('Latitude of the location (-90 to 90)'),
        lon: z.number().describe('Longitude of the location (-180 to 180)'),
        name: z.string().describe('Name for the location (e.g., "Home", "Office", "Gym")'),
        radius: z.number().optional().describe('Radius in meters. Defaults to 200.'),
      },
      async ({ lat, lon, name, radius }) => {
        if (lat < -90 || lat > 90) {
          return {
            content: [{ text: 'Invalid latitude. Must be between -90 and 90.', type: 'text' as const }],
          }
        }
        if (lon < -180 || lon > 180) {
          return {
            content: [{ text: 'Invalid longitude. Must be between -180 and 180.', type: 'text' as const }],
          }
        }

        const location = await insertNamedLocation(user, { lat, lon, name, radius })
        return {
          content: [
            { text: JSON.stringify({ data: location, success: true }, null, 2), type: 'text' as const },
          ],
        }
      },
    )

    // Tool 14: update_named_location
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
          return {
            content: [{ text: 'lat and lon must be provided together.', type: 'text' as const }],
          }
        }

        if (lat !== undefined && (lat < -90 || lat > 90)) {
          return {
            content: [{ text: 'Invalid latitude. Must be between -90 and 90.', type: 'text' as const }],
          }
        }
        if (lon !== undefined && (lon < -180 || lon > 180)) {
          return {
            content: [{ text: 'Invalid longitude. Must be between -180 and 180.', type: 'text' as const }],
          }
        }

        const location = await updateNamedLocation(user, id, { lat, lon, name, radius })
        if (!location) {
          return {
            content: [
              {
                text: JSON.stringify({ error: 'Named location not found', success: false }, null, 2),
                type: 'text' as const,
              },
            ],
          }
        }
        return {
          content: [
            { text: JSON.stringify({ data: location, success: true }, null, 2), type: 'text' as const },
          ],
        }
      },
    )

    // Tool 15: delete_named_location
    server.tool(
      'delete_named_location',
      'Delete a named location by its ID.',
      {
        id: z.string().describe('The ID of the named location to delete'),
      },
      async ({ id }) => {
        const deleted = await deleteNamedLocation(user, id)
        if (!deleted) {
          return {
            content: [
              {
                text: JSON.stringify({ error: 'Named location not found', success: false }, null, 2),
                type: 'text' as const,
              },
            ],
          }
        }
        return {
          content: [{ text: JSON.stringify({ success: true }, null, 2), type: 'text' as const }],
        }
      },
    )

    // Tool 16: promote_detected_location
    server.tool(
      'promote_detected_location',
      'Create a named location from detected coordinates. Use after get_detected_locations to save a frequently visited place.',
      {
        lat: z.number().describe('Latitude from detected location'),
        lon: z.number().describe('Longitude from detected location'),
        name: z.string().describe('Name for the location'),
        radius: z.number().optional().describe('Radius in meters. Uses suggested radius if not provided.'),
      },
      async ({ lat, lon, name, radius }) => {
        const location = await insertNamedLocation(user, { lat, lon, name, radius })
        return {
          content: [
            { text: JSON.stringify({ data: location, success: true }, null, 2), type: 'text' as const },
          ],
        }
      },
    )

    return server
  }

  // POST /mcp - Handle JSON-RPC requests
  router.post('/', async (req: Request, res: Response) => {
    const user = getAuthenticatedUser(req)
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const sessionId = req.headers['mcp-session-id'] as string | undefined

    let session: McpSession

    if (sessionId && sessions.has(sessionId)) {
      session = sessions.get(sessionId)!
      if (session.user !== user) {
        res.status(403).json({ error: 'Session belongs to different user' })
        return
      }
    } else {
      // Create new session - generate ID first so transport and our map use the same one
      const newSessionId = randomUUID()
      const server = createMcpServer(user)
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
      })

      await server.connect(transport)

      session = { server, transport, user }
      sessions.set(newSessionId, session)
      // Don't set header - transport.handleRequest will set it
    }

    await session.transport.handleRequest(req, res)
  })

  // GET /mcp - SSE stream for server notifications
  router.get('/', async (req: Request, res: Response) => {
    const user = getAuthenticatedUser(req)
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const sessionId = req.headers['mcp-session-id'] as string | undefined

    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).json({ error: 'Invalid or missing session ID' })
      return
    }

    const session = sessions.get(sessionId)!
    if (session.user !== user) {
      res.status(403).json({ error: 'Session belongs to different user' })
      return
    }

    await session.transport.handleRequest(req, res)
  })

  // DELETE /mcp - End session
  router.delete('/', async (req: Request, res: Response) => {
    const user = getAuthenticatedUser(req)
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const sessionId = req.headers['mcp-session-id'] as string | undefined

    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).json({ error: 'Invalid or missing session ID' })
      return
    }

    const session = sessions.get(sessionId)!
    if (session.user !== user) {
      res.status(403).json({ error: 'Session belongs to different user' })
      return
    }

    await session.transport.handleRequest(req, res)
    await session.server.close()
    sessions.delete(sessionId)
  })

  return router
}
