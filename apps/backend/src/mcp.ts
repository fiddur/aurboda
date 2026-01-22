import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { randomUUID } from 'crypto'
import { Request, Response, Router } from 'express'
import { z } from 'zod'
import { Auth } from './auth'
import {
  getActivities,
  getAllSyncStates,
  getDailyAggregates,
  getLocations,
  getProductivity,
  getTags,
  getTimeSeries,
  getTimeSeriesStats,
  insertTag,
  insertTimeSeries,
} from './db'
import { ouraClient } from './oura'
import { syncAllOuraData } from './oura-sync'
import { syncRescueTimeData } from './rescuetime-sync'
import { MetricType, metricUnits } from './schema'

const validMetrics: MetricType[] = [
  'heart_rate',
  'resting_heart_rate',
  'hrv_rmssd',
  'weight',
  'body_fat',
  'bone_mass',
  'lean_body_mass',
  'body_water_mass',
  'height',
  'steps',
  'distance',
  'floors_climbed',
  'calories_active',
  'calories_total',
  'calories_basal',
  'spo2',
  'respiratory_rate',
  'body_temperature',
  'basal_body_temperature',
  'blood_glucose',
  'blood_pressure_systolic',
  'blood_pressure_diastolic',
  'vo2_max',
  'readiness_score',
  'resilience_score',
  'productivity_score',
  'cardiovascular_age',
  'sleep_score',
]

function isValidMetric(metric: string): metric is MetricType {
  return validMetrics.includes(metric as MetricType)
}

interface McpSession {
  transport: StreamableHTTPServerTransport
  server: McpServer
  user: string
}

type OuraClientType = ReturnType<typeof ouraClient>

