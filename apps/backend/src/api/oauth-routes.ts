import type { Express } from 'express'

import { connectGarminPersonalKeyBodySchema } from '@aurboda/api-spec'

import type { GarminClient } from '../integrations/garmin/source.ts'
import type { GravlClient } from '../integrations/gravl/client.ts'
import type { ouraClient } from '../integrations/oura/client.ts'
import type { StravaClient } from '../integrations/strava/client.ts'

import { redactSecret } from '../integrations/garmin/client.ts'
import { type GarminPersonalClient, GarminKeyRefusedError } from '../integrations/garmin/personal-client.ts'
import { readGarminPersonalKeyEnabled } from '../integrations/garmin/source.ts'

type OuraClient = ReturnType<typeof ouraClient>
import type { CentralDb } from '../services/central-db.ts'
import type { AnyMiddleware } from '../typed-router.ts'

import { markNotificationsReadByType, resetSyncState, upsertOAuthToken } from '../db/index.ts'
import { auditError, auditInfo } from '../services/audit-log.ts'
import { validateBody } from '../validation.ts'

interface OAuthRoutesDeps {
  httpd: Express
  authMiddleware: AnyMiddleware
  centralDb: CentralDb
  garmin: GarminClient
  garminPersonal: GarminPersonalClient
  gravl: GravlClient
  oura: OuraClient
  strava: StravaClient
  markNotificationsReadByType?: (user: string, type: string) => Promise<number>
}

export const registerOAuthRoutes = ({
  httpd,
  authMiddleware,
  centralDb,
  garmin,
  garminPersonal,
  gravl,
  oura,
  strava,
  markNotificationsReadByType: markReadByType = (user, type) => markNotificationsReadByType(user, type),
}: OAuthRoutesDeps): void => {
  const clearGarminKeyReminders = async (user: string): Promise<void> => {
    try {
      await markReadByType(user, 'garmin_key_expiring')
    } catch (error) {
      auditError(user, 'auth', 'Could not mark Garmin key reminders read', { error: String(error) })
    }
  }

  httpd.get('/auth/oura/connect', authMiddleware, oura.getAuthorizeUrl)
  httpd.get('/auth/ouracb', oura.authCb)

  httpd.post('/auth/oura/disconnect', authMiddleware, async (req, res) => {
    const user = req.user!
    try {
      await oura.disconnect(user)
      await resetSyncState(user, 'oura')
      await centralDb.deleteOuraUserMappingsByUsername(user)
      res.json({ success: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Disconnect failed'
      res.status(500).json({ error: message, success: false })
    }
  })

  // Garmin Connect (login with credentials, tokens-only stored)
  httpd.post('/auth/garmin/login', authMiddleware, async (req, res) => {
    const user = req.user!
    const { email: rawEmail, password } = req.body ?? {}
    const email = typeof rawEmail === 'string' ? rawEmail.trim() : rawEmail

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
      const secret = typeof password === 'string' ? password : ''
      auditError(user, 'auth', 'Garmin login endpoint error', { error: redactSecret(String(error), secret) })
      const message = error instanceof Error ? redactSecret(error.message, secret) : 'Login failed'
      res.status(401).json({ error: message, success: false })
    }
  })

  httpd.post('/auth/garmin/mfa', authMiddleware, async (req, res) => {
    const user = req.user!
    const { mfa_code: rawMfaCode } = req.body ?? {}
    const mfa_code = typeof rawMfaCode === 'string' ? rawMfaCode.trim() : rawMfaCode

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

  httpd.post(
    '/auth/garmin/personal-key',
    authMiddleware,
    validateBody(connectGarminPersonalKeyBodySchema),
    async (req, res) => {
      const user = req.user!
      const { api_key, expires_at } = req.body
      if (!(await readGarminPersonalKeyEnabled(centralDb))) {
        res.status(403).json({
          error: 'Connecting a Garmin Personal API key is turned off on this server',
          success: false,
        })
        return
      }
      if (expires_at < new Date().toISOString().slice(0, 10)) {
        res.status(400).json({ error: 'The expiry date has already passed', success: false })
        return
      }

      try {
        await garminPersonal.connect(user, api_key, new Date(`${expires_at}T00:00:00Z`))
        auditInfo(user, 'auth', 'Garmin Personal API key connected', { expires_at })
        await clearGarminKeyReminders(user)
        res.json({ success: true })
      } catch (error) {
        if (error instanceof GarminKeyRefusedError) {
          auditError(user, 'auth', 'Garmin refused the Personal API key')
          res.status(401).json({ error: 'Garmin refused the key', success: false })
          return
        }
        const message = redactSecret(error instanceof Error ? error.message : String(error), api_key)
        auditError(user, 'auth', 'Garmin Personal API key connect failed', { error: message })
        res.status(502).json({ error: message, success: false })
      }
    },
  )

  httpd.post('/auth/garmin/personal-key/disconnect', authMiddleware, async (req, res) => {
    const user = req.user!
    try {
      await garminPersonal.disconnect(user)
      await clearGarminKeyReminders(user)
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
      await upsertOAuthToken(user, { access_token: '', provider: 'strava' })
      await centralDb.deleteStravaAthleteMappingByUsername(user)
      res.json({ success: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Disconnect failed'
      res.status(500).json({ error: message, success: false })
    }
  })

  // Gravl (OAuth + PKCE; always registered — credentials checked dynamically).
  // A personal token needs no route: it is a plain user setting.
  httpd.get('/auth/gravl/connect', authMiddleware, gravl.getAuthorizeUrl)
  httpd.get('/auth/gravlcb', gravl.authCb)

  httpd.post('/auth/gravl/disconnect', authMiddleware, async (req, res) => {
    const user = req.user!
    try {
      await gravl.disconnect(user)
      res.json({ success: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Disconnect failed'
      res.status(500).json({ error: message, success: false })
    }
  })
}
