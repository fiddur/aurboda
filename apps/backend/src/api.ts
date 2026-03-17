/**
 * Express server entry point.
 *
 * Route handlers are split into focused modules under routes/.
 * This file handles: server setup, middleware, auth routes, and router mounting.
 */
import type { LoginResponse, ServerStatusResponse, SignupResponse } from '@aurboda/api-spec'

import { json } from 'body-parser'
import cors from 'cors'
import express, { type RequestHandler } from 'express'
import { Client } from 'pg'

import type { OuraDataType } from './oura-sync.ts'

import { processActivityWatchEvents } from './activitywatch-sync.ts'
import { createAuth } from './auth.ts'
import {
  ackOutboundSync,
  deleteHealthConnectRecords,
  getAllSyncStates,
  getDetectedLocationById,
  getPendingOutboundSync,
  initializeSchema,
  insertLocation,
  insertPlace,
  loginToUserDb,
  makeNewUserDb,
  migrateSchema,
  processDailyAggregate,
  processHealthConnectBatch,
  processHealthConnectData,
  query,
  resetSyncState,
  schemaInitialized,
  updateDetectedLocation,
} from './db/index.ts'
import { syncAllGarminData } from './garmin-sync.ts'
import { garminClient } from './garmin.ts'
import { syncAllCalendars } from './ical-sync.ts'
import { createLastFmRouter } from './lastfm-router.ts'
import { syncLastFmData } from './lastfm-sync.ts'
import { createMcpRouter } from './mcp.ts'
import { syncAllOuraData, syncOuraDataType } from './oura-sync.ts'
import { ouraClient } from './oura.ts'
import { createOwnTracksRouter } from './owntracks.ts'
import { syncRescueTimeData } from './rescuetime-sync.ts'
import { createActivitiesRouter } from './routes/activities-router.ts'
import { createAdminRouter } from './routes/admin-router.ts'
import { createCorrelationsRouter } from './routes/correlations-router.ts'
import { createDashboardRouter } from './routes/dashboard-router.ts'
import { createLocationsRouter } from './routes/locations-router.ts'
import { createMealsRouter } from './routes/meals-router.ts'
import { createMetricsRouter } from './routes/metrics-router.ts'
import { createNotesRouter } from './routes/notes-router.ts'
import { createReportsRouter } from './routes/reports-router.ts'
import { createScreentimeCategoriesRouter } from './routes/screentime-categories-router.ts'
import { createSettingsRouter } from './routes/settings-router.ts'
import { createTagsRouter } from './routes/tags-router.ts'
import { createTrainingLoadRouter } from './routes/training-load-router.ts'
import { createTrendsRouter } from './routes/trends-router.ts'
import { triggerCalorieComputation } from './services/calorie-computation.ts'
import { getCentralDb, initializeCentralDb } from './services/central-db.ts'
import { createDetectionTrigger, type DetectionTrigger } from './services/detection-trigger.ts'
import { runDetectionForUser } from './services/detection-worker.ts'
import { createGeocodeQueue, type GeocodeQueue } from './services/geocode-queue.ts'
import { createInvitationAuth } from './services/invitation.ts'
import { createOuraWebhookManager, type OuraWebhookManager } from './services/oura-webhook-manager.ts'
import { getSettings } from './services/settings.ts'
import { createSyncProvider } from './services/sync-provider.ts'
import { createSyncRouter } from './sync-router.ts'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: string
    }
  }
}

