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
import { addMetric, addTag, deleteTag } from './services/mutations'
import { getDailySummary, getPeriodSummary, queryMetrics, SyncProvider } from './services/queries'

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
        const rescueTimeKey = process.env.RESCUETIME_KEY
        if (!rescueTimeKey) {
          return {
            content: [
              { text: 'RescueTime API key is not configured on this server.', type: 'text' as const },
            ],
          }
        }

        try {
          const result = await syncRescueTimeData(user, rescueTimeKey, {
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
