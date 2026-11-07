import { z } from 'zod'

import { baseResponseSchema, dateOnlySchema, iso8601DateTimeSchema } from './common.ts'
import { officialFeedSettingSchema } from './feed.ts'
import { adminUserPlanShape } from './plans.ts'
import { signupProfileShape } from './profile.ts'

export const signupModeSchema = z.enum(['open', 'invite_only', 'closed']).meta({
  description: 'Server signup mode',
  example: 'open',
  id: 'SignupMode',
})

export type SignupMode = z.infer<typeof signupModeSchema>

export const serverStatusResponseSchema = baseResponseSchema
  .extend({
    federation: z
      .boolean()
      .optional()
      .meta({ description: 'Whether this instance supports cross-instance federation' }),
    product: z
      .literal('aurboda')
      .optional()
      .meta({ description: 'Product identifier for federation discovery' }),
    official_feed: z
      .boolean()
      .optional()
      .meta({ description: 'Whether this instance has an official feed (its blog, at `/blog`)' }),
    signup_allowed: z
      .boolean()
      .meta({ description: 'Whether signup is allowed (deprecated, use signupMode)' }),
    billing_enabled: z
      .boolean()
      .optional()
      .meta({ description: 'Whether this server charges for accounts after a free trial' }),
    price_text: z
      .string()
      .nullable()
      .optional()
      .meta({ description: 'The price after the trial, as the admin wrote it (when billing is enabled)' }),
    signup_mode: signupModeSchema.meta({ description: 'Current signup mode' }),
    trial_days: z
      .number()
      .int()
      .optional()
      .meta({ description: 'Length of the free trial for new accounts, in days (when billing is enabled)' }),
    version: z.string().optional().meta({ description: 'Instance build/version identifier' }),
  })
  .meta({ id: 'ServerStatusResponse' })

export type ServerStatusResponse = z.infer<typeof serverStatusResponseSchema>

export const signupBodySchema = z
  .object({
    ...signupProfileShape,
    invitation: z
      .string()
      .optional()
      .meta({ description: 'Invitation token (required in invite_only mode)' }),
    password: z.string().min(1).meta({ description: 'User password' }),
    username: z.string().min(1).meta({ description: 'Username' }),
  })
  .meta({ id: 'SignupBody' })

export type SignupBody = z.infer<typeof signupBodySchema>

export const signupResponseSchema = baseResponseSchema
  .extend({
    is_admin: z.boolean().optional().meta({ description: 'Whether the user is an admin' }),
    token: z.string().optional().meta({ description: 'Authentication token' }),
  })
  .meta({ id: 'SignupResponse' })

export type SignupResponse = z.infer<typeof signupResponseSchema>

export const loginBodySchema = z
  .object({
    password: z.string().min(1).meta({ description: 'User password' }),
    username: z.string().min(1).meta({ description: 'Username' }),
  })
  .meta({ id: 'LoginBody' })

export type LoginBody = z.infer<typeof loginBodySchema>

export const loginResponseSchema = z
  .object({
    is_admin: z.boolean().optional().meta({ description: 'Whether the user is an admin' }),
    token: z.string().meta({ description: 'Authentication token' }),
  })
  .meta({ id: 'LoginResponse' })

export type LoginResponse = z.infer<typeof loginResponseSchema>

export const versionResponseSchema = baseResponseSchema
  .extend({
    build_sha: z.string().meta({ description: 'Build commit SHA or "dev"' }),
  })
  .meta({ id: 'VersionResponse' })

export type VersionResponse = z.infer<typeof versionResponseSchema>

export const authTokenResponseSchema = baseResponseSchema
  .extend({
    token: z.string().meta({ description: 'Fresh API token' }),
  })
  .meta({ id: 'AuthTokenResponse' })

export type AuthTokenResponse = z.infer<typeof authTokenResponseSchema>

