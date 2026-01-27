/**
 * Sync schemas.
 */

import { z } from 'zod'
import {
  baseResponseSchema,
  createDataArrayResponseSchema,
  dateOnlySchema,
  iso8601DateTimeSchema,
  syncStatusSchema,
} from './common.js'

// Shared sync options fields
const fullResyncSchema = z.boolean().optional().meta({
  description: 'If true, fetches all historical data',
})
const startDateSyncSchema = dateOnlySchema.optional().meta({
  description: 'Start date for sync (only used with full_resync)',
})

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
export const syncStatusResponseSchema = createDataArrayResponseSchema(providerSyncStatusSchema).meta({
  id: 'SyncStatusResponse',
})

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
 * Sync provider schema (for MCP).
 */
export const syncProviderSchema = z.enum(['oura', 'rescuetime', 'all']).meta({
  description: 'Which provider to check',
})

export type SyncProviderType = z.infer<typeof syncProviderSchema>

/**
 * Sync Oura body schema.
 */
export const syncOuraBodySchema = z
  .object({
    full_resync: fullResyncSchema,
    start_date: startDateSyncSchema,
  })
  .meta({ id: 'SyncOuraBody' })

export type SyncOuraBody = z.infer<typeof syncOuraBodySchema>

/**
 * Sync RescueTime body schema.
 */
export const syncRescueTimeBodySchema = z
  .object({
    full_resync: fullResyncSchema,
    start_date: startDateSyncSchema,
  })
  .meta({ id: 'SyncRescueTimeBody' })

export type SyncRescueTimeBody = z.infer<typeof syncRescueTimeBodySchema>

/**
 * Sync response schema.
 */
export const syncResponseSchema = baseResponseSchema
  .extend({
    message: z.string().optional().meta({ description: 'Status message' }),
  })
  .meta({ id: 'SyncResponse' })

export type SyncResponse = z.infer<typeof syncResponseSchema>
