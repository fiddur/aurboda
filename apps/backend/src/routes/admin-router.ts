import {
  type AddRelayBody,
  addRelayBodySchema,
  type AdminSettingsResponse,
  type AdminUserUsageQuery,
  adminUserUsageQuerySchema,
  type AdminUserUsageResponse,
  type AdminUsersResponse,
  type BaseResponse,
  type CreateInvitationBody,
  createInvitationBodySchema,
  type AdminUserPlanResponse,
  type DeleteAccountBody,
  deleteAccountBodySchema,
  type InvitationResponse,
  type RelayResponse,
  type RelaysResponse,
  type ResendPostUpdatesResponse,
  type UpdateAdminSettingsBody,
  updateAdminSettingsBodySchema,
  type UpdateUserPlanBody,
  updateUserPlanBodySchema,
} from '@aurboda/api-spec'

import type { AccountDeleter } from '../services/account-deletion.ts'
import type { AccountPlans } from '../services/account-plan.ts'
import type { PostUpdateResender } from '../services/activitypub/post-update-resend.ts'
import type { AdminUsers } from '../services/admin-users.ts'
import type { CentralDb } from '../services/central-db.ts'
import type { InvitationAuth } from '../services/invitation.ts'
import type { OuraWebhookManager } from '../services/oura-webhook-manager.ts'
import type { PublicTagActions } from '../services/public-tags.ts'
import type { RelayActions } from '../services/relays.ts'

import { accountDeletionStatus } from '../services/account-deletion.ts'
import { readBillingSettings } from '../services/account-plan.ts'
import {
  normalizeOfficialFeedSetting,
  readOfficialFeedSetting,
  writeOfficialFeedSetting,
} from '../services/official-feed.ts'
import {
  normalizePublicTagPages,
  readInstanceFollowedTags,
  readPublicTagFollows,
  readPublicTagPages,
  readPublicTagRetentionDays,
} from '../services/public-tags.ts'
import { serializeRelay } from '../services/relays.ts'
import { readSupportContacts } from '../services/support-contacts.ts'
import { readTagActorHost } from '../services/tag-actor-host.ts'
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody, validateQuery } from '../validation.ts'

