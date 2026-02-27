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
  timeRangeQuerySchema,
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
    error_message: z.string().nullable().meta({ description: 'Error message if status is error' }),
    last_sync_time: iso8601DateTimeSchema.nullable().meta({
      description: 'Last successful sync time',
    }),
    provider: z.string().meta({ description: 'Provider name', example: 'oura' }),
    retry_after: iso8601DateTimeSchema.nullable().meta({
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
    provider: z.enum(['oura', 'rescuetime', 'calendar', 'lastfm', 'activitywatch', 'all']).optional().meta({
      description: 'Provider to check (defaults to all)',
    }),
  })
  .meta({ id: 'SyncStatusQuery' })

export type SyncStatusQuery = z.infer<typeof syncStatusQuerySchema>

/**
 * Sync provider schema (for MCP).
 */
export const syncProviderSchema = z
  .enum(['oura', 'rescuetime', 'calendar', 'lastfm', 'activitywatch', 'all'])
  .meta({
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
    data_origins: z.array(z.string()).meta({ description: 'Contributing app package names' }),
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
    end_time: iso8601DateTimeSchema.optional().meta({ description: 'End time for interval records' }),
    metadata: healthConnectMetadataSchema.optional(),
    start_time: iso8601DateTimeSchema.optional().meta({ description: 'Start time' }),
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
// Health Connect Deletions
// ============================================================================

/**
 * Health Connect deletions request body schema.
 * Used when Health Connect reports deleted records that should be removed from the backend.
 */
export const healthConnectDeletionsBodySchema = z
  .object({
    data: z.array(z.string()).min(1).meta({
      description: 'Array of Health Connect record external IDs to delete',
    }),
  })
  .meta({ id: 'HealthConnectDeletionsBody' })

export type HealthConnectDeletionsBody = z.infer<typeof healthConnectDeletionsBodySchema>

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
  .enum([
    'dailyCardiovascularAge',
    'dailyReadiness',
    'dailyResilience',
    'dailySleep',
    'sessions',
    'sleep',
    'tags',
  ])
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
    data_type: ouraDataTypeSchema,
    error: z.string().optional().meta({ description: 'Error message if status is error' }),
    records_processed: z.number().int().meta({ description: 'Number of records processed' }),
    retry_after: iso8601DateTimeSchema.optional().meta({ description: 'Time when retry is allowed' }),
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
    records_processed: z.number().int().meta({ description: 'Number of records processed' }),
    retry_after: iso8601DateTimeSchema.optional().meta({ description: 'Time when retry is allowed' }),
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
    events_processed: z.number().int().meta({ description: 'Number of events processed' }),
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

// ============================================================================
// Last.fm sync schemas
// ============================================================================

/**
 * Sync Last.fm body schema.
 */
export const syncLastFmBodySchema = z
  .object({
    full_resync: z.boolean().optional().meta({
      description: 'If true, fetches all historical data (default 30 days)',
    }),
    start_date: dateOnlySchema.optional().meta({
      description: 'Start date for sync (only used with full_resync)',
    }),
  })
  .meta({ id: 'SyncLastFmBody' })

export type SyncLastFmBody = z.infer<typeof syncLastFmBodySchema>

/**
 * Last.fm sync result.
 */
export const lastFmSyncResultSchema = z
  .object({
    error: z.string().optional().meta({ description: 'Error message if status is error' }),
    scrobbles_processed: z.number().int().meta({ description: 'Number of scrobbles processed' }),
    status: syncResultStatusSchema,
    tags_created: z.number().int().meta({ description: 'Number of tags created from rules' }),
  })
  .meta({ id: 'LastFmSyncResult' })

export type LastFmSyncResult = z.infer<typeof lastFmSyncResultSchema>

/**
 * Last.fm sync response.
 */
export const lastFmSyncResponseSchema = baseResponseSchema
  .extend({
    result: lastFmSyncResultSchema.optional().meta({ description: 'Sync result' }),
  })
  .meta({ id: 'LastFmSyncResponse' })

export type LastFmSyncResponse = z.infer<typeof lastFmSyncResponseSchema>

/**
 * Last.fm sync status response.
 */
export const lastFmSyncStatusResponseSchema = baseResponseSchema
  .extend({
    states: z.array(providerSyncStatusSchema).optional().meta({ description: 'Last.fm sync states' }),
  })
  .meta({ id: 'LastFmSyncStatusResponse' })

export type LastFmSyncStatusResponse = z.infer<typeof lastFmSyncStatusResponseSchema>

// ============================================================================
// Last.fm tag rules schemas
// ============================================================================

/**
 * Last.fm match type for tag rules.
 */
export const lastFmMatchTypeSchema = z.enum(['track', 'artist', 'track_artist']).meta({
  description:
    'Type of match: track (any scrobble with track name), artist (any scrobble by artist), track_artist (exact track + artist)',
  id: 'LastFmMatchType',
})

export type LastFmMatchType = z.infer<typeof lastFmMatchTypeSchema>

/**
 * Last.fm match mode for tag rules.
 */
export const lastFmMatchModeSchema = z.enum(['exact', 'contains']).meta({
  description: 'How to match: exact (case-insensitive exact match) or contains (substring match)',
  id: 'LastFmMatchMode',
})

export type LastFmMatchMode = z.infer<typeof lastFmMatchModeSchema>

/**
 * Last.fm tag rule schema.
 */
export const lastFmTagRuleSchema = z
  .object({
    artist_name: z
      .string()
      .optional()
      .meta({ description: 'Artist name to match (for artist or track_artist match type)' }),
    artist_names: z
      .array(z.string())
      .optional()
      .meta({ description: 'Multiple artist names to match (takes precedence over artistName when set)' }),
    created_at: z.string().meta({ description: 'When the rule was created' }),
    id: z.string().uuid().meta({ description: 'Unique rule ID' }),
    match_mode: lastFmMatchModeSchema,
    match_type: lastFmMatchTypeSchema,
    merge_gap_seconds: z.number().int().positive().nullable().optional().meta({
      description:
        'Session merge gap in seconds. When set, consecutive matching scrobbles within this gap are merged into a single span tag.',
    }),
    rule_name: z.string().meta({ description: 'Human-readable name for the rule' }),
    tag_name: z.string().meta({ description: 'Tag to create when rule matches' }),
    track_name: z
      .string()
      .optional()
      .meta({ description: 'Track name to match (for track or track_artist match type)' }),
  })
  .meta({ id: 'LastFmTagRule' })

export type LastFmTagRule = z.infer<typeof lastFmTagRuleSchema>

/**
 * Add Last.fm tag rule body schema.
 */
export const addLastFmTagRuleBodySchema = z
  .object({
    artist_name: z
      .string()
      .optional()
      .meta({ description: 'Artist name to match (required for artist or track_artist match type)' }),
    artist_names: z
      .array(z.string())
      .optional()
      .meta({ description: 'Multiple artist names to match (takes precedence over artistName when set)' }),
    match_mode: lastFmMatchModeSchema
      .optional()
      .default('exact')
      .meta({ description: 'Match mode (default: exact)' }),
    match_type: lastFmMatchTypeSchema,
    merge_gap_seconds: z.number().int().positive().nullable().optional().meta({
      description:
        'Session merge gap in seconds. When set, consecutive matching scrobbles within this gap are merged into a single span tag.',
    }),
    rule_name: z.string().min(1).meta({ description: 'Human-readable name for the rule' }),
    tag_name: z.string().min(1).meta({ description: 'Tag to create when rule matches' }),
    track_name: z
      .string()
      .optional()
      .meta({ description: 'Track name to match (required for track or track_artist match type)' }),
  })
  .meta({ id: 'AddLastFmTagRuleBody' })

export type AddLastFmTagRuleBody = z.infer<typeof addLastFmTagRuleBodySchema>

/**
 * Last.fm tag rules response.
 */
export const lastFmTagRulesResponseSchema = baseResponseSchema
  .extend({
    data: z.array(lastFmTagRuleSchema).meta({ description: 'List of tag rules' }),
  })
  .meta({ id: 'LastFmTagRulesResponse' })

export type LastFmTagRulesResponse = z.infer<typeof lastFmTagRulesResponseSchema>

/**
 * Add Last.fm tag rule response.
 */
export const addLastFmTagRuleResponseSchema = baseResponseSchema
  .extend({
    data: lastFmTagRuleSchema
      .extend({
        tags_applied: z
          .number()
          .int()
          .optional()
          .meta({ description: 'Number of tags retroactively created from existing scrobbles' }),
      })
      .optional()
      .meta({ description: 'Created tag rule' }),
  })
  .meta({ id: 'AddLastFmTagRuleResponse' })

export type AddLastFmTagRuleResponse = z.infer<typeof addLastFmTagRuleResponseSchema>

/**
 * Delete Last.fm tag rule response.
 */
export const deleteLastFmTagRuleResponseSchema = baseResponseSchema
  .extend({
    tags_removed: z.number().int().optional().meta({ description: 'Number of auto-generated tags removed' }),
  })
  .meta({ id: 'DeleteLastFmTagRuleResponse' })

export type DeleteLastFmTagRuleResponse = z.infer<typeof deleteLastFmTagRuleResponseSchema>

/**
 * Last.fm retag response.
 */
export const retagLastFmResponseSchema = baseResponseSchema
  .extend({
    tags_created: z.number().int().optional().meta({ description: 'Number of tags created' }),
    tags_deleted: z.number().int().optional().meta({ description: 'Number of tags deleted' }),
  })
  .meta({ id: 'RetagLastFmResponse' })

export type RetagLastFmResponse = z.infer<typeof retagLastFmResponseSchema>

// ============================================================================
// Last.fm scrobbles query schemas
// ============================================================================

/**
 * Scrobble record schema.
 */
export const scrobbleSchema = z
  .object({
    album: z.string().meta({ description: 'Album name' }),
    artist: z.string().meta({ description: 'Artist name' }),
    recorded_at: iso8601DateTimeSchema.meta({ description: 'When the track was played' }),
    track: z.string().meta({ description: 'Track name' }),
  })
  .meta({ id: 'Scrobble' })

export type Scrobble = z.infer<typeof scrobbleSchema>

/**
 * Scrobbles query schema.
 */
export const scrobblesQuerySchema = timeRangeQuerySchema.meta({ id: 'ScrobblesQuery' })

export type ScrobblesQuery = z.infer<typeof scrobblesQuerySchema>

/**
 * Scrobbles response schema.
 */
export const scrobblesResponseSchema = createDataArrayResponseSchema(scrobbleSchema).meta({
  id: 'ScrobblesResponse',
})

export type ScrobblesResponse = z.infer<typeof scrobblesResponseSchema>

// ============================================================================
// ActivityWatch push sync schemas
// ============================================================================

/**
 * A single ActivityWatch event (from aw-watcher-window or aw-watcher-android).
 */
export const activityWatchEventSchema = z
  .object({
    app: z.string().meta({ description: 'Application name' }),
    duration: z.number().meta({ description: 'Duration in seconds' }),
    timestamp: iso8601DateTimeSchema.meta({ description: 'Event start time (ISO 8601)' }),
    title: z.string().optional().meta({ description: 'Window title' }),
  })
  .meta({ id: 'ActivityWatchEvent' })

export type ActivityWatchEvent = z.infer<typeof activityWatchEventSchema>

/**
 * Request body for POST /sync/activitywatch.
 * Sent by the push agent on each device.
 */
export const syncActivityWatchBodySchema = z
  .object({
    device_name: z.string().max(100).optional().meta({
      description: 'Hostname or user-configured device name. Defaults to empty string (single-device setup).',
    }),
    events: z.array(activityWatchEventSchema).min(1).meta({ description: 'ActivityWatch events to store' }),
    is_mobile: z.boolean().optional().meta({
      description: 'Whether the events come from a mobile device. Defaults to false.',
    }),
  })
  .meta({ id: 'SyncActivityWatchBody' })

export type SyncActivityWatchBody = z.infer<typeof syncActivityWatchBodySchema>

/**
 * ActivityWatch sync result.
 */
export const activityWatchSyncResultSchema = z
  .object({
    device_name: z.string().meta({ description: 'Device name used for deduplication' }),
    error: z.string().optional().meta({ description: 'Error message if status is error' }),
    records_stored: z.number().int().meta({ description: 'Number of events stored' }),
    status: syncResultStatusSchema,
  })
  .meta({ id: 'ActivityWatchSyncResult' })

export type ActivityWatchSyncResult = z.infer<typeof activityWatchSyncResultSchema>

/**
 * ActivityWatch sync response.
 */
export const activityWatchSyncResponseSchema = baseResponseSchema
  .extend({
    result: activityWatchSyncResultSchema.optional().meta({ description: 'Sync result' }),
  })
  .meta({ id: 'ActivityWatchSyncResponse' })

export type ActivityWatchSyncResponse = z.infer<typeof activityWatchSyncResponseSchema>

/**
 * ActivityWatch sync status response.
 */
export const activityWatchSyncStatusResponseSchema = baseResponseSchema
  .extend({
    states: z
      .array(providerSyncStatusSchema)
      .optional()
      .meta({ description: 'ActivityWatch sync states per device' }),
  })
  .meta({ id: 'ActivityWatchSyncStatusResponse' })

export type ActivityWatchSyncStatusResponse = z.infer<typeof activityWatchSyncStatusResponseSchema>
