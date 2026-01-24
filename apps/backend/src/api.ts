import { json } from 'body-parser'
import cors from 'cors'
import { subHours } from 'date-fns'
import express, { RequestHandler } from 'express'
import { Client } from 'pg'
import { createAuth } from './auth'
import {
  DailyAggregate,
  getActivities,
  getAllSyncStates,
  getLocations,
  getProductivity,
  getDetectedLocations as getStoredDetectedLocations,
  getTags,
  getTimeSeries,
  initializeSchema,
  insertLocation,
  insertPlace,
  insertProductivity,
  loginToUserDb,
  migrateSchema,
  processDailyAggregate,
  processHealthConnectData,
  query,
  resetSyncState,
  schemaInitialized,
} from './db'
import { createMcpRouter } from './mcp'
import { ouraClient } from './oura'
import { syncAllOuraData } from './oura-sync'
import { createOwnTracksRouter } from './owntracks'
import { rescuetimeClient } from './rescuetime'
import { syncRescueTimeData } from './rescuetime-sync'
import { isValidMetric, MetricType, validMetrics } from './schema'
import { clearPendingDetections, triggerDetectionForUser } from './services/detection-trigger'
import { initGeocodeQueue, stopGeocodeQueue } from './services/geocode-queue'
import {
  deleteNamedLocation,
  getDetectedLocations,
  getNamedLocations,
  insertNamedLocation,
  updateNamedLocation,
} from './services/locations'
import { addMetric, addTag } from './services/mutations'
import {
  getDailySummary,
  getPeriodSummary,
  queryActivities,
  queryLocations,
  queryMetrics,
  queryProductivity,
  queryTags,
} from './services/queries'
import { getSettingsResponse, validateAndUpdateSettings } from './services/settings'
import { createSyncProvider } from './services/sync-provider'
import { reduceTimeSeries } from './utils'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: string
    }
  }
}