export const adminSettingsResponseSchema = baseResponseSchema
  .extend({
    admin_count: z.number().int().meta({ description: 'Number of admin users' }),
    audit_log_retention_days: z
      .number()
      .int()
      .meta({ description: 'Number of days to keep audit log entries (default: 3)' }),
    billing_enabled: z.boolean().meta({
      description:
        'Whether accounts are billed: new accounts get a free trial, then become read-only unless paid',
    }),
    grace_days: z
      .number()
      .int()
      .meta({ description: 'Days after a trial or paid period ends before the account becomes read-only' }),
    gravl_client_id_set: z.boolean().meta({ description: 'Whether a Gravl OAuth client ID is configured' }),
    gravl_client_secret_set: z
      .boolean()
      .meta({ description: 'Whether a Gravl OAuth client secret is configured' }),
    gravl_redirect_uri: z.string().meta({
      description: 'Absolute OAuth redirect URI to register with Gravl (derived from API_BASE_URL)',
    }),
    lastfm_api_key_set: z.boolean().meta({ description: 'Whether a Last.fm API key is configured' }),
    oura_client_id_set: z.boolean().meta({ description: 'Whether an Oura client ID is configured' }),
    oura_client_secret_set: z.boolean().meta({ description: 'Whether an Oura client secret is configured' }),
    oura_webhook_available: z.boolean().meta({
      description: 'Whether Oura webhook push can be enabled (requires HTTPS and Oura credentials)',
    }),
    oura_webhook_enabled: z.boolean().meta({ description: 'Whether Oura webhook push sync is enabled' }),
    official_feed: officialFeedSettingSchema,
    payment_url: z
      .string()
      .meta({ description: 'Where users pay, e.g. a Patreon page (empty when not set)' }),
    price_text: z
      .string()
      .meta({ description: 'The price shown to users, e.g. "3 € / month" (empty when not set)' }),
    sentry_dsn: z
      .string()
      .nullable()
      .meta({ description: 'Sentry DSN for backend error reporting (null if not configured)' }),
    signup_mode: signupModeSchema.meta({ description: 'Current signup mode' }),
    strava_client_id_set: z.boolean().meta({ description: 'Whether a Strava client ID is configured' }),
    strava_client_secret_set: z
      .boolean()
      .meta({ description: 'Whether a Strava client secret is configured' }),
    trial_days: z.number().int().meta({ description: 'Length of the free trial for new accounts, in days' }),
  })
  .meta({ id: 'AdminSettingsResponse' })

export type AdminSettingsResponse = z.infer<typeof adminSettingsResponseSchema>

export const updateAdminSettingsBodySchema = z
  .object({
    audit_log_retention_days: z
      .number()
      .int()
      .positive()
      .max(365)
      .optional()
      .meta({ description: 'Number of days to keep audit log entries (1-365, default: 3)' }),
    billing_enabled: z.boolean().optional().meta({
      description:
        'Enable or disable billing. Enabling it marks every account that exists then as exempt; disabling lifts every restriction.',
    }),
    blog_username: z.string().min(1).nullable().optional().meta({
      description:
        'Deprecated, use `official_feed`: sets the official feed to this one user with no tag filter (null turns it off). Ignored when `official_feed` is given.',
    }),
    grace_days: z
      .number()
      .int()
      .min(0)
      .max(365)
      .optional()
      .meta({ description: 'Days after expiry before an account becomes read-only (0-365, default 14)' }),
    gravl_client_id: z
      .string()
      .nullable()
      .optional()
      .meta({ description: 'Gravl OAuth client ID, gci_… (set to null to clear)' }),
    gravl_client_secret: z
      .string()
      .nullable()
      .optional()
      .meta({ description: 'Gravl OAuth client secret, gcs_… (set to null to clear)' }),
    lastfm_api_key: z
      .string()
      .nullable()
      .optional()
      .meta({ description: 'Last.fm API key (set to null to clear)' }),
    oura_client_id: z
      .string()
      .nullable()
      .optional()
      .meta({ description: 'Oura API client ID (set to null to clear)' }),
    oura_client_secret: z
      .string()
      .nullable()
      .optional()
      .meta({ description: 'Oura API client secret (set to null to clear)' }),
    oura_webhook_enabled: z
      .boolean()
      .optional()
      .meta({ description: 'Enable or disable Oura webhook push sync' }),
    official_feed: officialFeedSettingSchema
      .optional()
      .meta({ description: 'Replace the official feed setting; empty `users` turns it off' }),
    payment_url: z
      .union([z.literal(''), z.url({ protocol: /^https$/ })])
      .optional()
      .meta({ description: 'Where users pay, an https URL (e.g. a Patreon page); empty to clear' }),
    price_text: z
      .string()
      .max(200)
      .optional()
      .meta({ description: 'The price shown to users, e.g. "3 € / month"; empty to clear' }),
    sentry_dsn: z.string().url().nullable().optional().meta({
      description:
        'Sentry DSN for backend error reporting (set to null to clear). Takes effect after the next backend restart.',
    }),
    signup_mode: signupModeSchema.optional().meta({ description: 'New signup mode' }),
    strava_client_id: z
      .string()
      .nullable()
      .optional()
      .meta({ description: 'Strava API client ID (set to null to clear)' }),
    strava_client_secret: z
      .string()
      .nullable()
      .optional()
      .meta({ description: 'Strava API client secret (set to null to clear)' }),
    trial_days: z
      .number()
      .int()
      .min(0)
      .max(3650)
      .optional()
      .meta({ description: 'Length of the free trial for new accounts, in days (0-3650, default 90)' }),
  })
  .meta({ id: 'UpdateAdminSettingsBody' })

