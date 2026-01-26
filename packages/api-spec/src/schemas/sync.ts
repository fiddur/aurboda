/**
 * Sync schemas.
 */

import { z } from 'zod'
import { dateOnlySchema, iso8601DateTimeSchema, syncStatusSchema } from './common.js'

/**
 * Provider sync status schema.
 */
export const providerSyncStatusSchema = z
  .object({
    errorMessage: z.string().nullable().meta({ description: 'Error message if status is error' }),
    lastSyncTime: iso8601DateTimeSchema.nullable().meta({
      description: 'Last successful sync time',
    }),
    provider: z.string().meta({ description: 'Provider name', example: 'oura' }),
    retryAfter: iso8601DateTimeSchema.nullable().meta({
      description: 'Time when retry is allowed',
    }),
    status: syncStatusSchema,
  })
  .meta({ id: 'ProviderSyncStatus' })

export type ProviderSyncStatus = z.infer<typeof providerSyncStatusSchema>

/**
 * Sync status response schema.
 */
export const syncStatusResponseSchema = z
  .object({
    data: z.array(providerSyncStatusSchema).optional(),
    error: z.string().optional(),
    success: z.boolean(),
  })
  .meta({ id: 'SyncStatusResponse' })

export type SyncStatusResponse = z.infer<typeof syncStatusResponseSchema>

/**
 * Sync status query schema.
 */
export const syncStatusQuerySchema = z
  .object({
    provider: z.enum(['oura', 'rescuetime', 'all']).optional().meta({
      description: 'Provider to check (defaults to all)',
    }),
  })
  .meta({ id: 'SyncStatusQuery' })

export type SyncStatusQuery = z.infer<typeof syncStatusQuerySchema>

/**
 * Sync Oura body schema.
 */
export const syncOuraBodySchema = z
  .object({
    full_resync: z.boolean().optional().meta({
      description: 'If true, fetches all historical data',
    }),
    start_date: dateOnlySchema.optional().meta({
      description: 'Start date for sync (only used with full_resync)',
    }),
  })
  .meta({ id: 'SyncOuraBody' })

export type SyncOuraBody = z.infer<typeof syncOuraBodySchema>

/**
 * Sync RescueTime body schema.
 */
export const syncRescueTimeBodySchema = z
  .object({
    full_resync: z.boolean().optional().meta({
      description: 'If true, fetches all historical data',
    }),
    start_date: dateOnlySchema.optional().meta({
      description: 'Start date for sync (only used with full_resync)',
    }),
  })
  .meta({ id: 'SyncRescueTimeBody' })

export type SyncRescueTimeBody = z.infer<typeof syncRescueTimeBodySchema>

/**
 * Sync response schema.
 */
export const syncResponseSchema = z
  .object({
    error: z.string().optional(),
    message: z.string().optional().meta({ description: 'Status message' }),
    success: z.boolean(),
  })
  .meta({ id: 'SyncResponse' })

export type SyncResponse = z.infer<typeof syncResponseSchema>
