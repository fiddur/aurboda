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
import type { FailedLogins } from './rate-limit-middleware.ts'

import { isInvalidPasswordError, loginToUserDb, makeNewUserDb, query } from '../db/index.ts'
import { httpError } from '../http-error.ts'
import { readBillingSettings } from '../services/account-plan.ts'
import { type AccountSignupDeps, createAccount } from '../services/account-signup.ts'
import { appVersion } from '../services/app-version.ts'
import { pruneAuditLog } from '../services/audit-log.ts'
import { isEmailConfigured } from '../services/email.ts'
import { notifier, notifyAdminsOfSignup } from '../services/notifications.ts'
import { readOfficialFeedSetting } from '../services/official-feed.ts'
import { readPublicTagPages } from '../services/public-tags.ts'
import { tooManyFailedLoginsMessage } from '../services/rate-limit.ts'
import { defaultSignupProfileDeps } from '../services/signup-profile.ts'
import { readSupportContacts } from '../services/support-contacts.ts'
import { validateBody } from '../validation.ts'
import { sendTooManyRequests } from './rate-limit-middleware.ts'

interface AuthRoutesDeps {
  httpd: Express
  auth: Auth
  authMiddleware: AnyMiddleware
  centralDb: CentralDb
  failedLogins: FailedLogins
  invitationAuth: InvitationAuth
  userDb: Client
  unauthorized: Error
  userExists: (username: string) => Promise<boolean>
  /** Sends the verification link to a just-signed-up account's email, in the background. */
  startEmailVerification?: (username: string) => void
}

export { isValidUsername, RESERVED_USERNAMES, USERNAME_REGEX } from '../services/account-signup.ts'

/** The account creation `/signup` uses, for the other ways to sign up. */
export const accountSignupDeps = ({
  auth,
  centralDb,
  invitationAuth,
  userDb,
  startEmailVerification,
}: Pick<
  AuthRoutesDeps,
  'auth' | 'centralDb' | 'invitationAuth' | 'userDb' | 'startEmailVerification'
>): AccountSignupDeps => ({
  centralDb,
  createToken: (username) => auth.createToken(username),
  invitationAuth,
  makeNewUserDb: (username, password) => makeNewUserDb(userDb, username, password),
  notifyAdmins: (username) =>
    void notifyAdminsOfSignup({
      getAdmins: centralDb.getAdmins,
      raiseBestEffort: notifier.raiseBestEffort,
    })(username),
  roleExists: async (username) => {
    const existing = await query(userDb, 'SELECT usename FROM pg_user WHERE usename=$1', [username])
    return (existing.rowCount ?? 0) > 0
  },
  signupProfile: defaultSignupProfileDeps(centralDb, startEmailVerification),
})

export const registerAuthRoutes = ({
  httpd,
  auth,
  authMiddleware,
  centralDb,
  failedLogins,
  invitationAuth,
  userDb,
  unauthorized,
  userExists,
  startEmailVerification,
}: AuthRoutesDeps): void => {
  const signupDeps = accountSignupDeps({ auth, centralDb, invitationAuth, startEmailVerification, userDb })

  httpd.get<Record<string, never>, VersionResponse>('/version', (_req, res) => {
    res.json({
      build_sha: process.env.BUILD_SHA ?? 'dev',
      success: true,
    })
  })

  httpd.get<Record<string, never>, ServerStatusResponse>('/status', async (_req, res) => {
    const [signupMode, officialFeed, billing, publicTagPages, contacts, emailEnabled] = await Promise.all([
      centralDb.getSignupMode(),
      readOfficialFeedSetting(centralDb),
      readBillingSettings(centralDb),
      readPublicTagPages(centralDb),
      readSupportContacts(centralDb),
      isEmailConfigured(centralDb),
    ])
    const officialFeedLive =
      officialFeed.remote_authors.length > 0 ||
      (await Promise.all(officialFeed.users.map(userExists))).some(Boolean)
    res.json({
      billing_enabled: billing.enabled,
      contact_fediverse: contacts.contact_fediverse || null,
      contact_reddit: contacts.contact_reddit || null,
      email_enabled: emailEnabled,
      federation: true,
      official_feed: officialFeedLive,
      product: 'aurboda',
      public_tag_pages: publicTagPages,
      signup_allowed: signupMode === 'open',
      signup_mode: signupMode,
      success: true,
      version: appVersion(),
      ...(billing.enabled && { price_text: billing.price_text || null, trial_days: billing.trial_days }),
    })
  })

  httpd.post<Record<string, never>, SignupResponse, SignupBody>(
    '/signup',
    validateBody(signupBodySchema),
    async (req, res, next) => {
      const { username, password, invitation, display_name, email } = req.body
      try {
        const result = await createAccount(signupDeps, {
          display_name,
          email,
          invitation,
          password,
          username,
        })
        if (!result.ok) {
          res.status(result.status).json({ error: result.error, success: false })
          return
        }
        res.json({ is_admin: result.is_admin, success: true, token: result.token })
      } catch (err) {
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

    const attempt = failedLogins.begin(req, user)
    if (!attempt.allowed) {
      const wait = attempt.retry_after_seconds
      return sendTooManyRequests(res, wait, tooManyFailedLoginsMessage(wait))
    }

    const userRows = await query(userDb, 'SELECT usename FROM pg_user WHERE usename=$1', [user]).catch(
      (err: unknown) => {
        attempt.inconclusive()
        throw err
      },
    )
    if (userRows.rowCount !== 1) return next(unauthorized)

    // Only a password Postgres itself rejects is a failed login; anything else
    // is a server fault. Those are logged here and answered 503, because the
    // central handler replies with `err.message` and a pg failure's message
    // names internal hosts, database names and connection limits.
    try {
      await loginToUserDb(user, password)
    } catch (err) {
      if (isInvalidPasswordError(err)) return next(unauthorized)
      attempt.inconclusive()
      console.error(`Login for ${user} failed to reach the database (not a bad password):`, err)
      return next(httpError(503, 'Service unavailable'))
    }

    // No schema work here. Login only authenticates: the deploy-time sweep and
    // the auth middleware migrate, and `query()` repairs drift lazily when a
    // statement hits a schema error (#1125).
    attempt.succeeded()
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
