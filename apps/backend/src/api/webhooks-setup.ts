/**
 * Webhook integrations: Strava push (always-on when stravaQueue available),
 * Oura push (admin-configurable) and the Garmin Developer Program push. Returns post-listen callbacks that need to
 * run after `httpd.listen()` so the server is reachable when external
 * verification requests arrive.
 */
import type { Express } from 'express'

import type { GarminOAuthClient } from '../integrations/garmin/oauth-client.ts'
import type { ouraClient } from '../integrations/oura/client.ts'
import type { OuraDataType } from '../integrations/oura/sync.ts'
import type { CentralDb } from '../services/central-db.ts'
import type { OuraWebhookManager } from '../services/oura-webhook-manager.ts'
import type { StravaQueue } from '../services/strava-queue.ts'

import {
  insertRawRecords,
  insertTimeSeries,
  softDeleteActivityByExternalId,
  updateOAuthTokenScopes,
  upsertOAuthToken,
  upsertSyncState,
} from '../db/index.ts'
import { GARMIN_OAUTH_PROVIDER } from '../integrations/garmin/oauth-status.ts'
import { defaultGarminProcessDeps, processGarminData } from '../integrations/garmin/process.ts'
import { createGarminPushRouter } from '../integrations/garmin/push-router.ts'
import { createSerialQueue, garminPushToken, receiveGarminPush } from '../integrations/garmin/push.ts'
import { syncOuraDataType } from '../integrations/oura/sync.ts'
import { createStravaWebhookRouter } from '../integrations/strava/webhook-router.ts'
import { auditError, auditInfo, auditWarn } from '../services/audit-log.ts'
import { createOuraWebhookManager } from '../services/oura-webhook-manager.ts'
import { getSettings } from '../services/settings.ts'
import { createStravaWebhookManager } from '../services/strava-webhook-manager.ts'

type OuraClient = ReturnType<typeof ouraClient>
type StravaCredentialGetter = () => Promise<{ clientId: string; clientSecret: string }>

interface StravaWebhookSetupDeps {
  httpd: Express
  apiBaseUrl: string
  sessionSecret: string
  centralDb: CentralDb
  stravaQueue: StravaQueue
  getStravaCredentials: StravaCredentialGetter
  /** Events for a read-only account are acknowledged but not processed. */
  isReadOnly?: (user: string) => Promise<boolean>
}

/**
 * Mount the Strava webhook router and return a post-listen callback that
 * ensures the Strava webhook subscription exists. The callback must run after
 * `httpd.listen()` so Strava's GET verification request can reach us.
 */
export const setupStravaWebhook = ({
  httpd,
  apiBaseUrl,
  sessionSecret,
  centralDb,
  stravaQueue,
  getStravaCredentials,
  isReadOnly = async () => false,
}: StravaWebhookSetupDeps): (() => Promise<void>) => {
  const stravaVerifyToken = `aurboda-strava-${sessionSecret.slice(0, 8)}`

  httpd.use(
    '/webhooks/strava',
    createStravaWebhookRouter({
      enqueueActivityFetch: async (user, activityId, priority) => {
        if (await isReadOnly(user)) return
        await stravaQueue.enqueueActivityFetch(user, activityId, priority)
      },
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
        if (await isReadOnly(user)) return
        await softDeleteActivityByExternalId(user, 'strava', `strava-activity-${stravaActivityId}`)
      },
      verifyToken: stravaVerifyToken,
    }),
  )

  const stravaWebhookCallbackUrl = `${apiBaseUrl}/webhooks/strava`
  return () =>
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
}

interface OuraWebhookSetupDeps {
  httpd: Express
  apiBaseUrl: string
  centralDb: CentralDb
  oura: OuraClient
  getOuraCredentials: () => Promise<{ clientId: string; clientSecret: string }>
  /** Events for a read-only account are acknowledged but not processed. */
  isReadOnly?: (user: string) => Promise<boolean>
}

/**
 * Mount the Oura webhook proxy handler and return the manager. Caller is
 * expected to enable the subscription if previously enabled and the host
 * supports it (this is async + needs central-DB access, so we don't do it
 * automatically).
 */
export const setupOuraWebhook = async ({
  httpd,
  apiBaseUrl,
  centralDb,
  oura,
  getOuraCredentials,
  isReadOnly = async () => false,
}: OuraWebhookSetupDeps): Promise<OuraWebhookManager> => {
  const syncOuraDataTypeForUser = async (username: string, dataType: OuraDataType) => {
    if (await isReadOnly(username)) return
    const accessToken = await oura.getAccessToken(username)
    await syncOuraDataType(username, oura, dataType, accessToken)
  }

  const ouraWebhookManager: OuraWebhookManager = createOuraWebhookManager({
    apiBaseUrl,
    centralDb,
    getCredentials: getOuraCredentials,
    syncOuraDataTypeForUser,
  })

  // Mount proxy handler (delegates to inner router when enabled, 404 when disabled)
  httpd.use('/webhooks/oura', (req, res, next) => ouraWebhookManager.handleWebhookRequest(req, res, next))

  const ouraWebhookEnabled = await centralDb.getOuraWebhookEnabled()
  if (ouraWebhookEnabled && (await ouraWebhookManager.canEnable())) {
    try {
      await ouraWebhookManager.enable()
    } catch (error) {
      console.error('Oura webhook: failed to enable on startup:', error)
    }
  }

  return ouraWebhookManager
}

interface GarminPushSetupDeps {
  httpd: Express
  sessionSecret: string
  centralDb: CentralDb
  garminOAuth: GarminOAuthClient
  /** Pushes for a read-only account are acknowledged but not stored. */
  isReadOnly?: (user: string) => Promise<boolean>
}

/** The pull's raw records hold the pull's shapes: the push stores its own and never overwrites them. */
const pushProcessDeps = { ...defaultGarminProcessDeps, insertRawRecord: async () => {} }

/** Mounts the endpoint Garmin pushes every summary type to (`garminPushUrl`). */
export const setupGarminPush = ({
  httpd,
  sessionSecret,
  centralDb,
  garminOAuth,
  isReadOnly = async () => false,
}: GarminPushSetupDeps): void => {
  const enqueue = createSerialQueue((error) => {
    console.error('Garmin push: processing failed:', error instanceof Error ? error.message : error)
  })
  const pushToken = garminPushToken(sessionSecret)

  httpd.use(
    '/webhooks/garmin',
    createGarminPushRouter({
      enqueue,
      logError: (message) => console.error(message),
      receive: (request) =>
        receiveGarminPush(
          {
            auditError,
            auditInfo,
            auditWarn,
            forgetGrant: (user) => garminOAuth.forget(user),
            getClientId: () => centralDb.getServerSetting('garmin_client_id'),
            getDisabledDataTypes: async (user) => (await getSettings(user)).garmin_disabled_data_types ?? [],
            getUsernameByGarminUserId: (garminUserId) => centralDb.getUsernameByGarminUserId(garminUserId),
            insertRawRecords,
            insertTimeSeries,
            isReadOnly,
            logWarn: (message) => console.warn(message),
            now: () => new Date(),
            probeGrant: (user) => garminOAuth.probeGrant(user),
            processGarminData: (user, dataType, data) =>
              processGarminData(user, dataType, data, pushProcessDeps),
            pushToken,
            updateGrantScopes: (user, scopes) => updateOAuthTokenScopes(user, GARMIN_OAUTH_PROVIDER, scopes),
            upsertSyncState,
          },
          request,
        ),
    }),
  )
}