export type UpdateAdminSettingsBody = z.infer<typeof updateAdminSettingsBodySchema>

export const createInvitationBodySchema = z
  .object({
    expiry_hours: z.number().int().positive().optional().meta({
      description: 'Hours until invitation expires (default: 168 = 7 days)',
      example: 168,
    }),
  })
  .meta({ id: 'CreateInvitationBody' })

export type CreateInvitationBody = z.infer<typeof createInvitationBodySchema>

export const invitationResponseSchema = baseResponseSchema
  .extend({
    expires_at: iso8601DateTimeSchema.meta({ description: 'Expiration timestamp' }),
    token: z.string().meta({ description: 'Invitation token' }),
    url: z.string().meta({ description: 'Full invitation URL' }),
  })
  .meta({ id: 'InvitationResponse' })

export type InvitationResponse = z.infer<typeof invitationResponseSchema>

const adminUserAccountShape = {
  ...adminUserPlanShape,
  created_at: iso8601DateTimeSchema
    .nullable()
    .meta({ description: 'Signup time; null for an account that existed before signup dates were tracked' }),
  email: z
    .string()
    .nullable()
    .meta({ description: "The user's private email address; null when none is set. Admins only read it." }),
  is_admin: z.boolean().meta({ description: 'Whether the user is an admin' }),
  pre_existing: z
    .boolean()
    .meta({ description: 'Whether the account existed before signup dates were tracked' }),
  storage_bytes: z
    .number()
    .int()
    .nullable()
    .meta({ description: "Size of the user's database in bytes (null when unknown)" }),
  username: z.string().meta({ description: 'Username' }),
}

export const adminUserIngestSchema = z
  .object({
    items_30d: z
      .number()
      .int()
      .meta({ description: 'Records or points stored over the last 30 days (today included)' }),
    last_at: iso8601DateTimeSchema
      .nullable()
      .meta({ description: 'Time of the last ingest within the usage retention (400 days)' }),
    per_day_30d: z.number().meta({ description: 'Ingest events per day over the last 30 days' }),
    per_day_7d: z.number().meta({ description: 'Ingest events per day over the last 7 days' }),
    sources: z.array(z.string()).meta({
      description: 'Data sources that ingested in the last 30 days (garmin, oura, health_connect, ...)',
    }),
  })
  .meta({ description: 'How often data comes in for a user', id: 'AdminUserIngest' })

export type AdminUserIngest = z.infer<typeof adminUserIngestSchema>

export const adminUserChannelUseSchema = z
  .object({
    active_days_30d: z
      .number()
      .int()
      .meta({ description: 'Days with a read or write on this channel over the last 30 days' }),
    last_at: iso8601DateTimeSchema
      .nullable()
      .meta({ description: 'Time of the last read or write within the usage retention (400 days)' }),
    reads_30d: z.number().int().meta({ description: 'Reads over the last 30 days' }),
    writes_30d: z.number().int().meta({ description: 'Writes over the last 30 days' }),
  })
  .meta({ description: "A user's use of one channel", id: 'AdminUserChannelUse' })

export type AdminUserChannelUse = z.infer<typeof adminUserChannelUseSchema>

export const adminUsageChannels = ['web', 'android', 'mcp', 'api'] as const