export const createAdminRouter = (
  authMiddleware: AnyMiddleware,
  adminMiddleware: AnyMiddleware,
  centralDb: CentralDb,
  adminUsers: AdminUsers,
  invitationAuth: InvitationAuth,
  webHost: string,
  gravlRedirectUri: string,
  userExists: (username: string) => Promise<boolean>,
  ouraWebhookManager?: OuraWebhookManager | null,
  deleteAccount?: AccountDeleter,
  accountPlans?: AccountPlans,
  relays?: RelayActions,
  publicTags?: Pick<PublicTagActions, 'apply'>,
  postUpdates?: PostUpdateResender,
): TypedRouter => {
  const router = typedRouter()
  const readSettings = async (): Promise<AdminSettingsResponse> => {
    const [
      signupMode,
      adminCount,
      lastFmApiKey,
      ouraWebhookEnabled,
      auditLogRetentionDays,
      ouraClientId,
      ouraClientSecret,
      stravaClientId,
      stravaClientSecret,
      ouraWebhookAvailable,
      sentryDsn,
      gravlClientId,
      gravlClientSecret,
      officialFeed,
      billing,
      tagActorHost,
      publicTagPages,
      publicTagRetentionDays,
      publicTagFollows,
      contacts,
    ] = await Promise.all([
      centralDb.getSignupMode(),
      centralDb.getAdminCount(),
      centralDb.getLastFmApiKey(),
      centralDb.getOuraWebhookEnabled(),
      centralDb.getAuditLogRetentionDays(),
      centralDb.getServerSetting('oura_client_id'),
      centralDb.getServerSetting('oura_client_secret'),
      centralDb.getServerSetting('strava_client_id'),
      centralDb.getServerSetting('strava_client_secret'),
      ouraWebhookManager ? ouraWebhookManager.canEnable() : Promise.resolve(false),
      centralDb.getServerSetting('sentry_dsn'),
      centralDb.getServerSetting('gravl_client_id'),
      centralDb.getServerSetting('gravl_client_secret'),
      readOfficialFeedSetting(centralDb),
      readBillingSettings(centralDb),
      readTagActorHost(centralDb),
      readPublicTagPages(centralDb),
      readPublicTagRetentionDays(centralDb),
      readPublicTagFollows(centralDb),
      readSupportContacts(centralDb),
    ])
    return {
      admin_count: adminCount,
      audit_log_retention_days: auditLogRetentionDays,
      billing_enabled: billing.enabled,
      contact_fediverse: contacts.contact_fediverse,
      contact_reddit: contacts.contact_reddit,
      grace_days: billing.grace_days,
      gravl_client_id_set: !!gravlClientId,
      gravl_client_secret_set: !!gravlClientSecret,
      gravl_redirect_uri: gravlRedirectUri,
      lastfm_api_key_set: !!lastFmApiKey,
      oura_client_id_set: !!ouraClientId,
      oura_client_secret_set: !!ouraClientSecret,
      oura_webhook_available: ouraWebhookAvailable,
      oura_webhook_enabled: ouraWebhookEnabled,
      official_feed: officialFeed,
      payment_url: billing.payment_url,
      price_text: billing.price_text,
      public_tag_follows: publicTagFollows,
      public_tag_pages: publicTagPages,
      public_tag_retention_days: publicTagRetentionDays,
      // DSN is returned in full (not `_set` boolean like other secrets):
      // Sentry DSNs are public values designed to be embedded in clients.
      sentry_dsn: sentryDsn || null,
      signup_mode: signupMode,
      strava_client_id_set: !!stravaClientId,
      strava_client_secret_set: !!stravaClientSecret,
      success: true,
      tag_actor_host: tagActorHost,
      trial_days: billing.trial_days,
    }
  }

  router.get<Record<string, never>, AdminSettingsResponse>(
    '/settings',
    authMiddleware,
    adminMiddleware,
    async (_req, res) => {
      res.json(await readSettings())
    },
  )

  router.patch<Record<string, never>, AdminSettingsResponse | BaseResponse, UpdateAdminSettingsBody>(
    '/settings',
    authMiddleware,
    adminMiddleware,
    validateBody(updateAdminSettingsBodySchema),
    // eslint-disable-next-line complexity -- sequential independent setting updates
    async (req, res) => {
      const {
        audit_log_retention_days,
        billing_enabled,
        blog_username,
        contact_fediverse,
        contact_reddit,
        grace_days,
        gravl_client_id,
        gravl_client_secret,
        lastfm_api_key,
        oura_client_id,
        oura_client_secret,
        oura_webhook_enabled,
        official_feed,
        payment_url,
        price_text,
        public_tag_pages,
        public_tag_retention_days,
        sentry_dsn,
        signup_mode,
        strava_client_id,
        strava_client_secret,
        tag_actor_host,
        trial_days,
      } = req.body
      const legacyFeed =
        blog_username === undefined
          ? undefined
          : { remote_authors: [], tags: [], users: blog_username == null ? [] : [blog_username] }
      const feedInput = official_feed ?? legacyFeed
      if (feedInput) {
        const feed = normalizeOfficialFeedSetting(feedInput, webHost)
        if (feed.remote_authors.length > 0 && feed.tags.length === 0) {
          return res.status(400).json({
            error:
              'Authors on other servers need at least one tag: their posts arrive through the tag follows',
            success: false,
          })
        }
        const exists = await Promise.all(feed.users.map(userExists))
        const unknown = feed.users.filter((_, i) => !exists[i])
        if (unknown.length > 0) {
          const names = unknown.map((user) => `"${user}"`).join(', ')
          return res.status(400).json({ error: `No user named ${names}`, success: false })
        }
        await writeOfficialFeedSetting(centralDb, feed)
      }
      if (signup_mode) {
        await centralDb.setSignupMode(signup_mode)
      }
      if (audit_log_retention_days !== undefined) {
        await centralDb.setAuditLogRetentionDays(audit_log_retention_days)
      }
      if (lastfm_api_key !== undefined) {
        await centralDb.setLastFmApiKey(lastfm_api_key)
      }
      if (oura_client_id !== undefined) {
        await centralDb.setServerSetting('oura_client_id', oura_client_id ?? '')
      }
      if (oura_client_secret !== undefined) {
        await centralDb.setServerSetting('oura_client_secret', oura_client_secret ?? '')
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
      if (sentry_dsn !== undefined) {
        await centralDb.setServerSetting('sentry_dsn', sentry_dsn ?? '')
      }
      if (gravl_client_id !== undefined) {
        await centralDb.setServerSetting('gravl_client_id', gravl_client_id ?? '')
      }
      if (gravl_client_secret !== undefined) {
        await centralDb.setServerSetting('gravl_client_secret', gravl_client_secret ?? '')
      }
      if (tag_actor_host !== undefined) {
        await centralDb.setServerSetting('tag_actor_host', tag_actor_host)
      }
      if (contact_fediverse !== undefined) {
        await centralDb.setServerSetting('contact_fediverse', contact_fediverse)
      }
      if (contact_reddit !== undefined) {
        await centralDb.setServerSetting('contact_reddit', contact_reddit)
      }
      if (public_tag_retention_days !== undefined) {
        await centralDb.setServerSetting('public_tag_retention_days', public_tag_retention_days)
      }
      if (public_tag_pages !== undefined) {
        await centralDb.setServerSetting('public_tag_pages', normalizePublicTagPages(public_tag_pages))
      }
      if (public_tag_pages !== undefined || tag_actor_host !== undefined || feedInput) {
        await publicTags?.apply(await readInstanceFollowedTags(centralDb)).catch((error: unknown) => {
          console.error('⚠️ Public tag page follows failed:', error)
        })
      }
      const billingChanged = [billing_enabled, trial_days, grace_days, price_text, payment_url].some(
        (value) => value !== undefined,
      )
      if (billingChanged) {
        const wasEnabled = (await centralDb.getServerSetting('billing_enabled')) === true
        if (trial_days !== undefined) await centralDb.setServerSetting('trial_days', trial_days)
        if (grace_days !== undefined) await centralDb.setServerSetting('grace_days', grace_days)
        if (price_text !== undefined) await centralDb.setServerSetting('price_text', price_text)
        if (payment_url !== undefined) await centralDb.setServerSetting('payment_url', payment_url)
        if (billing_enabled !== undefined) {
          await centralDb.setServerSetting('billing_enabled', billing_enabled)
        }
        await accountPlans?.billingSettingsChanged(wasEnabled)
      }
      res.json(await readSettings())
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

  router.get<Record<string, never>, AdminUsersResponse>(
    '/users',
    authMiddleware,
    adminMiddleware,
    async (_req, res) => {
      res.json({ success: true, users: await adminUsers.listUsersOverview() })
    },
  )

  router.get<{ username: string }, AdminUserUsageResponse, unknown, AdminUserUsageQuery>(
    '/users/:username',
    authMiddleware,
    adminMiddleware,
    validateQuery(adminUserUsageQuerySchema),
    async (req, res) => {
      const user = await adminUsers.getUserUsage(req.params.username, req.query.days)
      if (!user) {
        res.status(404).json({ error: 'User not found', success: false })
        return
      }
      res.json({ success: true, user })
    },
  )

  if (accountPlans) {
    router.patch<{ username: string }, AdminUserPlanResponse, UpdateUserPlanBody>(
      '/users/:username/plan',
      authMiddleware,
      adminMiddleware,
      validateBody(updateUserPlanBodySchema),
      async (req, res) => {
        const status = await accountPlans.setUserPlan(req.params.username, req.body)
        if (!status) {
          res.status(404).json({ error: 'User not found', success: false })
          return
        }
        res.json({ status, success: true })
      },
    )
  }

  if (deleteAccount) {
    router.delete<{ username: string }, BaseResponse, DeleteAccountBody>(
      '/users/:username',
      authMiddleware,
      adminMiddleware,
      validateBody(deleteAccountBodySchema),
      async (req, res) => {
        const result = await deleteAccount(req.params.username, {
          actor: req.user!,
          confirmUsername: req.body.confirm_username,
        })
        if (!result.ok) {
          res.status(accountDeletionStatus[result.error]).json({ error: result.message, success: false })
          return
        }
        res.json({ success: true })
      },
    )
  }

  if (relays) {
    router.get<Record<string, never>, RelaysResponse>(
      '/relays',
      authMiddleware,
      adminMiddleware,
      async (_req, res) => {
        res.json({ relays: await relays.list(), success: true })
      },
    )

    router.post<Record<string, never>, RelayResponse, AddRelayBody>(
      '/relays',
      authMiddleware,
      adminMiddleware,
      validateBody(addRelayBodySchema),
      async (req, res) => {
        const result = await relays.add(req.body)
        if (!result.ok) {
          res.status(result.status).json({ error: result.error, success: false })
          return
        }
        res.status(201).json({ relay: serializeRelay(result.record), success: true })
      },
    )

    router.delete<{ id: string }, BaseResponse>(
      '/relays/:id',
      authMiddleware,
      adminMiddleware,
      async (req, res) => {
        if (!(await relays.remove(req.params.id))) {
          res.status(404).json({ error: 'Relay not found', success: false })
          return
        }
        res.json({ success: true })
      },
    )
  }

  if (postUpdates) {
    router.post<Record<string, never>, ResendPostUpdatesResponse>(
      '/federation/resend-post-updates',
      authMiddleware,
      adminMiddleware,
      async (_req, res) => {
        const run = await postUpdates.start()
        if (run == null) {
          res.status(409).json({ error: 'A re-send is already running', success: false })
          return
        }
        res.status(202).json({ posts: run.posts, success: true })
      },
    )
  }

  return router
}
