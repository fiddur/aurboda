/**
 * Admin settings schemas.
 */

import { z } from 'zod'

import { baseResponseSchema, iso8601DateTimeSchema } from './common.ts'

// ============================================================================
// Signup Mode
// ============================================================================

/**
 * Signup mode enum.
 */
export const signupModeSchema = z.enum(['open', 'invite_only', 'closed']).meta({
  description: 'Server signup mode',
  example: 'open',
  id: 'SignupMode',
})

export type SignupMode = z.infer<typeof signupModeSchema>

// ============================================================================
// Status endpoint (public)
// ============================================================================

/**
 * Server status response schema.
 */
export const serverStatusResponseSchema = baseResponseSchema
  .extend({
    // For backwards compatibility
    signup_allowed: z
      .boolean()
      .meta({ description: 'Whether signup is allowed (deprecated, use signupMode)' }),
    signup_mode: signupModeSchema.meta({ description: 'Current signup mode' }),
  })
  .meta({ id: 'ServerStatusResponse' })

export type ServerStatusResponse = z.infer<typeof serverStatusResponseSchema>

// ============================================================================
// Signup endpoint
// ============================================================================

/**
 * Signup request body schema.
 */
export const signupBodySchema = z
  .object({
    invitation: z
      .string()
      .optional()
      .meta({ description: 'Invitation token (required in invite_only mode)' }),
    password: z.string().min(1).meta({ description: 'User password' }),
    username: z.string().min(1).meta({ description: 'Username' }),
  })
  .meta({ id: 'SignupBody' })

export type SignupBody = z.infer<typeof signupBodySchema>

/**
 * Signup response schema.
 */
export const signupResponseSchema = baseResponseSchema
  .extend({
    is_admin: z.boolean().optional().meta({ description: 'Whether the user is an admin' }),
    token: z.string().optional().meta({ description: 'Authentication token' }),
  })
  .meta({ id: 'SignupResponse' })

export type SignupResponse = z.infer<typeof signupResponseSchema>

// ============================================================================
// Login endpoint
// ============================================================================

/**
 * Login request body schema.
 */
export const loginBodySchema = z
  .object({
    password: z.string().min(1).meta({ description: 'User password' }),
    username: z.string().min(1).meta({ description: 'Username' }),
  })
  .meta({ id: 'LoginBody' })

export type LoginBody = z.infer<typeof loginBodySchema>

/**
 * Login response schema.
 */
export const loginResponseSchema = z
  .object({
    is_admin: z.boolean().optional().meta({ description: 'Whether the user is an admin' }),
    token: z.string().meta({ description: 'Authentication token' }),
  })
  .meta({ id: 'LoginResponse' })

export type LoginResponse = z.infer<typeof loginResponseSchema>

// ============================================================================
// Version and auth token endpoints
// ============================================================================

/**
 * Version response schema.
 */
export const versionResponseSchema = baseResponseSchema
  .extend({
    build_sha: z.string().meta({ description: 'Build commit SHA or "dev"' }),
  })
  .meta({ id: 'VersionResponse' })

export type VersionResponse = z.infer<typeof versionResponseSchema>

/**
 * Auth token response schema.
 */
export const authTokenResponseSchema = baseResponseSchema
  .extend({
    token: z.string().meta({ description: 'Fresh API token' }),
  })
  .meta({ id: 'AuthTokenResponse' })

export type AuthTokenResponse = z.infer<typeof authTokenResponseSchema>

// ============================================================================
// Admin settings endpoints
// ============================================================================

/**
 * Admin settings response schema.
 */
export const adminSettingsResponseSchema = baseResponseSchema
  .extend({
    admin_count: z.number().int().meta({ description: 'Number of admin users' }),
    audit_log_retention_days: z
      .number()
      .int()
      .meta({ description: 'Number of days to keep audit log entries (default: 3)' }),
    lastfm_api_key_set: z.boolean().meta({ description: 'Whether a Last.fm API key is configured' }),
    oura_client_id_set: z.boolean().meta({ description: 'Whether an Oura client ID is configured' }),
    oura_client_secret_set: z.boolean().meta({ description: 'Whether an Oura client secret is configured' }),
    oura_webhook_available: z.boolean().meta({
      description: 'Whether Oura webhook push can be enabled (requires HTTPS and Oura credentials)',
    }),
    oura_webhook_enabled: z.boolean().meta({ description: 'Whether Oura webhook push sync is enabled' }),
    sentry_dsn: z
      .string()
      .nullable()
      .meta({ description: 'Sentry DSN for backend error reporting (null if not configured)' }),
    signup_mode: signupModeSchema.meta({ description: 'Current signup mode' }),
    strava_client_id_set: z.boolean().meta({ description: 'Whether a Strava client ID is configured' }),
    strava_client_secret_set: z
      .boolean()
      .meta({ description: 'Whether a Strava client secret is configured' }),
  })
  .meta({ id: 'AdminSettingsResponse' })

export type AdminSettingsResponse = z.infer<typeof adminSettingsResponseSchema>

/**
 * Update admin settings body schema.
 */
export const updateAdminSettingsBodySchema = z
  .object({
    audit_log_retention_days: z
      .number()
      .int()
      .positive()
      .max(365)
      .optional()
      .meta({ description: 'Number of days to keep audit log entries (1-365, default: 3)' }),
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
  })
  .meta({ id: 'UpdateAdminSettingsBody' })

export type UpdateAdminSettingsBody = z.infer<typeof updateAdminSettingsBodySchema>

// ============================================================================
// Invitation endpoints
// ============================================================================

/**
 * Create invitation body schema.
 */
export const createInvitationBodySchema = z
  .object({
    expiry_hours: z.number().int().positive().optional().meta({
      description: 'Hours until invitation expires (default: 168 = 7 days)',
      example: 168,
    }),
  })
  .meta({ id: 'CreateInvitationBody' })

export type CreateInvitationBody = z.infer<typeof createInvitationBodySchema>

/**
 * Invitation response schema.
 */
export const invitationResponseSchema = baseResponseSchema
  .extend({
    expires_at: iso8601DateTimeSchema.meta({ description: 'Expiration timestamp' }),
    token: z.string().meta({ description: 'Invitation token' }),
    url: z.string().meta({ description: 'Full invitation URL' }),
  })
  .meta({ id: 'InvitationResponse' })

export type InvitationResponse = z.infer<typeof invitationResponseSchema>