export const adminUsageChannelSchema = z
  .enum(adminUsageChannels)
  .meta({ description: 'Channel a user reads or writes through', id: 'AdminUsageChannel' })

export type AdminUsageChannel = z.infer<typeof adminUsageChannelSchema>

export const adminUserOverviewSchema = z
  .object({
    ...adminUserAccountShape,
    ingest: adminUserIngestSchema,
    last_api_at: iso8601DateTimeSchema
      .nullable()
      .meta({ description: 'Latest last use of the mcp or api channel' }),
    last_ui_at: iso8601DateTimeSchema.nullable().meta({ description: 'Last use of the web app' }),
    use: z
      .object({
        android: adminUserChannelUseSchema,
        api: adminUserChannelUseSchema,
        mcp: adminUserChannelUseSchema,
        web: adminUserChannelUseSchema,
      })
      .meta({ description: 'Use per channel' }),
  })
  .meta({ description: 'One user on the installation, with storage and usage', id: 'AdminUserOverview' })

export type AdminUserOverview = z.infer<typeof adminUserOverviewSchema>

export const adminUsersResponseSchema = baseResponseSchema
  .extend({
    users: z.array(adminUserOverviewSchema).meta({ description: 'Every user, by username' }),
  })
  .meta({ id: 'AdminUsersResponse' })

export type AdminUsersResponse = z.infer<typeof adminUsersResponseSchema>

export const adminUserUsageQuerySchema = z
  .object({
    days: z.coerce
      .number()
      .int()
      .min(1)
      .max(400)
      .default(90)
      .meta({ description: 'Days of daily usage to return, today included (1-400, default 90)' }),
  })
  .meta({ id: 'AdminUserUsageQuery' })

export type AdminUserUsageQuery = z.infer<typeof adminUserUsageQuerySchema>

export const adminUserUsageDaySchema = z
  .object({
    channel: z
      .string()
      .meta({ description: 'web, android, mcp or api for read/write; the data source for ingest' }),
    count: z.number().int().meta({ description: 'Events that day' }),
    day: dateOnlySchema.meta({ description: 'UTC day' }),
    items: z.number().int().meta({ description: 'Items that day (records or points stored, for ingest)' }),
    kind: z.enum(['read', 'write', 'ingest']).meta({ description: 'Kind of usage' }),
  })
  .meta({ description: 'Usage of one kind and channel on one day', id: 'AdminUserUsageDay' })

export type AdminUserUsageDay = z.infer<typeof adminUserUsageDaySchema>

export const adminUserTableSizeSchema = z
  .object({
    bytes: z.number().int().meta({ description: 'Total size including indexes and TOAST' }),
    table: z.string().meta({ description: 'Table name' }),
  })
  .meta({ description: 'Size of one table in a user database', id: 'AdminUserTableSize' })

export type AdminUserTableSize = z.infer<typeof adminUserTableSizeSchema>

export const adminUserUsageSchema = z
  .object({
    ...adminUserAccountShape,
    daily: z.array(adminUserUsageDaySchema).meta({ description: 'Daily usage, oldest first' }),
    largest_tables: z
      .array(adminUserTableSizeSchema)
      .meta({ description: "The user database's ten largest tables, largest first" }),
    since: dateOnlySchema.meta({ description: 'First UTC day covered by daily' }),
  })
  .meta({ description: "One user's daily usage and storage", id: 'AdminUserUsage' })

export type AdminUserUsage = z.infer<typeof adminUserUsageSchema>

export const adminUserUsageResponseSchema = baseResponseSchema
  .extend({
    user: adminUserUsageSchema.optional().meta({ description: 'The user; absent when not found' }),
  })
  .meta({ id: 'AdminUserUsageResponse' })

export type AdminUserUsageResponse = z.infer<typeof adminUserUsageResponseSchema>

export const deleteAccountBodySchema = z
  .object({
    confirm_username: z
      .string()
      .min(1)
      .meta({ description: 'The username of the account being deleted, typed again to confirm' }),
  })
  .meta({
    description:
      'Confirmation for deleting an account. Deletion is permanent: every piece of data is removed and the username can never be used again.',
    id: 'DeleteAccountBody',
  })

export type DeleteAccountBody = z.infer<typeof deleteAccountBodySchema>
