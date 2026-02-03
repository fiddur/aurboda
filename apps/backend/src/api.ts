import {
  type ActivitiesQuery,
  activitiesQuerySchema,
  type ActivitiesResponse,
  type ActivityImpactQuery,
  activityImpactQuerySchema,
  type ActivityImpactResponse,
  type AddActivityBody,
  addActivityBodySchema,
  type AddActivityResponse,
  type AddMetricBody,
  addMetricBodySchema,
  type AddMetricResponse,
  type AddNamedLocationBody,
  addNamedLocationBodySchema,
  type AddNamedLocationResponse,
  type AddTagBody,
  addTagBodySchema,
  type AddTagResponse,
  type AdminSettingsResponse,
  type BaselineQuery,
  baselineQuerySchema,
  type BaselineResponse,
  type CreateInvitationBody,
  createInvitationBodySchema,
  type DailySummaryQuery,
  dailySummaryQuerySchema,
  type DailySummaryResponse,
  type DeleteTagResponse,
  type DetectedLocationsQuery,
  detectedLocationsQuerySchema,
  type DetectedLocationsResponse,
  type EventProbabilityBody,
  eventProbabilityBodySchema,
  type EventProbabilityResponse,
  type GenericCorrelationBody,
  genericCorrelationBodySchema,
  type GenericCorrelationResponse,
  getExerciseTypeValue,
  type GoalsProgressResponse,
  type HrvActivitiesQuery,
  hrvActivitiesQuerySchema,
  type HrvActivitiesResponse,
  type InvitationResponse,
  isValidExerciseType,
  type LocationsQuery,
  locationsQuerySchema,
  type LocationsResponse,
  type LoginResponse,
  type NamedLocationsResponse,
  type PeriodSummaryQuery,
  periodSummaryQuerySchema,
  type PeriodSummaryResponse,
  type ProductivityQuery,
  productivityQuerySchema,
  type ProductivityResponse,
  type PromoteDetectedLocationBody,
  promoteDetectedLocationBodySchema,
  type QueryMetricsQuery,
  queryMetricsQuerySchema,
  type QueryMetricsResponse,
  type ServerStatusResponse,
  type SignupResponse,
  type TagsQuery,
  tagsQuerySchema,
  type TagsResponse,
  type TrendQuery,
  trendQuerySchema,
  type TrendResponse,
  type UpdateAdminSettingsBody,
  updateAdminSettingsBodySchema,
  type UpdateNamedLocationBody,
  updateNamedLocationBodySchema,
  type UpdateSettingsInput,
  updateSettingsInputSchema,
  type UserSettingsResponse,
} from '@aurboda/api-spec'
import { json } from 'body-parser'
import cors from 'cors'
import express, { RequestHandler } from 'express'
import { Client } from 'pg'
import { createAuth } from './auth'
import {
  getAllSyncStates,
  getDetectedLocationById,
  getDetectedLocations as getStoredDetectedLocations,
  initializeSchema,
  insertLocation,
  insertPlace,
  loginToUserDb,
  makeNewUserDb,
  migrateSchema,
  processDailyAggregate,
  processHealthConnectData,
  query,
  resetSyncState,
  schemaInitialized,
  updateDetectedLocation,
} from './db'
import { createMcpRouter } from './mcp'
import { createDbSessionStore } from './mcp-session-store'
import { ouraClient } from './oura'
import { syncAllOuraData } from './oura-sync'
import { createOwnTracksRouter } from './owntracks'
import { syncRescueTimeData } from './rescuetime-sync'
import { isValidMetric, MetricType, validMetrics } from './schema'
import { getCentralDb, initializeCentralDb } from './services/central-db'
import {
  getActivityImpact,
  getBaseline,
  getEventProbability,
  getGenericCorrelation,
  getHrvActivitiesCorrelation,
} from './services/correlations'
import { createDetectionTrigger, DetectionTrigger } from './services/detection-trigger'
import { runDetectionForUser } from './services/detection-worker'
import { createGeocodeQueue, GeocodeQueue } from './services/geocode-queue'
import { getGoalsProgress } from './services/goals'
import { createInvitationAuth } from './services/invitation'
import {
  deleteNamedLocation,
  getDetectedLocations,
  getNamedLocations,
  insertNamedLocation,
  updateNamedLocation,
} from './services/locations'
import { addActivity, addMetric, addTag } from './services/mutations'
import {
  getDailySummary,
  getPeriodSummary,
  queryActivities,
  queryLocations,
  queryMetrics,
  queryProductivity,
  queryTags,
} from './services/queries'
import { getSettings, getSettingsResponse, validateAndUpdateSettings } from './services/settings'
import { createSyncProvider } from './services/sync-provider'
import { getTrend } from './services/trends'
import { createSyncRouter } from './sync-router'
import { validateBody, validateQuery } from './validation'

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
  const forbidden = Object.assign(new Error('Forbidden'), { status: 403 })

  const sessionSecret = process.env.SESSION_SECRET ?? ''
  const auth = createAuth(sessionSecret)
  const invitationAuth = createInvitationAuth(sessionSecret)

  const webHost = process.env.WEB_HOST ?? 'http://localhost:5173'
  const oura = ouraClient(process.env.OURA_CLIENT ?? '', process.env.OURA_SECRET ?? '', webHost)

  // Initialize central database (server settings, admins)
  await initializeCentralDb()
  const centralDb = getCentralDb()

  // Create sync provider for auto-syncing data before queries
  const syncProvider = createSyncProvider({
    oura,
  })

  const httpd = express()

  const userDb = new Client({ database: 'postgres' })
  await userDb.connect()

  // CORS must come first for preflight requests
  httpd.use(cors({ origin: true }))

  // Mount MCP server BEFORE body-parser (MCP SDK needs raw body)
  // Use database-backed session store for persistence across restarts
  httpd.use('/mcp', createMcpRouter(auth, oura, syncProvider, { sessionStore: createDbSessionStore() }))

  httpd.use(json({ limit: '10mb' }))

  httpd.use((req, res, next) => {
    const sanitizedBody =
      req.body && typeof req.body === 'object' ?
        Object.fromEntries(
          Object.entries(req.body).map(([k, v]) => (k === 'password' ? [k, '[REDACTED]'] : [k, v])),
        )
      : req.body
    console.log(req.path, sanitizedBody)
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

  const adminMiddleware: RequestHandler = async (req, res, next) => {
    if (!req.user) {
      return next(unauthorized)
    }
    const isAdmin = await centralDb.isAdmin(req.user)
    if (!isAdmin) {
      return next(forbidden)
    }
    next()
  }

  httpd.get<Record<string, never>, ServerStatusResponse>('/status', async (_req, res) => {
    const signupMode = await centralDb.getSignupMode()
    res.json({
      signupAllowed: signupMode === 'open',
      signupMode,
      success: true,
    })
  })

  httpd.post<Record<string, never>, SignupResponse>('/signup', async (req, res, next) => {
    const signupMode = await centralDb.getSignupMode()

    if (signupMode === 'closed') {
      res.status(403).json({ error: 'Signup is currently closed', success: false })
      return
    }

    const { username: user, password, invitation } = req.body

    // In invite_only mode, require valid invitation token
    if (signupMode === 'invite_only') {
      if (!invitation || typeof invitation !== 'string') {
        res.status(403).json({ error: 'An invitation is required to sign up', success: false })
        return
      }
      const validation = invitationAuth.validateInvitationToken(invitation)
      if (!validation.valid) {
        const errorMsg = validation.expired ? 'Invitation has expired' : 'Invalid invitation'
        res.status(403).json({ error: errorMsg, success: false })
        return
      }
    }

    if (!user || typeof user !== 'string' || !password || typeof password !== 'string') {
      res.status(400).json({ error: 'Username and password are required', success: false })
      return
    }

    // Validate username format (alphanumeric, lowercase, no special chars for PostgreSQL role)
    if (!/^[a-z][a-z0-9_]{2,30}$/.test(user)) {
      res.status(400).json({
        error:
          'Username must be 3-31 characters, start with a letter, and contain only lowercase letters, numbers, and underscores',
        success: false,
      })
      return
    }

    // Block reserved PostgreSQL and system usernames
    const reservedUsernames = [
      'postgres',
      'admin',
      'root',
      'administrator',
      'superuser',
      'system',
      'public',
      'guest',
      'test',
      'aurboda',
    ]
    if (reservedUsernames.includes(user)) {
      res.status(400).json({ error: 'This username is reserved', success: false })
      return
    }

    // Check if user already exists
    const existingUser = await query(userDb, 'SELECT usename FROM pg_user WHERE usename=$1', [user])
    if (existingUser.rowCount && existingUser.rowCount > 0) {
      res.status(409).json({ error: 'Username already exists', success: false })
      return
    }

    try {
      await makeNewUserDb(userDb, user, password)
      const token = auth.createToken(user)

      // First user becomes admin automatically
      const adminCount = await centralDb.getAdminCount()
      let isAdmin = false
      if (adminCount === 0) {
        await centralDb.addAdmin(user)
        isAdmin = true
        console.log(`First user ${user} automatically made admin`)
      }

      res.json({ isAdmin, success: true, token })
    } catch (err) {
      console.error('Signup error:', err)
      next(err)
    }
  })

  httpd.post<Record<string, never>, LoginResponse>('/login', async (req, res, next) => {
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
    const isAdmin = await centralDb.isAdmin(user)

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ isAdmin, refresh: token, token }))
  })

  httpd.post('/refresh', async (req, res) => {
    const { refresh } = req.body
    res.end(JSON.stringify({ refresh, token: refresh }))
  })

  // Transform SyncState to ProviderSyncStatus format (undefined -> null)
  const transformSyncStates = async (user: string, provider: 'oura' | 'rescuetime') => {
    const states = await getAllSyncStates(user, provider)
    return states.map((s) => ({
      errorMessage: s.errorMessage ?? null,
      lastSyncTime: s.lastSyncTime?.toISOString() ?? null,
      provider: s.provider,
      retryAfter: s.retryAfter?.toISOString() ?? null,
      status: s.status === 'rate_limited' ? ('error' as const) : s.status,
    }))
  }

  // Transform Oura sync results (Date -> ISO string)
  const transformOuraSyncResults = async (
    user: string,
    options: { fullResync?: boolean; startDate?: Date },
  ) => {
    const results = await syncAllOuraData(user, oura, options)
    return results.map((r) => ({
      ...r,
      retryAfter: r.retryAfter?.toISOString(),
    }))
  }

  // Transform RescueTime sync result (Date -> ISO string)
  const transformRescueTimeSyncResult = async (
    user: string,
    apiKey: string,
    options: { fullResync?: boolean; startDate?: Date },
  ) => {
    const result = await syncRescueTimeData(user, apiKey, options)
    return {
      ...result,
      retryAfter: result.retryAfter?.toISOString(),
    }
  }

  // Sync router - handles /sync/* endpoints
  httpd.use(
    '/sync',
    createSyncRouter(
      {
        getOuraSyncStates: (user) => transformSyncStates(user, 'oura'),
        getRescueTimeSyncStates: (user) => transformSyncStates(user, 'rescuetime'),
        getSettings,
        processDailyAggregate,
        processHealthConnectData,
        resetOuraSyncState: (user, dataType) => resetSyncState(user, 'oura', dataType),
        resetRescueTimeSyncState: (user) => resetSyncState(user, 'rescuetime'),
        syncOura: transformOuraSyncResults,
        syncRescueTime: transformRescueTimeSyncResult,
      },
      authMiddleware,
    ),
  )

  httpd.get('/auth/connectOura', oura.redirectToAuthorize)
  httpd.get('/auth/ouracb', oura.authCb)

  // Initialize geocode queue (creates 'aurboda' database if needed)
  let geocodeQueue: GeocodeQueue | null = null
  try {
    geocodeQueue = await createGeocodeQueue({ updateDetectedLocation })
  } catch (error) {
    console.error('Failed to initialize geocode queue:', error)
  }
  if (!geocodeQueue) {
    console.warn('Geocoding disabled - detected locations will not be reverse geocoded')
  }

  // Create detection trigger with geocode queue
  const detectionTrigger: DetectionTrigger = createDetectionTrigger({
    geocodeQueue,
    getDetectedLocationById,
    runDetectionForUser,
  })

  // OwnTracks data endpoint (protected by Basic Auth using existing user credentials)
  httpd.use(
    '/ownTracks',
    createOwnTracksRouter({
      insertLocation,
      insertPlace,
      loginToUserDb,
      onLocationInserted: detectionTrigger.triggerDetectionForUser,
    }),
  )

  // ==========================================================================
  // REST API - Uses shared service layer with MCP
  // ==========================================================================

  // GET /metrics/:metric - Query time series metrics
  httpd.get<{ metric: string }, QueryMetricsResponse, unknown, QueryMetricsQuery>(
    '/metrics/:metric',
    authMiddleware,
    validateQuery(queryMetricsQuerySchema),
    async (req, res) => {
      const { metric } = req.params
      const { start, end } = req.query
      const user = req.user!

      if (!isValidMetric(metric)) {
        return res.status(400).json({
          error: `Invalid metric "${metric}". Valid metrics are: ${validMetrics.join(', ')}`,
          success: false,
        })
      }

      const result = await queryMetrics(user, metric, new Date(start), new Date(end))
      res.json({ ...result, success: true })
    },
  )

  // GET /daily-summary - Get comprehensive summary for a day
  httpd.get<Record<string, never>, DailySummaryResponse, unknown, DailySummaryQuery>(
    '/daily-summary',
    authMiddleware,
    validateQuery(dailySummaryQuerySchema),
    async (req, res) => {
      const { date } = req.query
      const user = req.user!

      const summary = await getDailySummary(user, new Date(date), syncProvider)
      res.json({ data: summary, success: true })
    },
  )

  // GET /period-summary - Get aggregated stats for a period
  httpd.get<Record<string, never>, PeriodSummaryResponse, unknown, PeriodSummaryQuery>(
    '/period-summary',
    authMiddleware,
    validateQuery(periodSummaryQuerySchema),
    async (req, res) => {
      const { start, end, metrics: metricsParam } = req.query
      const user = req.user!

      const metrics = metricsParam.split(',')
      const invalidMetrics = metrics.filter((m) => !isValidMetric(m))
      if (invalidMetrics.length > 0) {
        return res.status(400).json({
          error: `Invalid metrics: ${invalidMetrics.join(', ')}. Valid metrics are: ${validMetrics.join(', ')}`,
          success: false,
        })
      }

      const summary = await getPeriodSummary(user, metrics as MetricType[], new Date(start), new Date(end))
      res.json({ ...summary, success: true })
    },
  )

  // GET /tags - Query tags for a time range
  httpd.get<Record<string, never>, TagsResponse, unknown, TagsQuery>(
    '/tags',
    authMiddleware,
    validateQuery(tagsQuerySchema),
    async (req, res) => {
      const { start, end } = req.query
      const user = req.user!

      const tags = await queryTags(user, new Date(start), new Date(end), syncProvider)
      res.json({ data: tags, success: true })
    },
  )

  // POST /tags - Add a manual tag
  httpd.post<Record<string, never>, AddTagResponse, AddTagBody>(
    '/tags',
    authMiddleware,
    validateBody(addTagBodySchema),
    async (req, res) => {
      const { tag, start_time, end_time, merge_span } = req.body
      const user = req.user!

      const startDate = new Date(start_time)
      const endDate = end_time ? new Date(end_time) : undefined

      const result = await addTag(user, {
        endTime: endDate,
        mergeSpan: merge_span,
        startTime: startDate,
        tag,
      })
      res.json(result)
    },
  )

  // GET /activities - Query activities for a time range
  httpd.get<Record<string, never>, ActivitiesResponse, unknown, ActivitiesQuery>(
    '/activities',
    authMiddleware,
    validateQuery(activitiesQuerySchema),
    async (req, res) => {
      const { start, end, types: typesParam } = req.query
      const user = req.user!

      const types = (typesParam?.split(',') || ['sleep', 'exercise', 'meditation']) as (
        | 'sleep'
        | 'exercise'
        | 'meditation'
        | 'nap'
      )[]

      const activities = await queryActivities(user, types, new Date(start), new Date(end), syncProvider)
      res.json({ data: activities, success: true })
    },
  )

  // POST /activities - Add a manual activity
  httpd.post<Record<string, never>, AddActivityResponse, AddActivityBody>(
    '/activities',
    authMiddleware,
    validateBody(addActivityBodySchema),
    async (req, res) => {
      const { activity_type, start_time, end_time, title, notes, exercise_type } = req.body
      const user = req.user!

      const startDate = new Date(start_time)
      const endDate = new Date(end_time)

      // Validate and convert exercise_type name to value if provided
      let data: Record<string, unknown> | undefined
      if (exercise_type !== undefined) {
        if (!isValidExerciseType(exercise_type)) {
          return res.status(400).json({
            error: `Invalid exercise_type "${exercise_type}"`,
            success: false,
          })
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
        return res.status(400).json({ error: result.error, success: false })
      }

      res.json({
        data: {
          activityType: result.activityType!,
          endTime: result.endTime!,
          id: result.id!,
          notes: result.notes,
          startTime: result.startTime!,
          title: result.title,
        },
        success: true,
      })
    },
  )

  // GET /productivity - Query productivity data for a time range
  httpd.get<Record<string, never>, ProductivityResponse, unknown, ProductivityQuery>(
    '/productivity',
    authMiddleware,
    validateQuery(productivityQuerySchema),
    async (req, res) => {
      const { start, end } = req.query
      const user = req.user!

      const productivity = await queryProductivity(user, new Date(start), new Date(end), syncProvider)
      res.json({ data: productivity, success: true })
    },
  )

  // GET /locations - Query location data for a time range
  httpd.get<Record<string, never>, LocationsResponse, unknown, LocationsQuery>(
    '/locations',
    authMiddleware,
    validateQuery(locationsQuerySchema),
    async (req, res) => {
      const { start, end } = req.query
      const user = req.user!

      const places = await queryLocations(user, new Date(start), new Date(end))
      res.json({ data: places, success: true })
    },
  )

  // ==========================================================================
  // Named Locations API
  // ==========================================================================

  // GET /locations/named - List all named locations
  httpd.get<Record<string, never>, NamedLocationsResponse>(
    '/locations/named',
    authMiddleware,
    async (req, res) => {
      const locations = await getNamedLocations(req.user!)
      res.json({ data: locations, success: true })
    },
  )

  // POST /locations/named - Create a named location
  httpd.post<Record<string, never>, AddNamedLocationResponse, AddNamedLocationBody>(
    '/locations/named',
    authMiddleware,
    validateBody(addNamedLocationBodySchema),
    async (req, res) => {
      const { name, lat, lon, radius } = req.body
      const user = req.user!

      const location = await insertNamedLocation(user, { lat, lon, name, radius })
      res.json({ data: location, success: true })
    },
  )

  // PATCH /locations/named/:id - Update a named location
  httpd.patch<{ id: string }, AddNamedLocationResponse, UpdateNamedLocationBody>(
    '/locations/named/:id',
    authMiddleware,
    validateBody(updateNamedLocationBodySchema),
    async (req, res) => {
      const { id } = req.params
      const { name, lat, lon, radius } = req.body
      const user = req.user!

      // lat and lon must be updated together
      if ((lat !== undefined) !== (lon !== undefined)) {
        return res.status(400).json({ error: 'lat and lon must be updated together', success: false })
      }

      const location = await updateNamedLocation(user, id, { lat, lon, name, radius })
      if (!location) {
        return res.status(404).json({ error: 'Named location not found', success: false })
      }
      res.json({ data: location, success: true })
    },
  )

  // DELETE /locations/named/:id - Delete a named location
  httpd.delete<{ id: string }, DeleteTagResponse>(
    '/locations/named/:id',
    authMiddleware,
    async (req, res) => {
      const { id } = req.params
      const deleted = await deleteNamedLocation(req.user!, id)
      if (!deleted) {
        return res.status(404).json({ error: 'Named location not found', success: false })
      }
      res.json({ success: true })
    },
  )

  // GET /locations/detected - Get computed detected location clusters (on-demand analysis)
  httpd.get<Record<string, never>, DetectedLocationsResponse, unknown, DetectedLocationsQuery>(
    '/locations/detected',
    authMiddleware,
    validateQuery(detectedLocationsQuerySchema),
    async (req, res) => {
      const { start, end, min_duration } = req.query
      const user = req.user!

      const detected = await getDetectedLocations(user, {
        end: new Date(end),
        minDurationMinutes: min_duration ? parseInt(min_duration, 10) : undefined,
        start: new Date(start),
      })
      res.json({ data: detected, success: true })
    },
  )

  // GET /locations/detected/stored - Get stored detected locations with addresses
  httpd.get<Record<string, never>, DetectedLocationsResponse>(
    '/locations/detected/stored',
    authMiddleware,
    async (req, res) => {
      const user = req.user!
      const detected = await getStoredDetectedLocations(user)
      // Transform Date objects to ISO strings for API response
      const serialized = detected.map((d) => ({
        ...d,
        firstVisit: d.firstVisit.toISOString(),
        lastVisit: d.lastVisit.toISOString(),
      }))
      res.json({ data: serialized, success: true })
    },
  )

  // POST /locations/detected/promote - Promote detected location to named
  httpd.post<Record<string, never>, AddNamedLocationResponse, PromoteDetectedLocationBody>(
    '/locations/detected/promote',
    authMiddleware,
    validateBody(promoteDetectedLocationBodySchema),
    async (req, res) => {
      const { lat, lon, name, radius } = req.body
      const user = req.user!

      const location = await insertNamedLocation(user, { lat, lon, name, radius })
      res.json({ data: location, success: true })
    },
  )

  // POST /metrics - Add a manual metric measurement
  httpd.post<Record<string, never>, AddMetricResponse, AddMetricBody>(
    '/metrics',
    authMiddleware,
    validateBody(addMetricBodySchema),
    async (req, res) => {
      const { metric, value, time } = req.body
      const user = req.user!

      const measurementTime = time ? new Date(time) : new Date()

      const result = await addMetric(user, { metric, time: measurementTime, value })
      res.json(result)
    },
  )

  // GET /goals/progress - Get progress toward all user goals
  httpd.get<Record<string, never>, GoalsProgressResponse>(
    '/goals/progress',
    authMiddleware,
    async (req, res) => {
      const goals = await getGoalsProgress(req.user!)
      res.json({ goals, success: true })
    },
  )

  // GET /user/settings - Get user settings with effective HR zones
  httpd.get<Record<string, never>, UserSettingsResponse>(
    '/user/settings',
    authMiddleware,
    async (req, res) => {
      const result = await getSettingsResponse(req.user!)
      res.json(result)
    },
  )

  // PATCH /user/settings - Update user settings
  httpd.patch<Record<string, never>, UserSettingsResponse, UpdateSettingsInput>(
    '/user/settings',
    authMiddleware,
    validateBody(updateSettingsInputSchema),
    async (req, res) => {
      const result = await validateAndUpdateSettings(req.user!, req.body)
      if (!result.success) {
        return res.status(400).json(result)
      }
      res.json(result)
    },
  )

  // ==========================================================================
  // Correlations API
  // ==========================================================================

  // GET /correlations/baseline - Get HRV baseline statistics
  httpd.get<Record<string, never>, BaselineResponse, unknown, BaselineQuery>(
    '/correlations/baseline',
    authMiddleware,
    validateQuery(baselineQuerySchema),
    async (req, res) => {
      const { reference_date } = req.query
      const user = req.user!

      const referenceDate = reference_date ? new Date(reference_date) : undefined
      const baseline = await getBaseline(user, referenceDate)
      res.json({ data: baseline, success: true })
    },
  )

  // GET /correlations/hrv-activities - Get HRV correlations with activities
  httpd.get<Record<string, never>, HrvActivitiesResponse, unknown, HrvActivitiesQuery>(
    '/correlations/hrv-activities',
    authMiddleware,
    validateQuery(hrvActivitiesQuerySchema),
    async (req, res) => {
      const { period_days } = req.query
      const user = req.user!

      const periodDays = period_days ? parseInt(period_days, 10) : 30
      const correlations = await getHrvActivitiesCorrelation(user, periodDays, syncProvider)
      res.json({ data: correlations, success: true })
    },
  )

  // GET /correlations/activity-impact/:activity - Get activity impact on metrics
  httpd.get<{ activity: string }, ActivityImpactResponse, unknown, ActivityImpactQuery>(
    '/correlations/activity-impact/:activity',
    authMiddleware,
    validateQuery(activityImpactQuerySchema),
    async (req, res) => {
      const { activity } = req.params
      const { activity_type, period_days, window_minutes } = req.query
      const user = req.user!

      const periodDays = period_days ? parseInt(period_days, 10) : 90
      const windowMinutes = window_minutes ? parseInt(window_minutes, 10) : 30

      const impact = await getActivityImpact(
        user,
        activity,
        activity_type,
        windowMinutes,
        periodDays,
        syncProvider,
      )
      res.json({ data: impact, success: true })
    },
  )

  // POST /correlations/event-probability - Get event probability correlation
  httpd.post<Record<string, never>, EventProbabilityResponse, EventProbabilityBody>(
    '/correlations/event-probability',
    authMiddleware,
    validateBody(eventProbabilityBodySchema),
    async (req, res) => {
      const { trigger_type, trigger_value, outcome_pattern, lag_windows, period_days } = req.body
      const user = req.user!

      const probability = await getEventProbability(
        user,
        { type: trigger_type, value: trigger_value },
        { pattern: outcome_pattern, type: 'tag' },
        lag_windows ?? ['12h', '24h', '36h', '48h'],
        period_days ?? 365,
        syncProvider,
      )
      res.json({ data: probability, success: true })
    },
  )

  // POST /correlations/generic - Generic correlation analysis
  httpd.post<Record<string, never>, GenericCorrelationResponse, GenericCorrelationBody>(
    '/correlations/generic',
    authMiddleware,
    validateBody(genericCorrelationBodySchema),
    async (req, res) => {
      const { triggers, outcome, lag_windows, period_days } = req.body
      const user = req.user!

      const result = await getGenericCorrelation(
        user,
        triggers,
        outcome,
        lag_windows ?? ['24h', '48h', '7d'],
        period_days ?? 90,
        syncProvider,
      )
      res.json({ data: result, success: true })
    },
  )

  // ==========================================================================
  // Trends API
  // ==========================================================================

  // GET /trends - Get time-weighted trend for tags or metrics
  httpd.get<Record<string, never>, TrendResponse, unknown, TrendQuery>(
    '/trends',
    authMiddleware,
    validateQuery(trendQuerySchema),
    async (req, res) => {
      const { aggregation, display_period, half_life_days, lookback_days, pattern, source_type } = req.query
      const user = req.user!

      const halfLifeDays = half_life_days ? parseInt(half_life_days, 10) : undefined
      const lookbackDays = lookback_days ? parseInt(lookback_days, 10) : undefined

      try {
        const result = await getTrend(user, {
          aggregation,
          displayPeriod: display_period,
          halfLifeDays,
          lookbackDays,
          pattern,
          sourceType: source_type,
        })
        res.json({ data: result, success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(400).json({ error: message, success: false })
      }
    },
  )

  // ==========================================================================
  // Admin API
  // ==========================================================================

  // GET /admin/settings - Get admin settings
  httpd.get<Record<string, never>, AdminSettingsResponse>(
    '/admin/settings',
    authMiddleware,
    adminMiddleware,
    async (_req, res) => {
      const signupMode = await centralDb.getSignupMode()
      const adminCount = await centralDb.getAdminCount()
      res.json({
        admin_count: adminCount,
        signup_mode: signupMode,
        success: true,
      })
    },
  )

  // PATCH /admin/settings - Update admin settings
  httpd.patch<Record<string, never>, AdminSettingsResponse, UpdateAdminSettingsBody>(
    '/admin/settings',
    authMiddleware,
    adminMiddleware,
    validateBody(updateAdminSettingsBodySchema),
    async (req, res) => {
      const { signup_mode } = req.body
      if (signup_mode) {
        await centralDb.setSignupMode(signup_mode)
      }
      const currentMode = await centralDb.getSignupMode()
      const adminCount = await centralDb.getAdminCount()
      res.json({
        admin_count: adminCount,
        signup_mode: currentMode,
        success: true,
      })
    },
  )

  // POST /admin/invitations - Create a new invitation
  httpd.post<Record<string, never>, InvitationResponse, CreateInvitationBody>(
    '/admin/invitations',
    authMiddleware,
    adminMiddleware,
    validateBody(createInvitationBodySchema),
    async (req, res) => {
      const { expiryHours } = req.body
      const token = invitationAuth.createInvitationToken(expiryHours)
      const expiresAt = invitationAuth.getTokenExpiry(token)

      res.json({
        expiresAt: expiresAt!.toISOString(),
        success: true,
        token,
        url: `${webHost}/signup?invite=${encodeURIComponent(token)}`,
      })
    },
  )

  const port = Number(process.env.PORT ?? 80)
  const server = httpd.listen(port, () => {
    console.log(`> Running on localhost:${port}`)
  })

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...')
    detectionTrigger.clearPendingDetections()
    if (geocodeQueue) {
      await geocodeQueue.stop()
    }
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err)
        else resolve()
      })
    })
    console.log('Server closed')
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main()
