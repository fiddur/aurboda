/**
 * Express server entry point.
 *
 * Setup is split across helpers in `api/`:
 *   - middleware.ts  — audit log, auth, admin
 *   - auth-routes.ts — /version, /status, /signup, /login, /auth/token
 *   - oauth-routes.ts — Garmin / Strava / Oura connect+disconnect
 *   - sync-setup.ts  — `/sync` router wiring
 *   - webhooks-setup.ts — Strava + Oura push integrations
 *   - rest-routes.ts — per-domain REST router mounts
 *
 * This file orchestrates: clients, queues, central DB, auth, error handler,
 * server lifecycle.
 */
import cors from 'cors'
import express, { json, type NextFunction, type Request, type Response } from 'express'
import { Client } from 'pg'

import { registerAuthRoutes } from './api/auth-routes.ts'
import { createAdminMiddleware, createAuditLogMiddleware, createAuthMiddleware } from './api/middleware.ts'
import { registerOAuthRoutes } from './api/oauth-routes.ts'
import { mountRestRouters } from './api/rest-routes.ts'
import { mountSyncRouter } from './api/sync-setup.ts'
import { setupOuraWebhook, setupStravaWebhook } from './api/webhooks-setup.ts'
import { createAuth } from './auth.ts'
import {
  deleteRuleActivities,
  getDeductionRulesByIds,
  getDetectedLocationById,
  getEnabledDeductionRules,
  getNamedLocations,
  insertActivities,
  insertActivity,
  insertLocation,
  insertLocations,
  insertPlace,
  insertRawRecord,
  insertTimeSeries,
  loginToUserDb,
  resolveOrCreateActivityType,
  softDeleteLocationRange,
  updateDetectedLocation,
  upsertSyncState,
} from './db/index.ts'
import { httpError, isHttpError } from './http-error.ts'
import { garminClient } from './integrations/garmin/client.ts'
import { ouraClient } from './integrations/oura/client.ts'
import { createOwnTracksRouter } from './integrations/owntracks/router.ts'
import { stravaClient } from './integrations/strava/client.ts'
import { createMcpRouter } from './mcp.ts'
import { createOAuthRouter } from './routes/oauth-router.ts'
import { auditError } from './services/audit-log.ts'
import { triggerCalorieComputation } from './services/calorie-computation.ts'
import { createCalorieQueue, type CalorieQueue } from './services/calorie-queue.ts'
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
import { getPlaceVisits } from './services/locations.ts'
import { createPgBoss } from './services/pg-boss.ts'
import { initSentry, Sentry } from './services/sentry.ts'
import { createStravaQueue, type StravaQueue } from './services/strava-queue.ts'
import { createSyncProvider } from './services/sync-provider.ts'
import { createWebAuthnService } from './services/webauthn.ts'

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

  // Initialize Sentry as early as possible after centralDb is available.
  // DSN is read from server_settings (configured via Admin Settings).
  await initSentry(centralDb)

  const webHost = process.env.WEB_HOST ?? 'http://localhost:5173'
  const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:3000'
  console.info(`🌐 WEB_HOST=${webHost} API_BASE_URL=${apiBaseUrl}`)

  // WebAuthn / passkey configuration. The Relying Party ID must match the
  // origin the user's browser sees (i.e. the web host) — not the API host,
  // which can be on a different subdomain.
  const deriveHost = (url: string, label: string): string => {
    try {
      return new URL(url).hostname
    } catch {
      console.warn(
        `⚠️ Could not parse ${label}=${url} for WebAuthn RP ID; falling back to "localhost". ` +
          `Set WEBAUTHN_RP_ID explicitly to silence this.`,
      )
      return 'localhost'
    }
  }
  const rpID = process.env.WEBAUTHN_RP_ID ?? deriveHost(webHost, 'WEB_HOST')
  const rpName = process.env.WEBAUTHN_RP_NAME ?? 'Aurboda'
  const expectedOrigins = (process.env.WEBAUTHN_ORIGINS ?? webHost)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const webAuthn = createWebAuthnService({ expectedOrigins, rpID, rpName }, centralDb)
  console.info(`🔐 WebAuthn rpID=${rpID} origins=${expectedOrigins.join(',')}`)

  const androidPackageName = process.env.ANDROID_APP_PACKAGE ?? 'net.aurboda'
  const androidFingerprints = (process.env.ANDROID_APP_FINGERPRINTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const wellKnown = { androidFingerprints, androidPackageName }

  // Migrate legacy OURA_CLIENT/OURA_SECRET env vars into server_settings if DB empty
  const envOuraClientId = process.env.OURA_CLIENT
  const envOuraClientSecret = process.env.OURA_SECRET
  if (envOuraClientId || envOuraClientSecret) {
    const [existingId, existingSecret] = await Promise.all([
      centralDb.getServerSetting('oura_client_id'),
      centralDb.getServerSetting('oura_client_secret'),
    ])
    if (!existingId && envOuraClientId) {
      await centralDb.setServerSetting('oura_client_id', envOuraClientId)
      console.info('Migrated OURA_CLIENT env → server_settings.oura_client_id')
    }
    if (!existingSecret && envOuraClientSecret) {
      await centralDb.setServerSetting('oura_client_secret', envOuraClientSecret)
      console.info('Migrated OURA_SECRET env → server_settings.oura_client_secret')
    }
    console.info('DEPRECATION: OURA_CLIENT/OURA_SECRET envs are deprecated. Use Admin Settings.')
  }

  const getOuraCredentials = async () => {
    const [clientId, clientSecret] = await Promise.all([
      centralDb.getServerSetting('oura_client_id'),
      centralDb.getServerSetting('oura_client_secret'),
    ])
    if (!clientId || !clientSecret) {
      throw new Error('Oura not configured — set credentials in Admin Settings')
    }
    return { clientId, clientSecret }
  }

  const oura = ouraClient(getOuraCredentials, apiBaseUrl, {
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

  // Deduction queue is assigned once pg-boss is up (below). The notifier closes
  // over the variable, so it starts enqueuing as soon as the queue exists.
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

  // Create sync provider for auto-syncing data before queries. onActivitySynced
  // lets background scrobble syncs trigger deduction rules (e.g. auto-tagging),
  // like the REST /sync routes — here fired only when a sync ingests new data.
  const syncProvider = createSyncProvider({
    garmin,
    getLastFmApiKey: () => centralDb.getLastFmApiKey(),
    oura,
    onActivitySynced: activityNotifier,
  })

  // Initialize shared pg-boss instance and job queues (before MCP mount)
  const boss = await createPgBoss()

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

  // Initialize calorie computation queue (uses shared boss).
  // Without this, HR ingestion falls back to fire-and-forget which still
  // returns the response fast but loses the cross-instance batching.
  let calorieQueue: CalorieQueue | null = null
  if (boss) {
    try {
      calorieQueue = await createCalorieQueue(boss, { triggerCalorieComputation })
    } catch (error) {
      console.error('Failed to initialize calorie queue:', error)
    }
  }
  if (!calorieQueue) {
    console.warn('⚠️ Calorie queue disabled - HR ingestion will fire-and-forget computation')
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

  // Audit-log middleware: records non-GET requests with response status / body
  httpd.use(createAuditLogMiddleware(auth))

  const authMiddleware = createAuthMiddleware(auth, unauthorized)
  const adminMiddleware = createAdminMiddleware(centralDb, unauthorized, forbidden)

  // Auth-related routes (version, status, signup, login, /auth/token)
  registerAuthRoutes({
    httpd,
    auth,
    authMiddleware,
    centralDb,
    invitationAuth,
    userDb,
    unauthorized,
  })

  // /sync router (cross-provider sync orchestration)
  mountSyncRouter({
    httpd,
    authMiddleware,
    centralDb,
    oura,
    garmin,
    stravaQueue,
    calorieQueue,
    activityNotifier,
  })

  // Per-provider OAuth/connect endpoints
  registerOAuthRoutes({
    httpd,
    authMiddleware,
    centralDb,
    garmin,
    oura,
    strava,
  })

  // Strava webhook push integration
  if (stravaQueue) {
    const ensureStravaWebhook = setupStravaWebhook({
      httpd,
      apiBaseUrl,
      sessionSecret,
      centralDb,
      stravaQueue,
      getStravaCredentials,
    })
    postListenCallbacks.push(ensureStravaWebhook)
  }

  // Oura webhook push integration (admin-configurable via Web UI)
  const ouraWebhookManager = await setupOuraWebhook({
    httpd,
    apiBaseUrl,
    centralDb,
    oura,
    getOuraCredentials,
  })

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

  // Create detection trigger with geocode queue. The proactive
  // location_visit materialization piggy-backs on this same debounced
  // post-GPS-ingestion path (see #654).
  const detectionTrigger: DetectionTrigger = createDetectionTrigger({
    geocodeQueue,
    getDetectedLocationById,
    getNamedLocations,
    getPlaceVisits,
    insertActivities,
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

  // Per-domain REST routers
  mountRestRouters({
    activityNotifier,
    adminMiddleware,
    auth,
    authMiddleware,
    centralDb,
    deductionQueue,
    engineDeps,
    garmin,
    httpd,
    invitationAuth,
    ouraWebhookManager,
    syncProvider,
    userDb,
    webAuthn,
    webHost,
    wellKnown,
  })

  // Sentry must be registered AFTER all controllers and BEFORE any other
  // error middleware. No-op if Sentry was not initialized.
  Sentry.setupExpressErrorHandler(httpd)

  // Centralized error handler
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

  // Server startup
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
