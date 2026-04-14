/**
 * Oura webhook lifecycle manager.
 *
 * Encapsulates the enable/disable/shutdown logic so it can be called
 * both at startup (from api.ts) and at runtime (from admin settings).
 *
 * Express does not support unmounting routes, so we always mount a
 * proxy handler at /webhooks/oura and delegate to the inner router
 * when enabled.
 */

import type { NextFunction, Request, Response } from 'express'

import { randomBytes } from 'node:crypto'

import type { OuraDataType } from '../integrations/oura/sync.ts'
import type { CentralDb } from './central-db.ts'

import { createOuraWebhookApi } from '../integrations/oura/webhook-api.ts'
import { createOuraWebhookRouter, type OuraWebhookRouter } from '../integrations/oura/webhook-router.ts'
import { createOuraWebhookService, type OuraWebhookService } from './oura-webhook-service.ts'

export interface OuraWebhookManagerDeps {
  centralDb: Pick<
    CentralDb,
    | 'getServerSetting'
    | 'setServerSetting'
    | 'getUsernameByOuraUserId'
    | 'upsertOuraWebhookSubscription'
    | 'getOuraWebhookSubscriptions'
    | 'deleteOuraWebhookSubscription'
    | 'deleteAllOuraWebhookSubscriptions'
  >
  ouraClientId: string
  ouraClientSecret: string
  syncOuraDataTypeForUser: (username: string, dataType: OuraDataType) => Promise<void>
  webHost: string
}

export interface OuraWebhookManager {
  canEnable: () => boolean
  enable: () => Promise<void>
  disable: () => Promise<void>
  isEnabled: () => boolean
  handleWebhookRequest: (req: Request, res: Response, next: NextFunction) => void
  shutdown: () => void
}

export const createOuraWebhookManager = (deps: OuraWebhookManagerDeps): OuraWebhookManager => {
  let webhookRouter: OuraWebhookRouter | null = null
  let webhookService: OuraWebhookService | null = null
  let enabled = false

  const callbackUrl = `${deps.webHost}/api/webhooks/oura`

  const canEnable = (): boolean => {
    try {
      const url = new URL(deps.webHost)
      return url.protocol === 'https:'
    } catch {
      return false
    }
  }

  const enable = async (): Promise<void> => {
    // Disable first if already enabled (clean swap)
    if (enabled) {
      await disable()
    }

    // Get or generate verification token
    let verificationToken = await deps.centralDb.getServerSetting('oura_webhook_verification_token')
    if (!verificationToken) {
      verificationToken = randomBytes(32).toString('hex')
      await deps.centralDb.setServerSetting('oura_webhook_verification_token', verificationToken)
      console.info('Oura webhook: generated new verification token')
    }

    // Create webhook API client
    const webhookApi = createOuraWebhookApi({
      callbackUrl,
      clientId: deps.ouraClientId,
      clientSecret: deps.ouraClientSecret,
      verificationToken,
    })

    // Create webhook router
    webhookRouter = createOuraWebhookRouter({
      getUsernameByOuraUserId: (ouraUserId) => deps.centralDb.getUsernameByOuraUserId(ouraUserId),
      syncOuraDataTypeForUser: deps.syncOuraDataTypeForUser,
      verificationToken,
    })

    // Create subscription service
    webhookService = createOuraWebhookService({
      createSubscription: (dataType, eventType) => webhookApi.createSubscription(dataType, eventType),
      deleteLocalSubscription: (id) => deps.centralDb.deleteOuraWebhookSubscription(id),
      deleteRemoteSubscription: (id) => webhookApi.deleteSubscription(id),
      getLocalSubscriptions: () => deps.centralDb.getOuraWebhookSubscriptions(),
      listRemoteSubscriptions: () => webhookApi.listSubscriptions(),
      renewSubscription: (id) => webhookApi.renewSubscription(id),
      upsertLocalSubscription: (sub) => deps.centralDb.upsertOuraWebhookSubscription(sub),
    })

    enabled = true

    // Initialize subscriptions in background
    webhookService.initSubscriptions().catch((error) => {
      console.error('Oura webhook: failed to initialize subscriptions:', error)
    })

    webhookService.startRenewalTimer()

    console.info(`Oura webhook: enabled at ${callbackUrl}`)
  }

  const disable = async (): Promise<void> => {
    if (!enabled) return

    if (webhookRouter) {
      webhookRouter.clearPendingWebhookSyncs()
    }
    if (webhookService) {
      webhookService.stopRenewalTimer()
    }

    // Clean up remote subscriptions and local tracking
    try {
      await deps.centralDb.deleteAllOuraWebhookSubscriptions()
    } catch (error) {
      console.error('Oura webhook: failed to clean up subscriptions:', error)
    }

    webhookRouter = null
    webhookService = null
    enabled = false

    console.info('Oura webhook: disabled')
  }

  const handleWebhookRequest = (req: Request, res: Response, next: NextFunction): void => {
    if (!enabled || !webhookRouter) {
      res.status(404).json({ error: 'Oura webhook not enabled' })
      return
    }
    webhookRouter(req, res, next)
  }

  const shutdown = (): void => {
    if (webhookRouter) {
      webhookRouter.clearPendingWebhookSyncs()
    }
    if (webhookService) {
      webhookService.stopRenewalTimer()
    }
    webhookRouter = null
    webhookService = null
    enabled = false
  }

  return {
    canEnable,
    disable,
    enable,
    handleWebhookRequest,
    isEnabled,
    shutdown,
  }

  function isEnabled(): boolean {
    return enabled
  }
}
