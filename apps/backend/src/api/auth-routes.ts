/**
 * These stay close to server setup (vs being moved into a Router) because they
 * directly use the central DB, user DB connection, and the Auth instance.
 */
import type {
  AuthTokenResponse,
  LoginResponse,
  ServerStatusResponse,
  SignupBody,
  SignupResponse,
  VersionResponse,
} from '@aurboda/api-spec'
import type { Express } from 'express'
import type { Client } from 'pg'

import { signupBodySchema } from '@aurboda/api-spec'

import type { Auth } from '../auth.ts'
import type { CentralDb } from '../services/central-db.ts'
import type { InvitationAuth } from '../services/invitation.ts'
import type { AnyMiddleware } from '../typed-router.ts'

import { isInvalidPasswordError, loginToUserDb, makeNewUserDb, query } from '../db/index.ts'
import { httpError } from '../http-error.ts'
import { readBillingSettings, recordNewAccount } from '../services/account-plan.ts'
import { pruneAuditLog } from '../services/audit-log.ts'
import { readOfficialFeedSetting } from '../services/official-feed.ts'
import { readPublicTagPages } from '../services/public-tags.ts'
import { defaultSignupProfileDeps, saveSignupProfile } from '../services/signup-profile.ts'
import { readSupportContacts } from '../services/support-contacts.ts'
import { validateBody } from '../validation.ts'

interface AuthRoutesDeps {
  httpd: Express
  auth: Auth
  authMiddleware: AnyMiddleware
  centralDb: CentralDb
  invitationAuth: InvitationAuth
  userDb: Client
  unauthorized: Error
  userExists: (username: string) => Promise<boolean>
}

export const RESERVED_USERNAMES = [
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
  'tags',
]

/**
 * Username format: a valid lowercase PostgreSQL role name. This also selects
 * which per-user database a request connects to, so any caller that resolves a
 * username to a database (e.g. public sharing routes) MUST validate against
 * this same rule — reuse `isValidUsername` rather than re-declaring the regex.
 */
export const USERNAME_REGEX = /^[a-z][a-z0-9_]{2,30}$/

/** True when `user` is a well-formed, non-reserved username. */
export const isValidUsername = (user: string): boolean =>
  USERNAME_REGEX.test(user) && !RESERVED_USERNAMES.includes(user)