const main = async () => {
  const unauthorized = Object.assign(new Error('Unauthorized'), {
    status: 401,
  })
  const forbidden = Object.assign(new Error('Forbidden'), { status: 403 })

  const sessionSecret = process.env.SESSION_SECRET ?? ''
  const auth = createAuth(sessionSecret)
  const invitationAuth = createInvitationAuth(sessionSecret)

  // Initialize central database (server settings, admins)
  await initializeCentralDb()
  const centralDb = getCentralDb()

  const webHost = process.env.WEB_HOST ?? 'http://localhost:5173'
  const oura = ouraClient(process.env.OURA_CLIENT ?? '', process.env.OURA_SECRET ?? '', webHost, {
    onUserAuthenticated: (ouraUserId, username) => centralDb.upsertOuraUserMapping(ouraUserId, username),
  })

  // Create Garmin client (no server-side credentials needed - uses per-user session tokens)
  const garmin = garminClient()

  // Create sync provider for auto-syncing data before queries
  const syncProvider = createSyncProvider({
    garmin,
    getLastFmApiKey: () => centralDb.getLastFmApiKey(),
    oura,
  })

  const httpd = express()

  const userDb = new Client({ database: 'postgres' })
  await userDb.connect()

  // CORS must come first for preflight requests
  httpd.use(cors({ origin: true }))

  // Mount MCP server BEFORE body-parser (MCP SDK needs raw body)
  // Stateless mode — no session tracking needed (tools only, no subscriptions)
  httpd.use('/mcp', createMcpRouter(auth, { garmin, oura, sync: syncProvider }))

  httpd.use(json({ limit: '10mb' }))

  httpd.use((req, res, next) => {
    const sanitizedBody =
      req.body && typeof req.body === 'object'
        ? Object.fromEntries(
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

  // ==========================================================================
  // Auth routes (stay here - tightly coupled to server setup)
  // ==========================================================================

  httpd.get('/version', (_req, res) => {
    res.json({
      build_sha: process.env.BUILD_SHA ?? 'dev',
      success: true,
    })
  })

  httpd.get<Record<string, never>, ServerStatusResponse>('/status', async (_req, res) => {
    const signupMode = await centralDb.getSignupMode()
    res.json({
      signup_allowed: signupMode === 'open',
      signup_mode: signupMode,
      success: true,
    })
  })

  // eslint-disable-next-line complexity -- signup validation logic
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
        res.status(403).json({
          error: 'An invitation is required to sign up',
          success: false,
        })
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
      res.status(400).json({
        error: 'Username and password are required',
        success: false,
      })
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

      res.json({ is_admin: isAdmin, success: true, token })
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
    res.end(JSON.stringify({ is_admin: isAdmin, refresh: token, token }))
  })

  httpd.post('/refresh', async (req, res) => {
    const { refresh } = req.body
    res.end(JSON.stringify({ refresh, token: refresh }))
  })

  // Generate a fresh API token for the authenticated user (e.g. for push agents like ActivityWatch)
  httpd.get('/auth/token', authMiddleware, (req, res) => {
    const user = req.user!
    const token = auth.createToken(user)
    res.json({ success: true, token })
  })

  // ==========================================================================
  // External service routers (already extracted)
  // ==========================================================================

  // Transform SyncState to ProviderSyncStatus format (undefined -> null)
  const transformSyncStates = async (user: string, provider: string) => {
    const states = await getAllSyncStates(user, provider)
    return states.map((s) => ({
      error_message: s.error_message ?? null,
      last_sync_time: s.last_sync_time?.toISOString() ?? null,
      provider: s.provider,
      retry_after: s.retry_after?.toISOString() ?? null,
      status: s.status === 'rate_limited' ? ('error' as const) : s.status,
    }))
  }

  const transformOuraSyncResults = async (
    user: string,
    options: { fullResync?: boolean; startDate?: Date },
  ) => {
    const results = await syncAllOuraData(user, oura, options)
    return results.map((r) => ({
      ...r,
      retry_after: r.retry_after?.toISOString(),
    }))
  }

  const transformRescueTimeSyncResult = async (
    user: string,
    apiKey: string,
    options: { fullResync?: boolean; startDate?: Date },
  ) => {
    const result = await syncRescueTimeData(user, apiKey, options)
    return {
      ...result,
      retry_after: result.retry_after?.toISOString(),
    }
  }

  const transformLastFmSyncResult = async (
    user: string,
    apiKey: string,
    username: string,
    options: { fullResync?: boolean; startDate?: Date },
  ) => {
    return await syncLastFmData(user, apiKey, username, options)
  }

  httpd.use(
    '/sync',
    createSyncRouter(
      {
        ackOutboundSync,
        deleteHealthConnectRecords,
        getActivityWatchSyncStates: (user) => transformSyncStates(user, 'activitywatch'),
        getCalendarSyncStates: (user) => transformSyncStates(user, 'calendar'),
        getGarminSyncStates: (user) => transformSyncStates(user, 'garmin'),
        getLastFmApiKey: () => centralDb.getLastFmApiKey(),
        getLastFmSyncStates: (user) => transformSyncStates(user, 'lastfm'),
        getOuraSyncStates: (user) => transformSyncStates(user, 'oura'),
        getPendingOutboundSync,
        getRescueTimeSyncStates: (user) => transformSyncStates(user, 'rescuetime'),
        getSettings,
        processActivityWatchEvents,
        processDailyAggregate,
        processHealthConnectBatch,
        processHealthConnectData,
        resetCalendarSyncState: (user) => resetSyncState(user, 'calendar'),
        resetGarminSyncState: (user, dataType) => resetSyncState(user, 'garmin', dataType),
        resetLastFmSyncState: (user) => resetSyncState(user, 'lastfm'),
        resetOuraSyncState: (user, dataType) => resetSyncState(user, 'oura', dataType),
        resetRescueTimeSyncState: (user) => resetSyncState(user, 'rescuetime'),
        syncCalendars: (user, calendars) => syncAllCalendars(user, calendars),
        syncGarmin: async (user, options) => {
          const results = await syncAllGarminData(user, garmin, options)
          return results.map((r) => ({
            ...r,
            retry_after: r.retry_after?.toISOString(),
          }))
        },
        syncLastFm: transformLastFmSyncResult,
        syncOura: transformOuraSyncResults,
        syncRescueTime: transformRescueTimeSyncResult,
        triggerCalorieComputation: (user: string, start: Date, end: Date) =>
          triggerCalorieComputation(user, start, end),
      },
      authMiddleware,
    ),
  )

  httpd.use('/lastfm', createLastFmRouter(authMiddleware))

  httpd.get('/auth/connectOura', oura.redirectToAuthorize)
  httpd.get('/auth/ouracb', oura.authCb)

  // Garmin Connect auth endpoints (login with credentials, tokens-only stored)
  httpd.post('/auth/garmin/login', authMiddleware, async (req, res) => {
    const user = req.user!
    const { email, password } = req.body ?? {}

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required', success: false })
      return
    }

    try {
      const result = await garmin.login(user, email, password)
      if ('mfa_required' in result) {
        res.json({ mfa_required: true, success: false })
      } else {
        res.json({ success: true })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed'
      res.status(401).json({ error: message, success: false })
    }
  })

  httpd.post('/auth/garmin/disconnect', authMiddleware, async (req, res) => {
    const user = req.user!
    try {
      await garmin.disconnect(user)
      res.json({ success: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Disconnect failed'
      res.status(500).json({ error: message, success: false })
    }
  })

  // ==========================================================================
  // Oura webhook push integration (admin-configurable via Web UI)
  // ==========================================================================

  const ouraClientId = process.env.OURA_CLIENT ?? ''
  const ouraClientSecret = process.env.OURA_SECRET ?? ''

  let ouraWebhookManager: OuraWebhookManager | null = null
  if (ouraClientId && ouraClientSecret) {
    const syncOuraDataTypeForUser = async (username: string, dataType: OuraDataType) => {
      const accessToken = await oura.getAccessToken(username)
      await syncOuraDataType(username, oura, dataType, accessToken)
    }

    ouraWebhookManager = createOuraWebhookManager({
      centralDb,
      ouraClientId,
      ouraClientSecret,
      syncOuraDataTypeForUser,
      webHost,
    })

    // Mount proxy handler (delegates to inner router when enabled, 404 when disabled)
    httpd.use('/webhooks/oura', (req, res, next) => ouraWebhookManager!.handleWebhookRequest(req, res, next))

    // Enable if previously configured and host supports it
    const webhookEnabled = await centralDb.getOuraWebhookEnabled()
    if (webhookEnabled && ouraWebhookManager.canEnable()) {
      try {
        await ouraWebhookManager.enable()
      } catch (error) {
        console.error('Oura webhook: failed to enable on startup:', error)
      }
    }
  }

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
  // REST API route modules
  // ==========================================================================

  httpd.use(createMetricsRouter(authMiddleware, syncProvider))
  httpd.use('/tags', createTagsRouter(authMiddleware, syncProvider))
  httpd.use('/notes', createNotesRouter(authMiddleware))
  httpd.use('/meals', createMealsRouter(authMiddleware))
  httpd.use('/reports', createReportsRouter(authMiddleware))
  httpd.use(createActivitiesRouter(authMiddleware, syncProvider))
  httpd.use('/locations', createLocationsRouter(authMiddleware))
  httpd.use(createSettingsRouter(authMiddleware))
  httpd.use('/dashboard', createDashboardRouter(authMiddleware))
  httpd.use('/correlations', createCorrelationsRouter(authMiddleware, syncProvider))
  httpd.use('/training-load', createTrainingLoadRouter(authMiddleware))
  httpd.use('/trends', createTrendsRouter(authMiddleware))
  httpd.use('/screentime-categories', createScreentimeCategoriesRouter(authMiddleware))
  httpd.use(
    '/admin',
    createAdminRouter(
      authMiddleware,
      adminMiddleware,
      centralDb,
      invitationAuth,
      webHost,
      ouraWebhookManager,
    ),
  )

  // ==========================================================================
  // Server startup
  // ==========================================================================

  const port = Number(process.env.PORT ?? 80)
  const server = httpd.listen(port, () => {
    console.log(`> Running on localhost:${port}`)
  })

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...')
    detectionTrigger.clearPendingDetections()
    if (ouraWebhookManager) {
      ouraWebhookManager.shutdown()
    }
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
