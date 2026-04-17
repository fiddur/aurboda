import type { RequestHandler } from 'express'

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

import type { CentralDb } from '../services/central-db.ts'
import type { InvitationAuth } from '../services/invitation.ts'
import type { OuraWebhookManager } from '../services/oura-webhook-manager.ts'

import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody } from '../validation.ts'

export const createAdminRouter = (
  authMiddleware: RequestHandler,
  adminMiddleware: RequestHandler,
  centralDb: CentralDb,
  invitationAuth: InvitationAuth,
  webHost: string,
  ouraWebhookManager?: OuraWebhookManager | null,
): TypedRouter => {
  const router = typedRouter()
  router.get<Record<string, never>, AdminSettingsResponse>(
    '/settings',
    authMiddleware,
    adminMiddleware,
    async (_req, res) => {
      const [
        signupMode,
        adminCount,
        lastFmApiKey,
        ouraWebhookEnabled,
        auditLogRetentionDays,
        stravaClientId,
        stravaClientSecret,
      ] = await Promise.all([
        centralDb.getSignupMode(),
        centralDb.getAdminCount(),
        centralDb.getLastFmApiKey(),
        centralDb.getOuraWebhookEnabled(),
        centralDb.getAuditLogRetentionDays(),
        centralDb.getServerSetting('strava_client_id'),
        centralDb.getServerSetting('strava_client_secret'),
      ])
      res.json({
        admin_count: adminCount,
        audit_log_retention_days: auditLogRetentionDays,
        lastfm_api_key_set: !!lastFmApiKey,
        oura_webhook_available: ouraWebhookManager?.canEnable() ?? false,
        oura_webhook_enabled: ouraWebhookEnabled,
        signup_mode: signupMode,
        strava_client_id_set: !!stravaClientId,
        strava_client_secret_set: !!stravaClientSecret,
        success: true,
      })
    },
  )

  router.patch<Record<string, never>, AdminSettingsResponse, UpdateAdminSettingsBody>(
    '/settings',
    authMiddleware,
    adminMiddleware,
    validateBody(updateAdminSettingsBodySchema),
    async (req, res) => {
      const {
        audit_log_retention_days,
        lastfm_api_key,
        oura_webhook_enabled,
        signup_mode,
        strava_client_id,
        strava_client_secret,
      } = req.body
      if (signup_mode) {
        await centralDb.setSignupMode(signup_mode)
      }
      if (audit_log_retention_days !== undefined) {
        await centralDb.setAuditLogRetentionDays(audit_log_retention_days)
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
      if (strava_client_id !== undefined) {
        await centralDb.setServerSetting('strava_client_id', strava_client_id ?? '')
      }
      if (strava_client_secret !== undefined) {
        await centralDb.setServerSetting('strava_client_secret', strava_client_secret ?? '')
      }
      const [
        currentMode,
        adminCount,
        lastFmApiKey,
        ouraWebhookEnabledValue,
        currentRetentionDays,
        currentStravaClientId,
        currentStravaClientSecret,
      ] = await Promise.all([
        centralDb.getSignupMode(),
        centralDb.getAdminCount(),
        centralDb.getLastFmApiKey(),
        centralDb.getOuraWebhookEnabled(),
        centralDb.getAuditLogRetentionDays(),
        centralDb.getServerSetting('strava_client_id'),
        centralDb.getServerSetting('strava_client_secret'),
      ])
      res.json({
        admin_count: adminCount,
        audit_log_retention_days: currentRetentionDays,
        lastfm_api_key_set: !!lastFmApiKey,
        oura_webhook_available: ouraWebhookManager?.canEnable() ?? false,
        oura_webhook_enabled: ouraWebhookEnabledValue,
        signup_mode: currentMode,
        strava_client_id_set: !!currentStravaClientId,
        strava_client_secret_set: !!currentStravaClientSecret,
        success: true,
      })
    },
  )

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
