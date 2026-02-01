/**
 * Admin settings schemas.
 */

import { z } from 'zod'
import { baseResponseSchema, iso8601DateTimeSchema } from './common.js'

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
    signupAllowed: z
      .boolean()
      .meta({ description: 'Whether signup is allowed (deprecated, use signupMode)' }),
    signupMode: signupModeSchema.meta({ description: 'Current signup mode' }),
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
    isAdmin: z.boolean().optional().meta({ description: 'Whether the user is an admin' }),
    token: z.string().optional().meta({ description: 'Authentication token' }),
  })
  .meta({ id: 'SignupResponse' })

export type SignupResponse = z.infer<typeof signupResponseSchema>

// ============================================================================
// Login endpoint
// ============================================================================

/**
 * Login response schema.
 */
export const loginResponseSchema = z
  .object({
    isAdmin: z.boolean().optional().meta({ description: 'Whether the user is an admin' }),
    refresh: z.string().meta({ description: 'Refresh token' }),
    token: z.string().meta({ description: 'Authentication token' }),
  })
  .meta({ id: 'LoginResponse' })

export type LoginResponse = z.infer<typeof loginResponseSchema>

// ============================================================================
// Admin settings endpoints
// ============================================================================

/**
 * Admin settings response schema.
 */
export const adminSettingsResponseSchema = baseResponseSchema
  .extend({
    admin_count: z.number().int().meta({ description: 'Number of admin users' }),
    signup_mode: signupModeSchema.meta({ description: 'Current signup mode' }),
  })
  .meta({ id: 'AdminSettingsResponse' })

export type AdminSettingsResponse = z.infer<typeof adminSettingsResponseSchema>

/**
 * Update admin settings body schema.
 */
export const updateAdminSettingsBodySchema = z
  .object({
    signup_mode: signupModeSchema.optional().meta({ description: 'New signup mode' }),
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
    expiryHours: z.number().int().positive().optional().meta({
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
    expiresAt: iso8601DateTimeSchema.meta({ description: 'Expiration timestamp' }),
    token: z.string().meta({ description: 'Invitation token' }),
    url: z.string().meta({ description: 'Full invitation URL' }),
  })
  .meta({ id: 'InvitationResponse' })

export type InvitationResponse = z.infer<typeof invitationResponseSchema>
