/**
 * Sync schemas.
 */

import { z } from 'zod'
import {
  baseResponseSchema,
  createDataArrayResponseSchema,
  cumulativeMetrics,
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
    provider: z.enum(['oura', 'rescuetime', 'calendar', 'all']).optional().meta({
      description: 'Provider to check (defaults to all)',
    }),
  })
  .meta({ id: 'SyncStatusQuery' })

export type SyncStatusQuery = z.infer<typeof syncStatusQuerySchema>

/**
 * Sync provider schema (for MCP).
 */
export const syncProviderSchema = z.enum(['oura', 'rescuetime', 'calendar', 'all']).meta({
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
 * Sync Calendars body schema.
 */
export const syncCalendarsBodySchema = z
  .object({
    full_resync: fullResyncSchema,
  })
  .meta({ id: 'SyncCalendarsBody' })

export type SyncCalendarsBody = z.infer<typeof syncCalendarsBodySchema>

/**
 * Sync response schema.
 */
export const syncResponseSchema = baseResponseSchema
  .extend({
    message: z.string().optional().meta({ description: 'Status message' }),
  })
  .meta({ id: 'SyncResponse' })

export type SyncResponse = z.infer<typeof syncResponseSchema>

// ============================================================================
// Daily Aggregates (Health Connect cumulative metrics)
// ============================================================================

/**
 * Daily aggregate item schema.
 * Represents a deduplicated daily total for a cumulative metric from Health Connect.
 */
export const dailyAggregateSchema = z
  .object({
    dataOrigins: z.array(z.string()).meta({ description: 'Contributing app package names' }),
    date: dateOnlySchema,
    metric: z.enum(cumulativeMetrics).meta({ description: 'Cumulative metric type' }),
    value: z.number().meta({ description: 'Aggregated value for the day' }),
  })
  .meta({ id: 'DailyAggregate' })

export type DailyAggregate = z.infer<typeof dailyAggregateSchema>

/**
 * Daily aggregates request body schema.
 */
export const dailyAggregatesBodySchema = z
  .object({
    data: z.array(dailyAggregateSchema).meta({ description: 'Array of daily aggregates' }),
  })
  .meta({ id: 'DailyAggregatesBody' })

export type DailyAggregatesBody = z.infer<typeof dailyAggregatesBodySchema>

// ============================================================================
// Health Connect Generic Sync
// ============================================================================

/**
 * Health Connect record metadata schema.
 */
export const healthConnectMetadataSchema = z
  .object({
    id: z.string().optional().meta({ description: 'Record ID from Health Connect' }),
  })
  .passthrough()
  .meta({ id: 'HealthConnectMetadata' })

/**
 * Health Connect record schema.
 * Generic schema for any Health Connect record type.
 */
export const healthConnectRecordSchema = z
  .object({
    endTime: iso8601DateTimeSchema.optional().meta({ description: 'End time for interval records' }),
    metadata: healthConnectMetadataSchema.optional(),
    startTime: iso8601DateTimeSchema.optional().meta({ description: 'Start time' }),
    time: iso8601DateTimeSchema.optional().meta({ description: 'Time for instant records' }),
  })
  .passthrough()
  .meta({ id: 'HealthConnectRecord' })

export type HealthConnectRecord = z.infer<typeof healthConnectRecordSchema>

/**
 * Health Connect sync request body schema.
 */
export const healthConnectSyncBodySchema = z
  .object({
    data: z.union([healthConnectRecordSchema, z.array(healthConnectRecordSchema)]).meta({
      description: 'Single record or array of Health Connect records',
    }),
  })
  .meta({ id: 'HealthConnectSyncBody' })

export type HealthConnectSyncBody = z.infer<typeof healthConnectSyncBodySchema>

// ============================================================================
// Provider-specific status responses
// ============================================================================

/**
 * Oura sync status response.
 */
export const ouraSyncStatusResponseSchema = baseResponseSchema
  .extend({
    states: z.array(providerSyncStatusSchema).optional().meta({ description: 'Oura sync states' }),
  })
  .meta({ id: 'OuraSyncStatusResponse' })

export type OuraSyncStatusResponse = z.infer<typeof ouraSyncStatusResponseSchema>

/**
 * RescueTime sync status response.
 */
export const rescueTimeSyncStatusResponseSchema = baseResponseSchema
  .extend({
    states: z.array(providerSyncStatusSchema).optional().meta({ description: 'RescueTime sync states' }),
  })
  .meta({ id: 'RescueTimeSyncStatusResponse' })

export type RescueTimeSyncStatusResponse = z.infer<typeof rescueTimeSyncStatusResponseSchema>

// ============================================================================
// Sync result schemas
// ============================================================================

/**
 * Sync result status.
 */
export const syncResultStatusSchema = z.enum(['success', 'skipped', 'error', 'rate_limited']).meta({
  description: 'Status of sync operation',
  id: 'SyncResultStatus',
})

export type SyncResultStatus = z.infer<typeof syncResultStatusSchema>

/**
 * Oura data types that can be synced.
 */
export const ouraDataTypeSchema = z
  .enum(['dailyCardiovascularAge', 'dailyReadiness', 'dailyResilience', 'dailySleep', 'sessions', 'tags'])
  .meta({
    description: 'Oura data type',
    id: 'OuraDataType',
  })

export type OuraDataType = z.infer<typeof ouraDataTypeSchema>

/**
 * Oura sync result for a single data type.
 */
export const ouraSyncResultSchema = z
  .object({
    dataType: ouraDataTypeSchema,
    error: z.string().optional().meta({ description: 'Error message if status is error' }),
    recordsProcessed: z.number().int().meta({ description: 'Number of records processed' }),
    retryAfter: iso8601DateTimeSchema.optional().meta({ description: 'Time when retry is allowed' }),
    status: syncResultStatusSchema,
  })
  .meta({ id: 'OuraSyncResult' })

export type OuraSyncResult = z.infer<typeof ouraSyncResultSchema>

/**
 * RescueTime sync result.
 */
export const rescueTimeSyncResultSchema = z
  .object({
    error: z.string().optional().meta({ description: 'Error message if status is error' }),
    recordsProcessed: z.number().int().meta({ description: 'Number of records processed' }),
    retryAfter: iso8601DateTimeSchema.optional().meta({ description: 'Time when retry is allowed' }),
    status: syncResultStatusSchema,
  })
  .meta({ id: 'RescueTimeSyncResult' })

export type RescueTimeSyncResult = z.infer<typeof rescueTimeSyncResultSchema>

/**
 * Oura sync response with typed results.
 */
export const ouraSyncResponseSchema = baseResponseSchema
  .extend({
    results: z.array(ouraSyncResultSchema).optional().meta({ description: 'Sync results per data type' }),
  })
  .meta({ id: 'OuraSyncResponse' })

export type OuraSyncResponse = z.infer<typeof ouraSyncResponseSchema>

/**
 * RescueTime sync response with typed result.
 */
export const rescueTimeSyncResponseSchema = baseResponseSchema
  .extend({
    result: rescueTimeSyncResultSchema.optional().meta({ description: 'Sync result' }),
  })
  .meta({ id: 'RescueTimeSyncResponse' })

export type RescueTimeSyncResponse = z.infer<typeof rescueTimeSyncResponseSchema>

// ============================================================================
// Calendar sync schemas
// ============================================================================

/**
 * Calendar sync status response.
 */
export const calendarSyncStatusResponseSchema = baseResponseSchema
  .extend({
    states: z.array(providerSyncStatusSchema).optional().meta({ description: 'Calendar sync states' }),
  })
  .meta({ id: 'CalendarSyncStatusResponse' })

export type CalendarSyncStatusResponse = z.infer<typeof calendarSyncStatusResponseSchema>

/**
 * Calendar sync result.
 */
export const calendarSyncResultSchema = z
  .object({
    calendar: z.string().meta({ description: 'Calendar name' }),
    error: z.string().optional().meta({ description: 'Error message if status is error' }),
    eventsProcessed: z.number().int().meta({ description: 'Number of events processed' }),
    status: syncResultStatusSchema,
  })
  .meta({ id: 'CalendarSyncResult' })

export type CalendarSyncResult = z.infer<typeof calendarSyncResultSchema>

/**
 * Calendar sync response.
 */
export const calendarSyncResponseSchema = baseResponseSchema
  .extend({
    results: z.array(calendarSyncResultSchema).optional().meta({ description: 'Sync results per calendar' }),
  })
  .meta({ id: 'CalendarSyncResponse' })

export type CalendarSyncResponse = z.infer<typeof calendarSyncResponseSchema>
