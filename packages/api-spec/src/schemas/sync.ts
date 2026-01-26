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
    provider: z.string().meta({ description: 'Provider name', example: 'oura' }),
    status: syncStatusSchema,
    lastSyncTime: iso8601DateTimeSchema.nullable().meta({
      description: 'Last successful sync time',
    }),
    errorMessage: z.string().nullable().meta({ description: 'Error message if status is error' }),
    retryAfter: iso8601DateTimeSchema.nullable().meta({
      description: 'Time when retry is allowed',
    }),
  })
  .meta({ id: 'ProviderSyncStatus' })

export type ProviderSyncStatus = z.infer<typeof providerSyncStatusSchema>

/**
 * Sync status response schema.
 */
export const syncStatusResponseSchema = z
  .object({
    success: z.boolean(),
    data: z.array(providerSyncStatusSchema).optional(),
    error: z.string().optional(),
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
    success: z.boolean(),
    message: z.string().optional().meta({ description: 'Status message' }),
    error: z.string().optional(),
  })
  .meta({ id: 'SyncResponse' })

export type SyncResponse = z.infer<typeof syncResponseSchema>
