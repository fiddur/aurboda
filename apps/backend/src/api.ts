import { json } from 'body-parser'
import cors from 'cors'
import { subHours } from 'date-fns'
import express, { RequestHandler } from 'express'
import { Client } from 'pg'
import { createAuth } from './auth'
import {
  getActivities,
  getAllSyncStates,
  getLocations,
  getProductivity,
  getTags,
  getTimeSeries,
  initializeSchema,
  insertLocation,
  insertPlace,
  insertProductivity,
  loginToUserDb,
  migrateSchema,
  processHealthConnectData,
  query,
  resetSyncState,
  schemaInitialized,
} from './db'
import { createMcpRouter } from './mcp'
import { ouraClient } from './oura'
import { syncAllOuraData } from './oura-sync'
import { rescuetimeClient } from './rescuetime'
import { ActivityType } from './schema'
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

  const httpd = express()

  const userDb = new Client({ database: 'postgres' })
  await userDb.connect()

  // CORS must come first for preflight requests
  httpd.use(cors({ origin: true }))

  // Mount MCP server BEFORE body-parser (MCP SDK needs raw body)
  httpd.use('/mcp', createMcpRouter(auth))

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

  // httpd.post('/api/v2/signup', async (req, res, next) => {
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

  httpd.post('/ownTracks', async (req, res) => {
    const { topic, _type: type } = req.body

    const user = topic.split('/')[1]

    if (type === 'status') {
      // Status messages are informational, no storage needed
    } else if (type === 'waypoint') {
      const { lat, lon, desc, rad, rid } = req.body
      await insertPlace(user, {
        externalId: rid,
        lat,
        lon,
        name: desc,
        radius: rad,
        source: 'owntracks',
      })
    } else if (type === 'location') {
      const { lat, lon, tst, inregions, acc, alt, vel } = req.body
      await insertLocation(user, {
        accuracy: acc,
        altitude: alt,
        lat,
        lon,
        regions: inregions,
        source: 'owntracks',
        time: new Date(tst * 1000),
        velocity: vel,
      })
    }

    res.end(`[]`)
  })

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

  httpd.get('/heartrate', authMiddleware, async (req, res) => {
    const start = new Date(req.query.start as string)
    const end = new Date(req.query.end as string)
    const user = req.user!

    const hrs = await getTimeSeries(user, 'heart_rate', start, end)

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(hrs))
  })

  httpd.get('/tags', authMiddleware, async (req, res) => {
    const start = new Date(req.query.start as string)
    const end = new Date(req.query.end as string)
    const user = req.user!
    console.log({ end, start, user })

    const tags = await getTags(user, start, end)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(tags))
  })

  httpd.get('/activities', authMiddleware, async (req, res) => {
    const start = new Date(req.query.start as string)
    const end = new Date(req.query.end as string)
    const types = (req.query.types as string)?.split(',') || ['sleep', 'exercise', 'meditation']
    const user = req.user!

    const activities = await getActivities(user, types as ActivityType[], start, end)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(activities))
  })

  httpd.get('/productivity', authMiddleware, async (req, res) => {
    const start = new Date(req.query.start as string)
    const end = new Date(req.query.end as string)
    const user = req.user!

    const productivity = await getProductivity(user, start, end)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(productivity))
  })

  httpd.get('/locations', authMiddleware, async (req, res) => {
    const start = new Date(req.query.start as string)
    const end = new Date(req.query.end as string)
    const user = req.user!

    const { places } = await getLocations(user, start, end)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(places))
  })

  const port = Number(process.env.PORT ?? 80)
  httpd.listen(port, () => {
    console.log(`> Running on localhost:${port}`)
  })
}

main()
