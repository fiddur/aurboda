/**
 * Admin route group.
 *
 * Handles: /admin/*
 */
import {
  type AdminSettingsResponse,
  type CreateInvitationBody,
  createInvitationBodySchema,
  type InvitationResponse,
  type UpdateAdminSettingsBody,
  updateAdminSettingsBodySchema,
} from '@aurboda/api-spec'
import { RequestHandler, Router } from 'express'
import type { CentralDb } from '../services/central-db'
import type { InvitationAuth } from '../services/invitation'
import type { OuraWebhookManager } from '../services/oura-webhook-manager'
import { validateBody } from '../validation'

export const createAdminRouter = (
  authMiddleware: RequestHandler,
  adminMiddleware: RequestHandler,
  centralDb: CentralDb,
  invitationAuth: InvitationAuth,
  webHost: string,
  ouraWebhookManager?: OuraWebhookManager | null,
): Router => {
  const router = Router()

  // GET /admin/settings - Get admin settings
  router.get<Record<string, never>, AdminSettingsResponse>(
    '/settings',
    authMiddleware,
    adminMiddleware,
    async (_req, res) => {
      const signupMode = await centralDb.getSignupMode()
      const adminCount = await centralDb.getAdminCount()
      const lastFmApiKey = await centralDb.getLastFmApiKey()
      const ouraWebhookEnabled = await centralDb.getOuraWebhookEnabled()
      res.json({
        admin_count: adminCount,
        lastfm_api_key_set: !!lastFmApiKey,
        oura_webhook_available: ouraWebhookManager?.canEnable() ?? false,
        oura_webhook_enabled: ouraWebhookEnabled,
        signup_mode: signupMode,
        success: true,
      })
    },
  )

  // PATCH /admin/settings - Update admin settings
  router.patch<Record<string, never>, AdminSettingsResponse, UpdateAdminSettingsBody>(
    '/settings',
    authMiddleware,
    adminMiddleware,
    validateBody(updateAdminSettingsBodySchema),
    async (req, res) => {
      const { lastfm_api_key, oura_webhook_enabled, signup_mode } = req.body
      if (signup_mode) {
        await centralDb.setSignupMode(signup_mode)
      }
      if (lastfm_api_key !== undefined) {
        await centralDb.setLastFmApiKey(lastfm_api_key)
      }
      if (oura_webhook_enabled !== undefined) {
        await centralDb.setOuraWebhookEnabled(oura_webhook_enabled)
        if (ouraWebhookManager) {
          if (oura_webhook_enabled) {
            await ouraWebhookManager.enable()
          } else {
            await ouraWebhookManager.disable()
          }
        }
      }
      const currentMode = await centralDb.getSignupMode()
      const adminCount = await centralDb.getAdminCount()
      const lastFmApiKey = await centralDb.getLastFmApiKey()
      const ouraWebhookEnabledValue = await centralDb.getOuraWebhookEnabled()
      res.json({
        admin_count: adminCount,
        lastfm_api_key_set: !!lastFmApiKey,
        oura_webhook_available: ouraWebhookManager?.canEnable() ?? false,
        oura_webhook_enabled: ouraWebhookEnabledValue,
        signup_mode: currentMode,
        success: true,
      })
    },
  )

  // POST /admin/invitations - Create a new invitation
  router.post<Record<string, never>, InvitationResponse, CreateInvitationBody>(
    '/invitations',
    authMiddleware,
    adminMiddleware,
    validateBody(createInvitationBodySchema),
    async (req, res) => {
      const { expiry_hours } = req.body
      const token = invitationAuth.createInvitationToken(expiry_hours)
      const expiresAt = invitationAuth.getTokenExpiry(token)

      res.json({
        expires_at: expiresAt!.toISOString(),
        success: true,
        token,
        url: `${webHost}/signup?invite=${encodeURIComponent(token)}`,
      })
    },
  )

  return router
}