export const registerAuthRoutes = ({
  httpd,
  auth,
  authMiddleware,
  centralDb,
  invitationAuth,
  userDb,
  unauthorized,
  userExists,
}: AuthRoutesDeps): void => {
  httpd.get<Record<string, never>, VersionResponse>('/version', (_req, res) => {
    res.json({
      build_sha: process.env.BUILD_SHA ?? 'dev',
      success: true,
    })
  })

  httpd.get<Record<string, never>, ServerStatusResponse>('/status', async (_req, res) => {
    const [signupMode, officialFeed, billing, publicTagPages, contacts] = await Promise.all([
      centralDb.getSignupMode(),
      readOfficialFeedSetting(centralDb),
      readBillingSettings(centralDb),
      readPublicTagPages(centralDb),
      readSupportContacts(centralDb),
    ])
    const officialFeedLive =
      officialFeed.remote_authors.length > 0 ||
      (await Promise.all(officialFeed.users.map(userExists))).some(Boolean)
    res.json({
      billing_enabled: billing.enabled,
      contact_fediverse: contacts.contact_fediverse || null,
      contact_reddit: contacts.contact_reddit || null,
      federation: true,
      official_feed: officialFeedLive,
      product: 'aurboda',
      public_tag_pages: publicTagPages,
      signup_allowed: signupMode === 'open',
      signup_mode: signupMode,
      success: true,
      version: process.env.BUILD_SHA ?? 'dev',
      ...(billing.enabled && { price_text: billing.price_text || null, trial_days: billing.trial_days }),
    })
  })

  httpd.post<Record<string, never>, SignupResponse, SignupBody>(
    '/signup',
    validateBody(signupBodySchema),
    async (req, res, next) => {
      const signupMode = await centralDb.getSignupMode()

      if (signupMode === 'closed') {
        res.status(403).json({ error: 'Signup is currently closed', success: false })
        return
      }

      const { username: user, password, invitation: invite } = req.body

      if (signupMode === 'invite_only') {
        if (!invite) {
          res.status(403).json({
            error: 'An invitation is required to sign up',
            success: false,
          })
          return
        }
        const validation = invitationAuth.validateInvitationToken(invite)
        if (!validation.valid) {
          const errorMsg = validation.expired ? 'Invitation has expired' : 'Invalid invitation'
          res.status(403).json({ error: errorMsg, success: false })
          return
        }
      }

      if (!USERNAME_REGEX.test(user)) {
        res.status(400).json({
          error:
            'Username must be 3-31 characters, start with a letter, and contain only lowercase letters, numbers, and underscores',
          success: false,
        })
        return
      }

      if (RESERVED_USERNAMES.includes(user)) {
        res.status(400).json({ error: 'This username is reserved', success: false })
        return
      }

      const existingUser = await query(userDb, 'SELECT usename FROM pg_user WHERE usename=$1', [user])
      if ((existingUser.rowCount && existingUser.rowCount > 0) || (await centralDb.isUsernameDeleted(user))) {
        res.status(409).json({ error: 'Username already exists', success: false })
        return
      }

      try {
        await makeNewUserDb(userDb, user, password)
        await recordNewAccount(centralDb, user).catch((e) =>
          console.error(`⚠️ Failed to record account row for ${user}:`, e),
        )
        await saveSignupProfile(defaultSignupProfileDeps(centralDb), user, {
          display_name: req.body.display_name,
          email: req.body.email,
        })
        const token = auth.createToken(user)

        const adminCount = await centralDb.getAdminCount()
        let isAdmin = false
        if (adminCount === 0) {
          await centralDb.addAdmin(user)
          isAdmin = true
          console.info(`First user ${user} automatically made admin`)
        }

        res.json({ is_admin: isAdmin, success: true, token })
      } catch (err) {
        if ((err as { code?: string }).code === '42710') {
          res.status(409).json({ error: 'Username already exists', success: false })
          return
        }
        console.error('Signup error:', err)
        next(err)
      }
    },
  )

  httpd.post<Record<string, never>, LoginResponse>('/login', async (req, res, next) => {
    const { username, password } = req.body
    const user = typeof username === 'string' ? username.trim() : username
    // An empty password must be rejected here, not passed down: `pg` treats
    // '' as unset and falls back to the service role's PGPASSWORD from the
    // environment, so the connection attempt would not be this user's at all.
    if (!user || typeof user !== 'string' || !password || typeof password !== 'string') {
      return next(unauthorized)
    }

    const userRows = await query(userDb, 'SELECT usename FROM pg_user WHERE usename=$1', [user])
    if (userRows.rowCount !== 1) return next(unauthorized)

    // Only a password Postgres itself rejects is a failed login; anything else
    // is a server fault. Those are logged here and answered 503, because the
    // central handler replies with `err.message` and a pg failure's message
    // names internal hosts, database names and connection limits.
    try {
      await loginToUserDb(user, password)
    } catch (err) {
      if (isInvalidPasswordError(err)) return next(unauthorized)
      console.error(`Login for ${user} failed to reach the database (not a bad password):`, err)
      return next(httpError(503, 'Service unavailable'))
    }

    // No schema work here. Login only authenticates: the deploy-time sweep and
    // the auth middleware migrate, and `query()` repairs drift lazily when a
    // statement hits a schema error (#1125).
    const token = auth.createToken(user)
    const isAdmin = await centralDb.isAdmin(user)

    centralDb
      .getAuditLogRetentionDays()
      .then((days) => pruneAuditLog(user, days))
      .catch(() => {})

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ is_admin: isAdmin, token }))
  })

  // Generate a fresh API token for the authenticated user (e.g. for push agents like ActivityWatch)
  httpd.get<Record<string, never>, AuthTokenResponse>('/auth/token', authMiddleware, (req, res) => {
    const user = req.user!
    const token = auth.createToken(user)
    res.json({ success: true, token })
  })
}
