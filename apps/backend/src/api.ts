/**
 * Express server entry point.
 *
 * Route handlers are split into focused modules under routes/.
 * This file handles: server setup, middleware, auth routes, and router mounting.
 */
import type {
  AuthTokenResponse,
  LoginResponse,
  ServerStatusResponse,
  SignupResponse,
  VersionResponse,
} from '@aurboda/api-spec'

import cors from 'cors'
import express, { json, type NextFunction, type Request, type RequestHandler, type Response } from 'express'
import { Client } from 'pg'

import type { OuraDataType } from './integrations/oura/sync.ts'

import { createAuth } from './auth.ts'
import {
  ackOutboundSync,
  deleteHealthConnectRecords,
  getAllSyncStates,
  getDetectedLocationById,
  getOutboundSyncHistory,
  getPendingOutboundSync,
  insertActivity,
  insertLocations,
  insertRawRecord,
  insertTimeSeries,
  reportSyncFailure,
  requeueOutboundSync,
  initializeSchema,
  insertLocation,
  insertPlace,
  loginToUserDb,
  makeNewUserDb,
  markActivityDetailSynced,
  migrateSchema,
  processDailyAggregate,
  processHealthConnectBatch,
  processHealthConnectData,
  query,
  resolveOrCreateActivityType,
  resetSyncState,
  schemaInitialized,
  softDeleteActivityByExternalId,
  softDeleteLocationRange,
  deleteRuleActivities,
  getDeductionRulesByIds,
  getEnabledDeductionRules,
  updateDetectedLocation,
  upsertOAuthToken,
  upsertSyncState,
  upsertUserSettings,
} from './db/index.ts'
import { httpError, isHttpError } from './http-error.ts'
import { processActivityWatchEvents } from './integrations/activitywatch/sync.ts'
import { garminClient } from './integrations/garmin/client.ts'
import { processActivityDetail } from './integrations/garmin/process.ts'
import { syncAllGarminData } from './integrations/garmin/sync.ts'
import { syncAllCalendars } from './integrations/ical/sync.ts'
import { syncLastFmData } from './integrations/lastfm/sync.ts'
import { ouraClient } from './integrations/oura/client.ts'
import { syncAllOuraData, syncOuraDataType } from './integrations/oura/sync.ts'
import { createOwnTracksRouter } from './integrations/owntracks/router.ts'
import { syncRescueTimeData } from './integrations/rescuetime/sync.ts'
import { stravaClient } from './integrations/strava/client.ts'
import { getStravaSyncStates, resetStravaSyncState, syncStrava } from './integrations/strava/sync.ts'
import { createStravaWebhookRouter } from './integrations/strava/webhook-router.ts'
import { createMcpRouter } from './mcp.ts'
import { createActivitiesRouter } from './routes/activities-router.ts'
import { createActivityTypesRouter } from './routes/activity-types-router.ts'
import { createAdminRouter } from './routes/admin-router.ts'
import { createAuditLogRouter } from './routes/audit-log-router.ts'
import { createChartDataRouter } from './routes/chart-data-router.ts'
import { createCorrelationsRouter } from './routes/correlations-router.ts'
import { createDashboardRouter } from './routes/dashboard-router.ts'
import { createDeductionRulesRouter } from './routes/deduction-rules-router.ts'
import { createFoodItemsRouter } from './routes/food-items-router.ts'
import { createIconsRouter } from './routes/icons-router.ts'
import { createLocationsRouter } from './routes/locations-router.ts'
import { createMealsRouter } from './routes/meals-router.ts'
import { createMetricsRouter } from './routes/metrics-router.ts'
import { createNotesRouter } from './routes/notes-router.ts'
import { createOAuthRouter } from './routes/oauth-router.ts'
import { createReportsRouter } from './routes/reports-router.ts'
import { createScreentimeCategoriesRouter } from './routes/screentime-categories-router.ts'
import { createScrobblesRouter } from './routes/scrobbles-router.ts'
import { createSettingsRouter } from './routes/settings-router.ts'
// tags-router removed: tags are now activities
import { createTrainingLoadRouter } from './routes/training-load-router.ts'
import { createTrendsRouter } from './routes/trends-router.ts'
import { auditError, auditInfo, auditWarn, pruneAuditLog } from './services/audit-log.ts'
import { backfillScreentimeActivities } from './services/backfill-screentime-activities.ts'
import { triggerCalorieComputation } from './services/calorie-computation.ts'
import { getCentralDb, initializeCentralDb } from './services/central-db.ts'
import { createDefaultEngineDeps } from './services/deduction-deps.ts'
import { buildFullWindow, evaluateAllRules } from './services/deduction-engine.ts'
import {
  type ActivityNotifier,
  createDeductionQueue,
  type DeductionQueue,
} from './services/deduction-queue.ts'
import { createDetectionTrigger, type DetectionTrigger } from './services/detection-trigger.ts'
import { runDetectionForUser } from './services/detection-worker.ts'
import { createGeocodeQueue } from './services/geocode-queue.ts'
import { createInvitationAuth } from './services/invitation.ts'
import { createOuraWebhookManager, type OuraWebhookManager } from './services/oura-webhook-manager.ts'
import { createPgBoss } from './services/pg-boss.ts'
import { getSettings } from './services/settings.ts'
import { createStravaQueue, type StravaQueue } from './services/strava-queue.ts'
import { createStravaWebhookManager } from './services/strava-webhook-manager.ts'
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

