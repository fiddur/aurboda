/**
 * Per-provider OAuth/auth endpoints: Oura connect+callback, Garmin login/MFA/disconnect,
 * Strava connect+callback+disconnect. Uses each integration's client + the central DB
 * for credential mapping cleanup.
 */
import type { Express } from 'express'

import type { GarminClient } from '../integrations/garmin/client.ts'
import type { ouraClient } from '../integrations/oura/client.ts'
import type { StravaClient } from '../integrations/strava/client.ts'

type OuraClient = ReturnType<typeof ouraClient>
import type { CentralDb } from '../services/central-db.ts'
import type { AnyMiddleware } from '../typed-router.ts'

import { upsertOAuthToken } from '../db/index.ts'
import { auditError } from '../services/audit-log.ts'

interface OAuthRoutesDeps {
  httpd: Express
  authMiddleware: AnyMiddleware
  centralDb: CentralDb
  garmin: GarminClient
  oura: OuraClient
  strava: StravaClient
}

export const registerOAuthRoutes = ({
  httpd,
  authMiddleware,
  centralDb,
  garmin,
  oura,
  strava,
}: OAuthRoutesDeps): void => {
  // Oura
  httpd.get('/auth/oura/connect', authMiddleware, oura.getAuthorizeUrl)
  httpd.get('/auth/ouracb', oura.authCb)

  // Garmin Connect (login with credentials, tokens-only stored)
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

  // Strava (always registered — credentials checked dynamically)
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
}