export function createMcpRouter(auth: Auth, oura?: OuraClientType): Router {
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

        const data = await getTimeSeries(user, metric, startDate, endDate)
        const unit = metricUnits[metric]

        return {
          content: [
            {
              text: JSON.stringify(
                {
                  count: data.length,
                  data: data.map(([time, value]) => ({ time: time.toISOString(), value })),
                  metric,
                  unit,
                },
                null,
                2,
              ),
              type: 'text' as const,
            },
          ],
        }
      },
    )

    // Tool 2: get_daily_summary
    server.tool(
      'get_daily_summary',
      'Get a comprehensive summary of health data for a specific day including heart rate, steps, sleep, exercise, tags, productivity, and visited places.',
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

        const start = new Date(`${date}T00:00:00`)
        const end = new Date(`${date}T23:59:59.999`)

        // Run queries in parallel
        const [heartRateData, stepsData, sleepSessions, exerciseSessions, tags, productivity, locations] =
          await Promise.all([
            getTimeSeries(user, 'heart_rate', start, end),
            getTimeSeries(user, 'steps', start, end),
            getActivities(user, 'sleep', start, end),
            getActivities(user, 'exercise', start, end),
            getTags(user, start, end),
            getProductivity(user, start, end),
            getLocations(user, start, end),
          ])

        // Calculate heart rate stats
        const heartRates = heartRateData.map(([, value]) => value)
        const heartRateStats =
          heartRates.length > 0 ?
            {
              avg: Math.round(heartRates.reduce((a, b) => a + b, 0) / heartRates.length),
              count: heartRates.length,
              max: Math.max(...heartRates),
              min: Math.min(...heartRates),
            }
          : null

        // Sum steps
        const totalSteps = stepsData.reduce((sum, [, value]) => sum + value, 0)

        // Calculate productivity summary
        const productivitySummary = productivity.reduce(
          (acc, record) => {
            acc.totalDurationSec += record.durationSec
            if (record.productivity !== undefined && record.productivity !== null) {
              if (record.productivity >= 1) acc.productiveSec += record.durationSec
              if (record.productivity >= 2) acc.veryProductiveSec += record.durationSec
              if (record.productivity <= -1) acc.distractingSec += record.durationSec
            }
            return acc
          },
          { distractingSec: 0, productiveSec: 0, totalDurationSec: 0, veryProductiveSec: 0 },
        )

        const summary = {
          date,
          exerciseSessions: exerciseSessions.map((s) => ({
            data: s.data,
            duration:
              s.endTime ? Math.round((s.endTime.getTime() - s.startTime.getTime()) / 1000 / 60) : null,
            endTime: s.endTime?.toISOString(),
            startTime: s.startTime.toISOString(),
            title: s.title,
          })),
          heartRate: heartRateStats,
          places: locations.places.map((p) => ({
            duration: Math.round((p.endTime.getTime() - p.startTime.getTime()) / 1000 / 60),
            endTime: p.endTime.toISOString(),
            region: p.region,
            startTime: p.startTime.toISOString(),
          })),
          productivity: productivity.length > 0 ? productivitySummary : null,
          sleepSessions: sleepSessions.map((s) => ({
            data: s.data,
            duration:
              s.endTime ? Math.round((s.endTime.getTime() - s.startTime.getTime()) / 1000 / 60) : null,
            endTime: s.endTime?.toISOString(),
            startTime: s.startTime.toISOString(),
          })),
          steps: { total: totalSteps },
          tags: tags.map((t) => ({
            endTime: t.endTime?.toISOString(),
            startTime: t.startTime.toISOString(),
            tag: t.tag,
          })),
        }

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

        const externalId = randomUUID()
        await insertTag(user, {
          endTime: endDate,
          externalId,
          source: 'manual',
          startTime: startDate,
          tag,
        })

        return {
          content: [
            {
              text: JSON.stringify(
                {
                  endTime: endDate?.toISOString(),
                  id: externalId,
                  startTime: startDate.toISOString(),
                  success: true,
                  tag,
                },
                null,
                2,
              ),
              type: 'text' as const,
            },
          ],
        }
      },
    )

    // Tool 4: add_metric
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

        await insertTimeSeries(user, [
          {
            metric,
            source: 'manual',
            time: measurementTime,
            value,
          },
        ])

        const unit = metricUnits[metric]

        return {
          content: [
            {
              text: JSON.stringify(
                {
                  metric,
                  success: true,
                  time: measurementTime.toISOString(),
                  unit,
                  value,
                },
                null,
                2,
              ),
              type: 'text' as const,
            },
          ],
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

        // Calculate period length for previous period comparison
        const periodMs = endDate.getTime() - startDate.getTime()
        const prevStart = new Date(startDate.getTime() - periodMs)
        const prevEnd = new Date(startDate.getTime() - 1) // Just before current period starts

        // Fetch current and previous period stats in parallel
        const [currentStats, previousStats, dailyAggregates] = await Promise.all([
          getTimeSeriesStats(user, validatedMetrics, startDate, endDate),
          getTimeSeriesStats(user, validatedMetrics, prevStart, prevEnd),
          getDailyAggregates(user, validatedMetrics, startDate, endDate),
        ])

        // Calculate days in period for completeness calculation
        const daysInPeriod = Math.ceil(periodMs / (1000 * 60 * 60 * 24))

        // Build response with trends and completeness
        const metricsWithTrends = currentStats.map((stat) => {
          const prevStat = previousStats.find((p) => p.metric === stat.metric)
          const dailyData = dailyAggregates.filter((d) => d.metric === stat.metric)

          // Calculate trend using linear regression on daily averages
          let trend: number | null = null
          if (dailyData.length >= 2) {
            const n = dailyData.length
            const xMean = (n - 1) / 2
            const yMean = dailyData.reduce((sum, d) => sum + d.avg, 0) / n
            let numerator = 0
            let denominator = 0
            for (let i = 0; i < n; i++) {
              numerator += (i - xMean) * (dailyData[i].avg - yMean)
              denominator += (i - xMean) ** 2
            }
            if (denominator !== 0) {
              trend = numerator / denominator
            }
          }

          // Calculate change from previous period
          let changeFromPrevious: number | null = null
          if (prevStat && prevStat.avg !== 0) {
            changeFromPrevious = ((stat.avg - prevStat.avg) / prevStat.avg) * 100
          }

          // Calculate data completeness (days with data / total days)
          const daysWithData = dailyData.length
          const completeness = Math.round((daysWithData / daysInPeriod) * 100)

          // Identify outliers (values more than 2 stddev from mean)
          const outlierThreshold = stat.stddev * 2
          const outliers: { type: 'high' | 'low'; value: number }[] = []
          if (stat.stddev > 0) {
            if (stat.max > stat.avg + outlierThreshold) {
              outliers.push({ type: 'high', value: stat.max })
            }
            if (stat.min < stat.avg - outlierThreshold) {
              outliers.push({ type: 'low', value: stat.min })
            }
          }

          return {
            avg: Math.round(stat.avg * 100) / 100,
            changeFromPreviousPeriodPercent:
              changeFromPrevious !== null ? Math.round(changeFromPrevious * 10) / 10 : null,
            completenessPercent: completeness,
            count: stat.count,
            max: Math.round(stat.max * 100) / 100,
            metric: stat.metric,
            min: Math.round(stat.min * 100) / 100,
            outliers: outliers.length > 0 ? outliers : undefined,
            stddev: Math.round(stat.stddev * 100) / 100,
            trendPerDay: trend !== null ? Math.round(trend * 1000) / 1000 : null,
            unit: stat.unit,
          }
        })

        // Add metrics with no data in current period
        const missingMetrics = validatedMetrics.filter((m) => !currentStats.some((s) => s.metric === m))
        for (const metric of missingMetrics) {
          metricsWithTrends.push({
            avg: 0,
            changeFromPreviousPeriodPercent: null,
            completenessPercent: 0,
            count: 0,
            max: 0,
            metric,
            min: 0,
            outliers: undefined,
            stddev: 0,
            trendPerDay: null,
            unit: metricUnits[metric],
          })
        }

        const summary = {
          end: endDate.toISOString(),
          metrics: metricsWithTrends,
          periodDays: daysInPeriod,
          start: startDate.toISOString(),
        }

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
