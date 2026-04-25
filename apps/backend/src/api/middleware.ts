/**
 * Express middleware factories for the API server: request audit logging,
 * authentication (Bearer token → req.user), and admin authorization.
 */
import type { RequestHandler } from 'express'

import type { Auth } from '../auth.ts'
import type { CentralDb } from '../services/central-db.ts'
import type { AnyMiddleware } from '../typed-router.ts'

import { migrateSchema } from '../db/index.ts'
import { auditError, auditInfo, auditWarn } from '../services/audit-log.ts'
import { backfillScreentimeActivities } from '../services/backfill-screentime-activities.ts'

/**
 * Audit log middleware: records non-GET requests to the user's audit log.
 * Log level is based on response status: 4xx → warn, 5xx → error, otherwise → info.
 * Sanitizes `password` field from request bodies; captures response body for error logs.
 */
export const createAuditLogMiddleware =
  (auth: Auth): RequestHandler =>
  (req, res, next) => {
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
  }

/**
 * Auth middleware: extracts Bearer token, sets `req.user`, and runs schema migration
 * once per user per server lifetime. First request blocks on migration; subsequent
 * requests wait if migration is still in flight. Also kicks off a one-shot background
 * backfill of historical screentime activities, gated via sync_state.
 */
export const createAuthMiddleware = (auth: Auth, unauthorized: Error): AnyMiddleware => {
  const migratedUsers = new Map<string, Promise<void>>()

  return async (req, res, next) => {
    try {
      if (typeof req.headers.authorization === 'string') {
        const token = req.headers.authorization.slice('bearer '.length)
        const user = auth.getUsernameFromToken(token)
        req.user = user

        if (!migratedUsers.has(user)) {
          const migrationPromise = migrateSchema(user)
            .then(() => {
              void backfillScreentimeActivities(user).catch((err) =>
                console.error(`⚠️ Screentime backfill failed for ${user}:`, err),
              )
            })
            .catch((err) => console.error(`⚠️ Migration failed for ${user}:`, err))
          migratedUsers.set(user, migrationPromise)
          await migrationPromise
        } else {
          await migratedUsers.get(user)
        }

        return next()
      }
    } catch {
      return next(unauthorized)
    }
    return next(unauthorized)
  }
}

/** Admin authorization middleware: requires `req.user` set and admin status in central DB. */
export const createAdminMiddleware =
  (centralDb: CentralDb, unauthorized: Error, forbidden: Error): RequestHandler =>
  async (req, _res, next) => {
    if (!req.user) {
      return next(unauthorized)
    }
    const isAdmin = await centralDb.isAdmin(req.user)
    if (!isAdmin) {
      return next(forbidden)
    }
    next()
  }
