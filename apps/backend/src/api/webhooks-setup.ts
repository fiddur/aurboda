/**
 * Webhook integrations: Strava push (always-on when stravaQueue available) and
 * Oura push (admin-configurable). Returns post-listen callbacks that need to
 * run after `httpd.listen()` so the server is reachable when external
 * verification requests arrive.
 */
import type { Express } from 'express'

import type { ouraClient } from '../integrations/oura/client.ts'
import type { OuraDataType } from '../integrations/oura/sync.ts'
import type { CentralDb } from '../services/central-db.ts'
import type { OuraWebhookManager } from '../services/oura-webhook-manager.ts'
import type { StravaQueue } from '../services/strava-queue.ts'

import { softDeleteActivityByExternalId, upsertOAuthToken } from '../db/index.ts'
import { syncOuraDataType } from '../integrations/oura/sync.ts'
import { createStravaWebhookRouter } from '../integrations/strava/webhook-router.ts'
import { auditInfo } from '../services/audit-log.ts'
import { createOuraWebhookManager } from '../services/oura-webhook-manager.ts'
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
}: StravaWebhookSetupDeps): (() => Promise<void>) => {
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
}: OuraWebhookSetupDeps): Promise<OuraWebhookManager> => {
  const syncOuraDataTypeForUser = async (username: string, dataType: OuraDataType) => {
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

  // Enable if previously configured and host supports it
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
