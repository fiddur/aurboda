/**
 * Express router for Oura webhook callback endpoint.
 *
 * Receives push notifications from Oura when user data changes,
 * then triggers a debounced sync for the affected user and data type.
 */

import { Router } from 'express'

import type { OuraDataType } from './oura-sync.ts'

import { ouraWebhookDataTypeMap, type OuraWebhookDataType } from './oura-webhook-api.ts'
import { auditError, auditInfo } from './services/audit-log.ts'

const DEBOUNCE_MS = 5000

export interface OuraWebhookRouterDeps {
  verificationToken: string
  getUsernameByOuraUserId: (ouraUserId: string) => Promise<string | null>
  syncOuraDataTypeForUser: (username: string, dataType: OuraDataType) => Promise<void>
}

export interface OuraWebhookRouter extends Router {
  clearPendingWebhookSyncs: () => void
}

export const createOuraWebhookRouter = (deps: OuraWebhookRouterDeps): OuraWebhookRouter => {
  const router = Router() as OuraWebhookRouter
  const pendingSyncs = new Map<string, NodeJS.Timeout>()

  const scheduleDebouncedSync = (username: string, dataType: OuraDataType): void => {
    const key = `${username}:${dataType}`

    const existing = pendingSyncs.get(key)
    if (existing) {
      clearTimeout(existing)
    }

    const timeout = setTimeout(() => {
      pendingSyncs.delete(key)
      deps.syncOuraDataTypeForUser(username, dataType).catch((error) => {
        auditError(username, 'sync', `Webhook-triggered Oura sync failed for ${dataType}`, {
          error: String(error),
        })
      })
    }, DEBOUNCE_MS)

    pendingSyncs.set(key, timeout)
  }

  router.clearPendingWebhookSyncs = (): void => {
    for (const timeout of pendingSyncs.values()) {
      clearTimeout(timeout)
    }
    pendingSyncs.clear()
  }

  router.get('/', (req, res) => {
    const { challenge } = req.query
    if (typeof challenge !== 'string') {
      res.status(400).json({ error: 'Missing challenge' })
      return
    }
    res.json({ challenge })
  })

  router.post('/', async (req, res) => {
    const { data_type, event_type, user_id, verification_token } = req.body ?? {}

    // Validate verification token
    if (verification_token !== deps.verificationToken) {
      res.status(403).json({ error: 'Invalid verification token' })
      return
    }

    // Map Oura data type to our internal type
    const ourDataType = ouraWebhookDataTypeMap[data_type as OuraWebhookDataType]
    if (!ourDataType) {
      res.json({ status: 'ok' })
      return
    }

    // Look up local username from Oura user ID
    const username = await deps.getUsernameByOuraUserId(user_id)
    if (!username) {
      res.json({ status: 'ok' })
      return
    }

    auditInfo(username, 'sync', `Oura webhook: ${event_type} ${data_type}, scheduling sync`)
    scheduleDebouncedSync(username, ourDataType)

    res.json({ status: 'ok' })
  })

  return router
}
