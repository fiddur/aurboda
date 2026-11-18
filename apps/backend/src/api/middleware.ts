import type { RequestHandler } from 'express'

import { type AccountReadOnlyResponse, isAllowedWhenReadOnly } from '@aurboda/api-spec'

import type { Auth } from '../auth.ts'
import type { AccountGate } from '../services/account-gate.ts'
import type { CentralDb } from '../services/central-db.ts'
import type { AnyMiddleware } from '../typed-router.ts'

import { migrateSchemaIfNeeded } from '../db/index.ts'
import { safeRefusal } from '../services/account-gate.ts'
import { auditError, auditInfo, auditWarn } from '../services/audit-log.ts'
import { backfillMealFoodItemNames } from '../services/backfill-meal-food-item-names.ts'
import { backfillScreentimeActivities } from '../services/backfill-screentime-activities.ts'
import { reconcileExportedSharedFoodItems } from '../services/exported-shared-food.ts'
import { redactGarminLoginAudit } from '../services/redact-garmin-login-audit.ts'
import { retypeLegacyScreentime } from '../services/retype-legacy-screentime.ts'
import { auditErrorType, auditOperation, summarizeAuditBody, trackRouteTemplate } from './audit-body.ts'

/**
 * Log level is based on response status: 4xx → warn, 5xx → error, otherwise → info.
 * The details keep the body's shape and, for an error, the status and its coarse type:
 * nothing the user wrote, and no response body.
 */
export const createAuditLogMiddleware =
  (auth: Auth, isDeletedUser: (user: string) => boolean = () => false): RequestHandler =>
  (req, res, next) => {
    trackRouteTemplate(req)
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
        const shape = summarizeAuditBody(req.body)

        res.on('finish', () => {
          if (isDeletedUser(user)) return
          const operation = auditOperation(req)
          const status = res.statusCode
          if (status >= 500) {
            auditError(user, 'data', operation, { ...shape, error_type: auditErrorType(status), status })
          } else if (status >= 400) {
            auditWarn(user, 'data', operation, { ...shape, error_type: auditErrorType(status), status })
          } else {
            auditInfo(user, 'data', operation, shape)
          }
        })
      }
    }
    next()
  }

/**
 * Auth middleware: extracts Bearer token, sets `req.user`, and checks the
 * user's schema once per user per server lifetime. The check is gated by the
 * schema fingerprint, so it is normally a single `SELECT` and only actually
 * sweeps when this build's DDL differs from what the database records — and
 * after a deploy the background sweep in `api.ts` has usually done that
 * already. The first request still awaits it, so no request runs against
 * stale schema; subsequent requests wait if it is still in flight. Also kicks
 * off, in the background, the reconcile of a restored dump's shared food
 * items (independent of the fingerprint, since a same-version restore
 * migrates nothing) and one-shot backfills gated via sync_state.
 *
 * With an account gate, a write by a read-only account (its plan expired past the
 * grace period) is answered 402 unless `isAllowedWhenReadOnly` lets it through.
 */
export const createAuthMiddleware = (
  auth: Auth,
  unauthorized: Error,
  /** A deleted user's token still decodes (it is stateless), so it is refused here. */
  isDeletedUser: (user: string) => boolean = () => false,
  accountGate?: AccountGate,
): AnyMiddleware => {
  const migratedUsers = new Map<string, Promise<void>>()

  return async (req, res, next) => {
    try {
      if (typeof req.headers.authorization === 'string') {
        const token = req.headers.authorization.slice('bearer '.length)
        const user = auth.getUsernameFromToken(token)
        if (isDeletedUser(user)) return next(unauthorized)
        req.user = user

        if (!migratedUsers.has(user)) {
          const migrationPromise = migrateSchemaIfNeeded(user)
            .then(() => {
              void (async () => {
                await reconcileExportedSharedFoodItems(user)
                  .then(() => backfillMealFoodItemNames(user))
                  .catch((err) => console.error(`⚠️ Food item reference upkeep failed for ${user}:`, err))
                await backfillScreentimeActivities(user).catch((err) =>
                  console.error(`⚠️ Screentime backfill failed for ${user}:`, err),
                )
                await retypeLegacyScreentime(user).catch((err) =>
                  console.error(`⚠️ Legacy screentime retype failed for ${user}:`, err),
                )
                await redactGarminLoginAudit(user).catch((err) =>
                  console.error(`⚠️ Garmin login audit redaction failed for ${user}:`, err),
                )
              })()
            })
            .catch((err) => console.error(`⚠️ Migration failed for ${user}:`, err))
          migratedUsers.set(user, migrationPromise)
          await migrationPromise
        } else {
          await migratedUsers.get(user)
        }

        if (accountGate && !isAllowedWhenReadOnly(req.method, req.baseUrl + req.path)) {
          const refusal = await safeRefusal(accountGate, user)
          if (refusal) {
            const body: AccountReadOnlyResponse = { ...refusal, success: false }
            res.status(402).json(body)
            return
          }
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