// eslint-disable-next-line complexity -- server setup orchestration
const main = async () => {
  const unauthorized = httpError(401, 'Unauthorized')
  const forbidden = httpError(403, 'Forbidden')

  const sessionSecret = process.env.SESSION_SECRET ?? ''
  const auth = createAuth(sessionSecret)
  const invitationAuth = createInvitationAuth(sessionSecret)

  // Callbacks to run after httpd.listen() — for tasks that need the server to be reachable
  const postListenCallbacks: Array<() => Promise<void>> = []

  // Initialize central database (server settings, admins)
  await initializeCentralDb()
  const centralDb = getCentralDb()

  const webHost = process.env.WEB_HOST ?? 'http://localhost:5173'
  const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:3000'
  console.info(`🌐 WEB_HOST=${webHost} API_BASE_URL=${apiBaseUrl}`)
  const oura = ouraClient(process.env.OURA_CLIENT ?? '', process.env.OURA_SECRET ?? '', apiBaseUrl, {
    onUserAuthenticated: (ouraUserId, username) => centralDb.upsertOuraUserMapping(ouraUserId, username),
  })

  // Create Garmin client (no server-side credentials needed - uses per-user session tokens)
  const garmin = garminClient()

  // Create Strava client with dynamic credentials (reads from DB on each request)
  const getStravaCredentials = async () => {
    const clientId = await centralDb.getServerSetting('strava_client_id')
    const clientSecret = await centralDb.getServerSetting('strava_client_secret')
    if (!clientId || !clientSecret) {
      throw new Error('Strava not configured — set credentials in Admin Settings')
    }
    return { clientId, clientSecret }
  }

  const strava = stravaClient(getStravaCredentials, apiBaseUrl, {
    onUserAuthenticated: (stravaAthleteId, username) =>
      centralDb.upsertStravaAthleteMapping(stravaAthleteId, username),
  })

  // Create sync provider for auto-syncing data before queries
  const syncProvider = createSyncProvider({
    garmin,
    getLastFmApiKey: () => centralDb.getLastFmApiKey(),
    oura,
  })

  // Initialize shared pg-boss instance and job queues (before MCP mount)
  const boss = await createPgBoss()

  let deductionQueue: DeductionQueue | null = null
  const activityNotifier: ActivityNotifier = (user, activityType, start, end, sourceRuleId) => {
    deductionQueue?.enqueueEvaluation({
      activity_type: activityType,
      source_rule_id: sourceRuleId,
      user,
      window_end: end.toISOString(),
      window_start: start.toISOString(),
    })
  }
  const engineDeps = createDefaultEngineDeps(activityNotifier)

  if (boss) {
    try {
      deductionQueue = await createDeductionQueue(boss, {
        buildFullWindow: (user) => buildFullWindow(user, engineDeps),
        deleteRuleActivities,
        engineDeps,
        evaluateAllRules,
        getDeductionRules: getDeductionRulesByIds,
        getEnabledRules: getEnabledDeductionRules,
      })
    } catch (error) {
      console.error('Failed to initialize deduction queue:', error)
    }
  }
  if (!deductionQueue) {
    console.warn('⚠️ Deduction auto-evaluation disabled - rules will only run on manual trigger')
  }

  // Initialize Strava queue (uses shared boss + strava client)
  let stravaQueue: StravaQueue | null = null
  if (boss) {
    try {
      stravaQueue = await createStravaQueue(boss, {
        getAccessToken: (user) => strava.getAccessToken(user),
        getActivity: (token, id) => strava.getActivity(token, id),
        getActivityStreams: (token, id) => strava.getActivityStreams(token, id),
        listActivities: (token, params) => strava.listActivities(token, params),
        processDeps: {
          insertActivity,
          insertLocations,
          insertRawRecord,
          insertTimeSeries,
          resolveOrCreateActivityType,
          softDeleteLocationRange,
        },
        updateSyncState: async (user, dataType, updates) => {
          await upsertSyncState(user, {
            data_type: dataType,
            provider: 'strava',
            status: (updates.status as 'idle' | 'syncing' | 'error' | 'rate_limited') ?? 'idle',
            error_message: updates.error_message as string | undefined,
            last_sync_time: updates.last_sync_time as Date | undefined,
          })
        },
      })
    } catch (error) {
      console.error('Failed to initialize Strava queue:', error)
    }
  }

  const httpd = express()

  const userDb = new Client({ database: 'postgres' })
  await userDb.connect()

  // CORS must come first for preflight requests
  httpd.use(cors({ origin: true }))

  // Mount OAuth endpoints BEFORE body-parser (uses its own parsers)
  httpd.use(createOAuthRouter({ centralDb, loginToUserDb, webHost }))

  // Mount MCP server BEFORE body-parser (MCP SDK needs raw body)
  // Stateless mode — no session tracking needed (tools only, no subscriptions)
  httpd.use(
    '/mcp',
    createMcpRouter(auth, {
      centralDb,
      deductionQueue: deductionQueue ?? undefined,
      engineDeps,
      garmin,
      onActivityMutated: activityNotifier,
      oura,
      stravaQueue: stravaQueue ?? undefined,
      sync: syncProvider,
    }),
  )

  httpd.use(json({ limit: '10mb' }))

  // Log mutations to the user's audit log (GET requests are silent)
  // Log level is based on response status: 4xx → warn, 5xx → error, otherwise → info
  httpd.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'OPTIONS' && req.method !== 'HEAD') {
      const user = (() => {
        try {
          const authHeader = req.headers.authorization
          if (typeof authHeader === 'string') {
            return auth.getUsernameFromToken(authHeader.slice('bearer '.length))
          }
        } catch {}
        return undefined
      })()

      if (user) {
        const sanitizedBody =
          req.body && typeof req.body === 'object'
            ? Object.fromEntries(
                Object.entries(req.body as Record<string, unknown>).map(([k, v]) =>
                  k === 'password' ? [k, '[REDACTED]'] : [k, v],
                ),
              )
            : undefined

        // Capture response body for error logging by intercepting res.json()
        let responseBody: unknown
        const originalJson = res.json.bind(res)
        res.json = (body: unknown) => {
          responseBody = body
          return originalJson(body)
        }

        res.on('finish', () => {
          if (res.statusCode >= 500) {
            auditError(user, 'data', `${req.method} ${req.path}`, {
              ...sanitizedBody,
              status: res.statusCode,
              response: responseBody,
            })
          } else if (res.statusCode >= 400) {
            auditWarn(user, 'data', `${req.method} ${req.path}`, {
              ...sanitizedBody,
              status: res.statusCode,
              response: responseBody,
            })
          } else {
            auditInfo(user, 'data', `${req.method} ${req.path}`, sanitizedBody)
          }
        })
      }
    }
    next()
  })

  // Track which users have been migrated this server lifetime
  const migratedUsers = new Map<string, Promise<void>>()

  const authMiddleware: RequestHandler = async (req, res, next) => {
    try {
      if (typeof req.headers.authorization === 'string') {
        const token = req.headers.authorization.slice('bearer '.length)
        const user = auth.getUsernameFromToken(token)
        req.user = user

        // Run schema migration once per user per server lifetime (blocking on first request)
        if (!migratedUsers.has(user)) {
          const migrationPromise = migrateSchema(user)
            .then(() => {
              // Fire-and-forget: one-shot backfill of historical screentime activities.
              // Gated via sync_state so it runs at most once per user, in the background
              // so the first request isn't blocked on thousands of productivity records.
              void backfillScreentimeActivities(user).catch((err) =>
                console.error(`⚠️ Screentime backfill failed for ${user}:`, err),
              )
            })
            .catch((err) => console.error(`⚠️ Migration failed for ${user}:`, err))
          migratedUsers.set(user, migrationPromise)
          await migrationPromise
        } else {
          // Subsequent requests wait if migration is still in progress
          await migratedUsers.get(user)
        }

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

  httpd.get<Record<string, never>, VersionResponse>('/version', (_req, res) => {
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
        console.info(`First user ${user} automatically made admin`)
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
      } catch {
        return next(unauthorized)
      }
    } else return next(unauthorized)

    const token = auth.createToken(user)
    const isAdmin = await centralDb.isAdmin(user)

    // Prune old audit log entries in the background
    centralDb
      .getAuditLogRetentionDays()
      .then((days) => pruneAuditLog(user, days))
      .catch(() => {})

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ is_admin: isAdmin, refresh: token, token }))
  })

  // Generate a fresh API token for the authenticated user (e.g. for push agents like ActivityWatch)
  httpd.get<Record<string, never>, AuthTokenResponse>('/auth/token', authMiddleware, (req, res) => {
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
        getOutboundSyncHistory,
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
        reportSyncFailure,
        requeueOutboundSync,
        resetCalendarSyncState: (user) => resetSyncState(user, 'calendar'),
        resetGarminSyncState: (user, dataType) => resetSyncState(user, 'garmin', dataType),
        resetLastFmSyncState: (user) => resetSyncState(user, 'lastfm'),
        resetOuraSyncState: (user, dataType) => resetSyncState(user, 'oura', dataType),
        resetRescueTimeSyncState: (user) => resetSyncState(user, 'rescuetime'),
        resetStravaSyncState,
        getStravaSyncStates,
        getStravaQueueStatus: stravaQueue ? () => stravaQueue.getStatus() : undefined,
        syncStrava: async (user, options) => {
          if (!stravaQueue) throw new Error('Strava integration not configured')
          return syncStrava(user, stravaQueue, options)
        },
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
        upsertUserSettings: (user: string, settings: Record<string, unknown>) =>
          upsertUserSettings(user, settings),
        onActivitySynced: activityNotifier,
      },
      authMiddleware,
    ),
  )

  httpd.get('/auth/oura/connect', authMiddleware, oura.getAuthorizeUrl)
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
      auditError(user, 'auth', 'Garmin login endpoint error', { error: String(error) })
      const message = error instanceof Error ? error.message : 'Login failed'
      res.status(401).json({ error: message, success: false })
    }
  })

  httpd.post('/auth/garmin/mfa', authMiddleware, async (req, res) => {
    const user = req.user!
    const { mfa_code } = req.body ?? {}

    if (!mfa_code) {
      res.status(400).json({ error: 'MFA code is required', success: false })
      return
    }

    try {
      await garmin.verifyMfa(user, mfa_code)
      res.json({ success: true })
    } catch (error) {
      auditError(user, 'auth', 'Garmin MFA endpoint error', { error: String(error) })
      const message = error instanceof Error ? error.message : 'MFA verification failed'
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

  // Strava OAuth endpoints (always registered — credentials checked dynamically)
  httpd.get('/auth/strava/connect', authMiddleware, strava.getAuthorizeUrl)
  httpd.get('/auth/stravacb', strava.authCb)

  httpd.post('/auth/strava/disconnect', authMiddleware, async (req, res) => {
    const user = req.user!
    try {
      // Clear tokens and athlete mapping
      await upsertOAuthToken(user, { access_token: '', provider: 'strava' })
      await centralDb.deleteStravaAthleteMappingByUsername(user)
      res.json({ success: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Disconnect failed'
      res.status(500).json({ error: message, success: false })
    }
  })

  // ==========================================================================
  // Strava webhook push integration
  // ==========================================================================

  if (stravaQueue) {
    const stravaVerifyToken = `aurboda-strava-${sessionSecret.slice(0, 8)}`

    httpd.use(
      '/webhooks/strava',
      createStravaWebhookRouter({
        enqueueActivityFetch: (user, activityId, priority) =>
          stravaQueue.enqueueActivityFetch(user, activityId, priority),
        getUsernameByStravaAthleteId: (stravaAthleteId) =>
          centralDb.getUsernameByStravaAthleteId(stravaAthleteId),
        handleDeauthorization: async (stravaAthleteId) => {
          const username = await centralDb.getUsernameByStravaAthleteId(stravaAthleteId)
          if (username) {
            await upsertOAuthToken(username, { access_token: '', provider: 'strava' })
            await centralDb.deleteStravaAthleteMapping(stravaAthleteId)
            auditInfo(username, 'auth', '🏃 Strava: deauthorized via webhook')
          }
        },
        softDeleteStravaActivity: async (user, stravaActivityId) => {
          await softDeleteActivityByExternalId(user, 'strava', `strava-activity-${stravaActivityId}`)
        },
        verifyToken: stravaVerifyToken,
      }),
    )

    // Strava webhook subscription is created after httpd.listen() so the
    // server is ready to respond to Strava's verification GET request.
    const stravaWebhookCallbackUrl = `${apiBaseUrl}/webhooks/strava`
    const ensureStravaWebhook = () =>
      getStravaCredentials()
        .then(({ clientId, clientSecret }) => {
          const stravaWebhookMgr = createStravaWebhookManager({
            callbackUrl: stravaWebhookCallbackUrl,
            clientId,
            clientSecret,
            verifyToken: stravaVerifyToken,
          })
          return stravaWebhookMgr.ensureSubscription()
        })
        .catch((error) => {
          console.warn(
            '⚠️ Strava webhook subscription setup failed:',
            error instanceof Error ? error.message : error,
          )
        })
    postListenCallbacks.push(ensureStravaWebhook)
  }

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
      apiBaseUrl,
      centralDb,
      ouraClientId,
      ouraClientSecret,
      syncOuraDataTypeForUser,
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

  // Initialize geocode queue (uses shared boss)
  let geocodeQueue: Awaited<ReturnType<typeof createGeocodeQueue>> | null = null
  if (boss) {
    try {
      geocodeQueue = await createGeocodeQueue(boss, { updateDetectedLocation })
    } catch (error) {
      console.error('Failed to initialize geocode queue:', error)
    }
  }
  if (!geocodeQueue) {
    console.warn('⚠️ Geocoding disabled - detected locations will not be reverse geocoded')
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
  // /tags routes removed: tags are now activities
  httpd.use('/icons', createIconsRouter(authMiddleware))
  httpd.use('/notes', createNotesRouter(authMiddleware))
  httpd.use('/meals', createMealsRouter(authMiddleware))
  httpd.use('/food-items', createFoodItemsRouter(authMiddleware))
  httpd.use('/reports', createReportsRouter(authMiddleware))
  httpd.use(
    createActivitiesRouter(
      authMiddleware,
      syncProvider,
      activityNotifier,
      async (user, activityId, garminActivityId) => {
        const detail = await garmin.getActivityDetail(user, garminActivityId)
        const points = await processActivityDetail(user, detail)
        await markActivityDetailSynced(user, activityId)
        return points
      },
    ),
  )
  httpd.use('/activity-types', createActivityTypesRouter(authMiddleware))
  httpd.use(
    '/deduction-rules',
    createDeductionRulesRouter(authMiddleware, engineDeps, deductionQueue ?? undefined),
  )
  httpd.use('/locations', createLocationsRouter(authMiddleware))
  httpd.use(createSettingsRouter(authMiddleware))
  httpd.use(createAuditLogRouter(authMiddleware))
  httpd.use('/dashboard', createDashboardRouter(authMiddleware))
  httpd.use('/correlations', createCorrelationsRouter(authMiddleware, syncProvider))
  httpd.use('/training-load', createTrainingLoadRouter(authMiddleware))
  httpd.use('/trends', createTrendsRouter(authMiddleware))
  httpd.use('/chart-data', createChartDataRouter(authMiddleware))
  httpd.use('/screentime-categories', createScreentimeCategoriesRouter(authMiddleware))
  httpd.use('/lastfm', createScrobblesRouter(authMiddleware))
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
  // Centralized error handler
  // ==========================================================================

  httpd.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    const status = isHttpError(err) ? err.status : 500
    if (status >= 500) console.error(err)

    if (req.user) {
      auditError(req.user, 'system', `${req.method} ${req.path}: ${err.message}`, {
        status,
        ...(status >= 500 && { stack: err.stack }),
      })
    }

    res.status(status).json({ success: false, error: err.message })
  })

  // ==========================================================================
  // Server startup
  // ==========================================================================

  const port = Number(process.env.PORT ?? 80)
  const server = httpd.listen(port, () => {
    console.info(`> Running on localhost:${port}`)
    for (const cb of postListenCallbacks) {
      cb().catch(() => {})
    }
  })

  // Graceful shutdown
  const shutdown = async () => {
    console.info('Shutting down...')
    detectionTrigger.clearPendingDetections()
    if (ouraWebhookManager) {
      ouraWebhookManager.shutdown()
    }
    if (boss) {
      await boss.stop()
    }
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err)
        else resolve()
      })
    })
    console.info('Server closed')
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main()
