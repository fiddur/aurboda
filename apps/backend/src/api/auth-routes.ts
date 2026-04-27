/**
 * Auth-related HTTP routes: /version, /status, /signup, /login, /auth/token.
 * These stay close to server setup (vs being moved into a Router) because they
 * directly use the central DB, user DB connection, and the Auth instance.
 */
import type {
  AuthTokenResponse,
  LoginResponse,
  ServerStatusResponse,
  SignupResponse,
  VersionResponse,
} from '@aurboda/api-spec'
import type { Express } from 'express'
import type { Client } from 'pg'

import type { Auth } from '../auth.ts'
import type { CentralDb } from '../services/central-db.ts'
import type { InvitationAuth } from '../services/invitation.ts'
import type { AnyMiddleware } from '../typed-router.ts'

import {
  initializeSchema,
  loginToUserDb,
  makeNewUserDb,
  migrateSchema,
  query,
  schemaInitialized,
} from '../db/index.ts'
import { pruneAuditLog } from '../services/audit-log.ts'

interface AuthRoutesDeps {
  httpd: Express
  auth: Auth
  authMiddleware: AnyMiddleware
  centralDb: CentralDb
  invitationAuth: InvitationAuth
  userDb: Client
  unauthorized: Error
}

const RESERVED_USERNAMES = [
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

export const registerAuthRoutes = ({
  httpd,
  auth,
  authMiddleware,
  centralDb,
  invitationAuth,
  userDb,
  unauthorized,
}: AuthRoutesDeps): void => {
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

    if (RESERVED_USERNAMES.includes(user)) {
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
    res.end(JSON.stringify({ is_admin: isAdmin, token }))
  })

  // Generate a fresh API token for the authenticated user (e.g. for push agents like ActivityWatch)
  httpd.get<Record<string, never>, AuthTokenResponse>('/auth/token', authMiddleware, (req, res) => {
    const user = req.user!
    const token = auth.createToken(user)
    res.json({ success: true, token })
  })
}