const main = async () => {
  const unauthorized = Object.assign(new Error('Unauthorized'), { status: 401 })

  const auth = createAuth(process.env.SESSION_SALT ?? '')

  const webHost = process.env.WEB_HOST ?? 'http://localhost:5173'
  const oura = ouraClient(process.env.OURA_CLIENT ?? '', process.env.OURA_SECRET ?? '', webHost)

  // Create sync provider for auto-syncing data before queries
  const syncProvider = createSyncProvider({
    oura,
    rescueTimeKey: process.env.RESCUETIME_KEY,
  })

  const httpd = express()

  const userDb = new Client({ database: 'postgres' })
  await userDb.connect()

  // CORS must come first for preflight requests
  httpd.use(cors({ origin: true }))

  // Mount MCP server BEFORE body-parser (MCP SDK needs raw body)
  httpd.use('/mcp', createMcpRouter(auth, oura, syncProvider))

  httpd.use(json({ limit: '10mb' }))

  httpd.use((req, res, next) => {
    console.log(req.path, req.body)
    next()
  })

  const authMiddleware: RequestHandler = (req, res, next) => {
    try {
      if (typeof req.headers.authorization === 'string') {
        const token = req.headers.authorization.slice('bearer '.length)
        req.user = auth.getUsernameFromToken(token)
        return next()
      }
    } catch {
      return next(unauthorized)
    }
    return next(unauthorized)
  }

  // httpd.post('/v2/signup', async (req, res, next) => {
  //   const { username: user, password } = req.body
  //   if (!user) return next(unauthorized)
  //   await makeNewUserDb(userDb, user, password)
  //   // TODO FIXME
  // })

  httpd.post('/login', async (req, res, next) => {
    const { username: user, password } = req.body
    if (!user) return next(unauthorized)

    // Check if user exists as a PSQL user role
    const userRows = await query(userDb, 'SELECT usename FROM pg_user WHERE usename=$1', [user])
    if (userRows.rowCount === 1) {
      try {
        await loginToUserDb(user, password)
        // Ensure schema is initialized and migrated
        if (!(await schemaInitialized(user))) {
          await initializeSchema(user)
        } else {
          // Run migrations for existing databases
          await migrateSchema(user)
        }
      } catch (err) {
        console.log(err)
        return next(unauthorized)
      }
    } else return next(unauthorized)

    const token = auth.createToken(user)

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ refresh: token, token }))
  })

  httpd.post('/refresh', async (req, res) => {
    const { refresh } = req.body
    res.end(JSON.stringify({ refresh, token: refresh }))
  })

  httpd.post<{ recordType: string }, { success: boolean }>(
    '/sync/:recordType',
    authMiddleware,
    async (req, res) => {
      const { recordType } = req.params
      let { data } = req.body

      if (!Array.isArray(data) && typeof data === 'object' && Object.entries(data).length) {
        data = [data]
      }

      if (!data?.length) {
        console.log('  empty?!')
        return res.json({ success: true })
      }

      const user = req.user!

      // Process each Health Connect record through the new schema
      for (const item of data) {
        await processHealthConnectData(user, recordType, item)
      }

      res.json({ success: true })
    },
  )

  // Daily aggregates endpoint for deduplicated cumulative metrics from Health Connect
  httpd.post('/sync/daily-aggregates', authMiddleware, async (req, res) => {
    const { data } = req.body as { data?: DailyAggregate[] }
    const user = req.user!

    if (!data || !Array.isArray(data) || data.length === 0) {
      return res.json({ success: true })
    }

    for (const aggregate of data) {
      await processDailyAggregate(user, aggregate)
    }

    res.json({ success: true })
  })

  httpd.get('/auth/connectOura', oura.redirectToAuthorize)
  httpd.get('/auth/ouracb', oura.authCb)

  // Oura sync endpoints
  httpd.post('/sync/oura', authMiddleware, async (req, res) => {
    const user = req.user!
    const { fullResync, startDate } = req.body as { fullResync?: boolean; startDate?: string }

    try {
      const results = await syncAllOuraData(user, oura, {
        fullResync,
        startDate: startDate ? new Date(startDate) : undefined,
      })

      res.json({ results, success: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      res.status(500).json({ error: message, success: false })
    }
  })

  httpd.get('/sync/oura/status', authMiddleware, async (req, res) => {
    const user = req.user!

    try {
      const states = await getAllSyncStates(user, 'oura')
      res.json({ states, success: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      res.status(500).json({ error: message, success: false })
    }
  })

  httpd.delete('/sync/oura/state', authMiddleware, async (req, res) => {
    const user = req.user!
    const { dataType } = req.query as { dataType?: string }

    try {
      await resetSyncState(user, 'oura', dataType)
      res.json({ success: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      res.status(500).json({ error: message, success: false })
    }
  })

  // RescueTime sync endpoints
  httpd.post('/sync/rescuetime', authMiddleware, async (req, res) => {
    const user = req.user!
    const { fullResync, startDate } = req.body as { fullResync?: boolean; startDate?: string }
    const rescueTimeKey = process.env.RESCUETIME_KEY

    if (!rescueTimeKey) {
      return res.status(400).json({ error: 'RescueTime API key not configured', success: false })
    }

    try {
      const result = await syncRescueTimeData(user, rescueTimeKey, {
        fullResync,
        startDate: startDate ? new Date(startDate) : undefined,
      })

      res.json({ result, success: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      res.status(500).json({ error: message, success: false })
    }
  })

  httpd.get('/sync/rescuetime/status', authMiddleware, async (req, res) => {
    const user = req.user!

    try {
      const states = await getAllSyncStates(user, 'rescuetime')
      res.json({ states, success: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      res.status(500).json({ error: message, success: false })
    }
  })

  httpd.delete('/sync/rescuetime/state', authMiddleware, async (req, res) => {
    const user = req.user!

    try {
      await resetSyncState(user, 'rescuetime')
      res.json({ success: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      res.status(500).json({ error: message, success: false })
    }
  })

  // OwnTracks data endpoint (protected by Basic Auth using existing user credentials)
  httpd.use(
    '/ownTracks',
    createOwnTracksRouter({
      insertLocation,
      insertPlace,
      loginToUserDb,
      onLocationInserted: triggerDetectionForUser,
    }),
  )

  httpd.get('/dump', async (req, res) => {
    const { username: user } = req.query as { username: string }

    const now = new Date()
    //const start = subHours(now, 26) // TODO: Find yesterday's wakeup time?
    const start = subHours(now, 26 + 24 * 7) // TODO..
    const end = now // addDays(now, 1)

    const { locations, places } = await getLocations(user, start, end)

    const access_token = await oura.getAccessToken(user)

    // Get data from new schema
    const heartRates = reduceTimeSeries(await getTimeSeries(user, 'heart_rate', start, end))
    const sleepSessions = await getActivities(user, 'sleep', start, end)
    const exerciseSessions = await getActivities(user, 'exercise', start, end)
    const tags = await getTags(user, start, end)

    // Get productivity data from storage, falling back to RescueTime API
    let rtData = await getProductivity(user, start, end)
    if (rtData.length === 0 && process.env.RESCUETIME_KEY) {
      const freshData = await rescuetimeClient(process.env.RESCUETIME_KEY).getIntervalData(start, end)
      // Store fetched data for future use
      const productivityRecords = freshData.map((r) => ({
        activity: r.activity,
        category: r.category,
        durationSec: r.duration,
        endTime: r.endTime,
        isMobile: r.mobile,
        productivity: r.productivity,
        source: 'rescuetime' as const,
        startTime: r.startTime,
      }))
      await insertProductivity(user, productivityRecords)
      rtData = productivityRecords
    }

    res.writeHead(200, {
      'Content-Disposition': `attachment; filename="dump-${now.toISOString()}.json"`,
      'Content-Type': 'application/json',
    })
    res.end(
      JSON.stringify({
        dailyCardiovascularAge: await oura.getDailyCardiovascularAge(start, end, access_token),
        dailyReadiness: await oura.getDailyReadiness(start, end, access_token),
        dailyResilience: await oura.getDailyResilience(start, end, access_token),
        dailySleep: await oura.getDailySleep(start, end, access_token),
        exerciseSessions,
        heartRates,
        locations,
        places,
        rtData,
        sessions: await oura.getSessions(start, end, access_token),
        sleepSessions,
        tags,
      }),
    )
  })

  // ==========================================================================
  // REST API - Uses shared service layer with MCP
  // ==========================================================================

  // GET /metrics/:metric - Query time series metrics
  httpd.get('/metrics/:metric', authMiddleware, async (req, res) => {
    const { metric } = req.params
    const { start, end } = req.query as { start?: string; end?: string }
    const user = req.user!

    if (!isValidMetric(metric)) {
      return res.status(400).json({
        error: `Invalid metric "${metric}". Valid metrics are: ${validMetrics.join(', ')}`,
        success: false,
      })
    }

    if (!start || !end) {
      return res.status(400).json({ error: 'Missing required query parameters: start, end', success: false })
    }

    const startDate = new Date(start)
    const endDate = new Date(end)

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date format. Use ISO 8601 format.', success: false })
    }

    const result = await queryMetrics(user, metric, startDate, endDate)
    res.json({ ...result, success: true })
  })

  // GET /daily-summary - Get comprehensive summary for a day
  httpd.get('/daily-summary', authMiddleware, async (req, res) => {
    const { date } = req.query as { date?: string }
    const user = req.user!

    if (!date) {
      return res.status(400).json({ error: 'Missing required query parameter: date', success: false })
    }

    const dateMatch = date.match(/^\d{4}-\d{2}-\d{2}$/)
    if (!dateMatch) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD format.', success: false })
    }

    const dateObj = new Date(date)
    if (isNaN(dateObj.getTime())) {
      return res.status(400).json({ error: 'Invalid date.', success: false })
    }

    const summary = await getDailySummary(user, dateObj, syncProvider)
    res.json({ ...summary, success: true })
  })

  // GET /period-summary - Get aggregated stats for a period
  httpd.get('/period-summary', authMiddleware, async (req, res) => {
    const {
      start,
      end,
      metrics: metricsParam,
    } = req.query as { start?: string; end?: string; metrics?: string }
    const user = req.user!

    if (!start || !end || !metricsParam) {
      return res
        .status(400)
        .json({ error: 'Missing required query parameters: start, end, metrics', success: false })
    }

    const startDate = new Date(start)
    const endDate = new Date(end)

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date format. Use ISO 8601 format.', success: false })
    }

    const metrics = metricsParam.split(',')
    const invalidMetrics = metrics.filter((m) => !isValidMetric(m))
    if (invalidMetrics.length > 0) {
      return res.status(400).json({
        error: `Invalid metrics: ${invalidMetrics.join(', ')}. Valid metrics are: ${validMetrics.join(', ')}`,
        success: false,
      })
    }

    const summary = await getPeriodSummary(user, metrics as MetricType[], startDate, endDate)
    res.json({ ...summary, success: true })
  })

  // GET /tags - Query tags for a time range
  httpd.get('/tags', authMiddleware, async (req, res) => {
    const { start, end } = req.query as { start?: string; end?: string }
    const user = req.user!

    if (!start || !end) {
      return res.status(400).json({ error: 'Missing required query parameters: start, end', success: false })
    }

    const startDate = new Date(start)
    const endDate = new Date(end)

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date format. Use ISO 8601 format.', success: false })
    }

    const tags = await queryTags(user, startDate, endDate, syncProvider)
    res.json({ data: tags, success: true })
  })

  // POST /tags - Add a manual tag
  httpd.post('/tags', authMiddleware, async (req, res) => {
    const { tag, start_time, end_time } = req.body as { tag?: string; start_time?: string; end_time?: string }
    const user = req.user!

    if (!tag || !start_time) {
      return res.status(400).json({ error: 'Missing required fields: tag, start_time', success: false })
    }

    const startDate = new Date(start_time)
    if (isNaN(startDate.getTime())) {
      return res
        .status(400)
        .json({ error: 'Invalid start_time format. Use ISO 8601 format.', success: false })
    }

    let endDate: Date | undefined
    if (end_time) {
      endDate = new Date(end_time)
      if (isNaN(endDate.getTime())) {
        return res
          .status(400)
          .json({ error: 'Invalid end_time format. Use ISO 8601 format.', success: false })
      }
    }

    const result = await addTag(user, { endTime: endDate, startTime: startDate, tag })
    res.json(result)
  })

  // GET /activities - Query activities for a time range
  httpd.get('/activities', authMiddleware, async (req, res) => {
    const { start, end, types: typesParam } = req.query as { start?: string; end?: string; types?: string }
    const user = req.user!

    if (!start || !end) {
      return res.status(400).json({ error: 'Missing required query parameters: start, end', success: false })
    }

    const startDate = new Date(start)
    const endDate = new Date(end)

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date format. Use ISO 8601 format.', success: false })
    }

    const types = (typesParam?.split(',') || ['sleep', 'exercise', 'meditation']) as (
      | 'sleep'
      | 'exercise'
      | 'meditation'
      | 'nap'
    )[]

    const activities = await queryActivities(user, types, startDate, endDate, syncProvider)
    res.json({ data: activities, success: true })
  })

  // GET /productivity - Query productivity data for a time range
  httpd.get('/productivity', authMiddleware, async (req, res) => {
    const { start, end } = req.query as { start?: string; end?: string }
    const user = req.user!

    if (!start || !end) {
      return res.status(400).json({ error: 'Missing required query parameters: start, end', success: false })
    }

    const startDate = new Date(start)
    const endDate = new Date(end)

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date format. Use ISO 8601 format.', success: false })
    }

    const productivity = await queryProductivity(user, startDate, endDate, syncProvider)
    res.json({ data: productivity, success: true })
  })

  // GET /locations - Query location data for a time range
  httpd.get('/locations', authMiddleware, async (req, res) => {
    const { start, end } = req.query as { start?: string; end?: string }
    const user = req.user!

    if (!start || !end) {
      return res.status(400).json({ error: 'Missing required query parameters: start, end', success: false })
    }

    const startDate = new Date(start)
    const endDate = new Date(end)

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date format. Use ISO 8601 format.', success: false })
    }

    const places = await queryLocations(user, startDate, endDate)
    res.json({ data: places, success: true })
  })

  // ==========================================================================
  // Named Locations API
  // ==========================================================================

  // GET /locations/named - List all named locations
  httpd.get('/locations/named', authMiddleware, async (req, res) => {
    const locations = await getNamedLocations(req.user!)
    res.json({ data: locations, success: true })
  })

  // POST /locations/named - Create a named location
  httpd.post('/locations/named', authMiddleware, async (req, res) => {
    const { name, lat, lon, radius } = req.body as {
      name?: string
      lat?: number
      lon?: number
      radius?: number
    }
    const user = req.user!

    if (!name || lat === undefined || lon === undefined) {
      return res.status(400).json({ error: 'Missing required fields: name, lat, lon', success: false })
    }

    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return res.status(400).json({ error: 'lat and lon must be numbers', success: false })
    }

    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return res.status(400).json({ error: 'Invalid coordinates', success: false })
    }

    const location = await insertNamedLocation(user, { lat, lon, name, radius })
    res.json({ data: location, success: true })
  })

  // PATCH /locations/named/:id - Update a named location
  httpd.patch('/locations/named/:id', authMiddleware, async (req, res) => {
    const { id } = req.params
    const { name, lat, lon, radius } = req.body as {
      name?: string
      lat?: number
      lon?: number
      radius?: number
    }
    const user = req.user!

    if (lat !== undefined && lon === undefined) {
      return res.status(400).json({ error: 'lat and lon must be updated together', success: false })
    }
    if (lon !== undefined && lat === undefined) {
      return res.status(400).json({ error: 'lat and lon must be updated together', success: false })
    }

    if (lat !== undefined && (lat < -90 || lat > 90)) {
      return res.status(400).json({ error: 'Invalid latitude', success: false })
    }
    if (lon !== undefined && (lon < -180 || lon > 180)) {
      return res.status(400).json({ error: 'Invalid longitude', success: false })
    }

    const location = await updateNamedLocation(user, id, { lat, lon, name, radius })
    if (!location) {
      return res.status(404).json({ error: 'Named location not found', success: false })
    }
    res.json({ data: location, success: true })
  })

  // DELETE /locations/named/:id - Delete a named location
  httpd.delete('/locations/named/:id', authMiddleware, async (req, res) => {
    const { id } = req.params
    const deleted = await deleteNamedLocation(req.user!, id)
    if (!deleted) {
      return res.status(404).json({ error: 'Named location not found', success: false })
    }
    res.json({ success: true })
  })

  // GET /locations/detected - Get computed detected location clusters (on-demand analysis)
  httpd.get('/locations/detected', authMiddleware, async (req, res) => {
    const { start, end, minDuration } = req.query as { start?: string; end?: string; minDuration?: string }
    const user = req.user!

    if (!start || !end) {
      return res.status(400).json({ error: 'Missing required query parameters: start, end', success: false })
    }

    const startDate = new Date(start)
    const endDate = new Date(end)

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date format. Use ISO 8601 format.', success: false })
    }

    const minDurationMinutes = minDuration ? parseInt(minDuration, 10) : undefined
    if (minDuration && (isNaN(minDurationMinutes!) || minDurationMinutes! <= 0)) {
      return res.status(400).json({ error: 'minDuration must be a positive number', success: false })
    }

    const detected = await getDetectedLocations(user, {
      end: endDate,
      minDurationMinutes,
      start: startDate,
    })
    res.json({ data: detected, success: true })
  })

  // GET /locations/detected/stored - Get stored detected locations with addresses
  httpd.get('/locations/detected/stored', authMiddleware, async (req, res) => {
    const user = req.user!
    const detected = await getStoredDetectedLocations(user)
    res.json({ data: detected, success: true })
  })

  // POST /locations/detected/promote - Promote detected location to named
  httpd.post('/locations/detected/promote', authMiddleware, async (req, res) => {
    const { lat, lon, name, radius } = req.body as {
      lat?: number
      lon?: number
      name?: string
      radius?: number
    }
    const user = req.user!

    if (!name || lat === undefined || lon === undefined) {
      return res.status(400).json({ error: 'Missing required fields: name, lat, lon', success: false })
    }

    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return res.status(400).json({ error: 'lat and lon must be numbers', success: false })
    }

    const location = await insertNamedLocation(user, { lat, lon, name, radius })
    res.json({ data: location, success: true })
  })

  // POST /metrics - Add a manual metric measurement
  httpd.post('/metrics', authMiddleware, async (req, res) => {
    const { metric, value, time } = req.body as { metric?: string; value?: number; time?: string }
    const user = req.user!

    if (!metric || value === undefined) {
      return res.status(400).json({ error: 'Missing required fields: metric, value', success: false })
    }

    if (!isValidMetric(metric)) {
      return res.status(400).json({
        error: `Invalid metric "${metric}". Valid metrics are: ${validMetrics.join(', ')}`,
        success: false,
      })
    }

    const measurementTime = time ? new Date(time) : new Date()
    if (isNaN(measurementTime.getTime())) {
      return res.status(400).json({ error: 'Invalid time format. Use ISO 8601 format.', success: false })
    }

    const result = await addMetric(user, { metric, time: measurementTime, value })
    res.json(result)
  })

  // GET /user/settings - Get user settings with effective HR zones
  httpd.get('/user/settings', authMiddleware, async (req, res) => {
    const result = await getSettingsResponse(req.user!)
    res.json(result)
  })

  // PATCH /user/settings - Update user settings
  httpd.patch('/user/settings', authMiddleware, async (req, res) => {
    const result = await validateAndUpdateSettings(req.user!, req.body)
    if (!result.success) {
      return res.status(400).json(result)
    }
    res.json(result)
  })

  // Initialize geocode queue (if GEOCODE_DB_URL is configured)
  await initGeocodeQueue()

  const port = Number(process.env.PORT ?? 80)
  const server = httpd.listen(port, () => {
    console.log(`> Running on localhost:${port}`)
  })

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...')
    clearPendingDetections()
    await stopGeocodeQueue()
    server.close()
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main()
