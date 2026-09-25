import { z } from 'zod'

import {
  baseResponseSchema,
  createDataArrayResponseSchema,
  cumulativeMetrics,
  dateOnlySchema,
  iso8601DateTimeSchema,
  syncStatusSchema,
} from './common.ts'

const fullResyncSchema = z.boolean().optional().meta({
  description: 'If true, fetches all historical data',
})
const startDateSyncSchema = dateOnlySchema.optional().meta({
  description: 'Start date for sync (only used with full_resync)',
})

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

export const syncStatusResponseSchema = createDataArrayResponseSchema(providerSyncStatusSchema).meta({
  id: 'SyncStatusResponse',
})

export type SyncStatusResponse = z.infer<typeof syncStatusResponseSchema>

export const syncStatusQuerySchema = z
  .object({
    provider: z
      .enum(['oura', 'garmin', 'strava', 'rescuetime', 'calendar', 'lastfm', 'activitywatch', 'gravl', 'all'])
      .optional()
      .meta({
        description: 'Provider to check (defaults to all)',
      }),
  })
  .meta({ id: 'SyncStatusQuery' })

export type SyncStatusQuery = z.infer<typeof syncStatusQuerySchema>

export const syncProviderSchema = z
  .enum(['oura', 'garmin', 'strava', 'rescuetime', 'calendar', 'lastfm', 'activitywatch', 'gravl', 'all'])
  .meta({
    description: 'Which provider to check',
  })

export type SyncProviderType = z.infer<typeof syncProviderSchema>

export const syncOuraBodySchema = z
  .object({
    full_resync: fullResyncSchema,
    start_date: startDateSyncSchema,
  })
  .meta({ id: 'SyncOuraBody' })

export type SyncOuraBody = z.infer<typeof syncOuraBodySchema>

export const syncGarminBodySchema = z
  .object({
    full_resync: fullResyncSchema,
    start_date: startDateSyncSchema,
  })
  .meta({ id: 'SyncGarminBody' })

export type SyncGarminBody = z.infer<typeof syncGarminBodySchema>

export const syncRescueTimeBodySchema = z
  .object({
    full_resync: fullResyncSchema,
    start_date: startDateSyncSchema,
  })
  .meta({ id: 'SyncRescueTimeBody' })

export type SyncRescueTimeBody = z.infer<typeof syncRescueTimeBodySchema>

export const syncGravlBodySchema = z
  .object({
    full_resync: fullResyncSchema,
    start_date: startDateSyncSchema,
  })
  .meta({ id: 'SyncGravlBody' })

export type SyncGravlBody = z.infer<typeof syncGravlBodySchema>

export const syncCalendarsBodySchema = z
  .object({
    full_resync: fullResyncSchema,
  })
  .meta({ id: 'SyncCalendarsBody' })

export type SyncCalendarsBody = z.infer<typeof syncCalendarsBodySchema>

export const syncResponseSchema = baseResponseSchema
  .extend({
    message: z.string().optional().meta({ description: 'Status message' }),
  })
  .meta({ id: 'SyncResponse' })

export type SyncResponse = z.infer<typeof syncResponseSchema>

/** A deduplicated daily total for a cumulative metric from Health Connect. */
export const dailyAggregateSchema = z
  .object({
    data_origins: z.array(z.string()).meta({ description: 'Contributing app package names' }),
    date: dateOnlySchema,
    metric: z.enum(cumulativeMetrics).meta({ description: 'Cumulative metric type' }),
    timezone: z
      .string()
      .meta({
        description: 'IANA timezone of the device when the aggregate was computed (e.g. "Europe/Stockholm")',
        example: 'Europe/Stockholm',
      })
      .optional(),
    value: z.number().meta({ description: 'Aggregated value for the day' }),
  })
  .meta({ id: 'DailyAggregate' })

export interface DailyAggregate {
  data_origins: string[]
  date: string
  metric: (typeof cumulativeMetrics)[number]
  timezone?: string
  value: number
}

export const dailyAggregatesBodySchema = z
  .object({
    data: z.array(dailyAggregateSchema).meta({ description: 'Array of daily aggregates' }),
  })
  .meta({ id: 'DailyAggregatesBody' })

export type DailyAggregatesBody = z.infer<typeof dailyAggregatesBodySchema>

export const healthConnectMetadataSchema = z
  .object({
    id: z.string().optional().meta({ description: 'Record ID from Health Connect' }),
  })
  .passthrough()
  .meta({ id: 'HealthConnectMetadata' })

/** Generic schema for any Health Connect record type. */
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

export const healthConnectSyncBodySchema = z
  .object({
    data: z.union([healthConnectRecordSchema, z.array(healthConnectRecordSchema)]).meta({
      description: 'Single record or array of Health Connect records',
    }),
  })
  .meta({ id: 'HealthConnectSyncBody' })

export type HealthConnectSyncBody = z.infer<typeof healthConnectSyncBodySchema>

/** Sent when Health Connect reports records deleted on the device. */
export const healthConnectDeletionsBodySchema = z
  .object({
    data: z.array(z.string()).min(1).meta({
      description: 'Array of Health Connect record external IDs to delete',
    }),
  })
  .meta({ id: 'HealthConnectDeletionsBody' })

export type HealthConnectDeletionsBody = z.infer<typeof healthConnectDeletionsBodySchema>

export const ouraSyncStatusResponseSchema = baseResponseSchema
  .extend({
    states: z.array(providerSyncStatusSchema).optional().meta({ description: 'Oura sync states' }),
  })
  .meta({ id: 'OuraSyncStatusResponse' })

export type OuraSyncStatusResponse = z.infer<typeof ouraSyncStatusResponseSchema>

export const rescueTimeSyncStatusResponseSchema = baseResponseSchema
  .extend({
    states: z.array(providerSyncStatusSchema).optional().meta({ description: 'RescueTime sync states' }),
  })
  .meta({ id: 'RescueTimeSyncStatusResponse' })

export type RescueTimeSyncStatusResponse = z.infer<typeof rescueTimeSyncStatusResponseSchema>

export const syncResultStatusSchema = z.enum(['success', 'skipped', 'error', 'rate_limited']).meta({
  description: 'Status of sync operation',
  id: 'SyncResultStatus',
})

export type SyncResultStatus = z.infer<typeof syncResultStatusSchema>

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

export const garminDataTypeSchema = z
  .enum([
    'dailySummary',
    'heartRate',
    'hrv',
    'sleep',
    'stress',
    'bodyBattery',
    'activities',
    'spo2',
    'respiration',
    'trainingReadiness',
    'intensityMinutes',
  ])
  .meta({
    description: 'Garmin data type',
    id: 'GarminDataType',
  })

export type GarminDataType = z.infer<typeof garminDataTypeSchema>

export const garminSyncResultSchema = z
  .object({
    data_type: garminDataTypeSchema,
    error: z.string().optional().meta({ description: 'Error message if status is error' }),
    errors_by_day: z
      .number()
      .int()
      .optional()
      .meta({ description: 'Number of days that had fetch errors (data still synced for other days)' }),
    records_processed: z.number().int().meta({ description: 'Number of records processed' }),
    retry_after: iso8601DateTimeSchema.optional().meta({ description: 'Time when retry is allowed' }),
    status: syncResultStatusSchema,
  })
  .meta({ id: 'GarminSyncResult' })

export type GarminSyncResult = z.infer<typeof garminSyncResultSchema>

export const syncStravaBodySchema = z
  .object({
    full_resync: fullResyncSchema,
  })
  .meta({ id: 'SyncStravaBody' })

export type SyncStravaBody = z.infer<typeof syncStravaBodySchema>

export const stravaSyncResultSchema = z
  .object({
    error: z.string().optional().meta({ description: 'Error message if status is error' }),
    status: z
      .enum(['syncing', 'already_syncing', 'queued', 'not_connected'])
      .meta({ description: 'Async sync status' }),
  })
  .meta({ id: 'StravaSyncResult' })

export type StravaSyncResult = z.infer<typeof stravaSyncResultSchema>

export const stravaSyncResponseSchema = baseResponseSchema
  .extend({
    result: stravaSyncResultSchema.optional().meta({ description: 'Sync result' }),
  })
  .meta({ id: 'StravaSyncResponse' })

export type StravaSyncResponse = z.infer<typeof stravaSyncResponseSchema>

export const stravaQueueStatusSchema = z
  .object({
    active_count: z.number().int().meta({ description: 'Jobs currently being processed' }),
    queued_count: z.number().int().meta({ description: 'Jobs waiting in the queue' }),
  })
  .meta({ id: 'StravaQueueStatus' })

export type StravaQueueStatusType = z.infer<typeof stravaQueueStatusSchema>

export const stravaSyncStatusResponseSchema = baseResponseSchema
  .extend({
    queue: stravaQueueStatusSchema.optional().meta({ description: 'Strava job queue status' }),
    states: z.array(providerSyncStatusSchema).optional().meta({ description: 'Strava sync states' }),
  })
  .meta({ id: 'StravaSyncStatusResponse' })

export type StravaSyncStatusResponse = z.infer<typeof stravaSyncStatusResponseSchema>

export const rescueTimeSyncResultSchema = z
  .object({
    error: z.string().optional().meta({ description: 'Error message if status is error' }),
    records_processed: z.number().int().meta({ description: 'Number of records processed' }),
    retry_after: iso8601DateTimeSchema.optional().meta({ description: 'Time when retry is allowed' }),
    status: syncResultStatusSchema,
  })
  .meta({ id: 'RescueTimeSyncResult' })

export type RescueTimeSyncResult = z.infer<typeof rescueTimeSyncResultSchema>

export const gravlSyncResultSchema = z
  .object({
    activities_created: z
      .number()
      .int()
      .meta({ description: 'Workouts stored as new activities (no Health Connect session to enrich)' }),
    activities_enriched: z
      .number()
      .int()
      .meta({ description: 'Existing Health Connect sessions enriched with Gravl set detail' }),
    error: z.string().optional().meta({ description: 'Error message if status is error' }),
    retry_after: iso8601DateTimeSchema.optional().meta({ description: 'Time when retry is allowed' }),
    status: syncResultStatusSchema,
    workouts_processed: z
      .number()
      .int()
      .meta({ description: 'Real (non-external) Gravl workouts seen in the sync window' }),
  })
  .meta({ id: 'GravlSyncResult' })

export type GravlSyncResult = z.infer<typeof gravlSyncResultSchema>

export const gravlSyncResponseSchema = baseResponseSchema
  .extend({
    result: gravlSyncResultSchema.optional().meta({ description: 'Sync result' }),
  })
  .meta({ id: 'GravlSyncResponse' })

export type GravlSyncResponse = z.infer<typeof gravlSyncResponseSchema>

export const gravlSyncStatusResponseSchema = baseResponseSchema
  .extend({
    states: z.array(providerSyncStatusSchema).optional().meta({ description: 'Gravl sync states' }),
  })
  .meta({ id: 'GravlSyncStatusResponse' })

export type GravlSyncStatusResponse = z.infer<typeof gravlSyncStatusResponseSchema>

export const ouraSyncResponseSchema = baseResponseSchema
  .extend({
    results: z.array(ouraSyncResultSchema).optional().meta({ description: 'Sync results per data type' }),
  })
  .meta({ id: 'OuraSyncResponse' })

export type OuraSyncResponse = z.infer<typeof ouraSyncResponseSchema>

export const garminSyncResponseSchema = baseResponseSchema
  .extend({
    results: z.array(garminSyncResultSchema).optional().meta({ description: 'Sync results per data type' }),
    status: z
      .enum(['syncing', 'already_syncing'])
      .optional()
      .meta({ description: 'Async sync status — present when sync runs in the background' }),
  })
  .meta({ id: 'GarminSyncResponse' })

export type GarminSyncResponse = z.infer<typeof garminSyncResponseSchema>

export const garminSyncStatusResponseSchema = baseResponseSchema
  .extend({
    states: z.array(providerSyncStatusSchema).optional().meta({ description: 'Garmin sync states' }),
  })
  .meta({ id: 'GarminSyncStatusResponse' })

export type GarminSyncStatusResponse = z.infer<typeof garminSyncStatusResponseSchema>

export const rescueTimeSyncResponseSchema = baseResponseSchema
  .extend({
    result: rescueTimeSyncResultSchema.optional().meta({ description: 'Sync result' }),
  })
  .meta({ id: 'RescueTimeSyncResponse' })

export type RescueTimeSyncResponse = z.infer<typeof rescueTimeSyncResponseSchema>

export const calendarSyncStatusResponseSchema = baseResponseSchema
  .extend({
    states: z.array(providerSyncStatusSchema).optional().meta({ description: 'Calendar sync states' }),
  })
  .meta({ id: 'CalendarSyncStatusResponse' })

export type CalendarSyncStatusResponse = z.infer<typeof calendarSyncStatusResponseSchema>

export const calendarSyncResultSchema = z
  .object({
    calendar: z.string().meta({ description: 'Calendar name' }),
    error: z.string().optional().meta({ description: 'Error message if status is error' }),
    events_processed: z.number().int().meta({ description: 'Number of events processed' }),
    status: syncResultStatusSchema,
  })
  .meta({ id: 'CalendarSyncResult' })

export type CalendarSyncResult = z.infer<typeof calendarSyncResultSchema>

export const calendarSyncResponseSchema = baseResponseSchema
  .extend({
    results: z.array(calendarSyncResultSchema).optional().meta({ description: 'Sync results per calendar' }),
  })
  .meta({ id: 'CalendarSyncResponse' })

export type CalendarSyncResponse = z.infer<typeof calendarSyncResponseSchema>

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

export const lastFmSyncResultSchema = z
  .object({
    error: z.string().optional().meta({ description: 'Error message if status is error' }),
    scrobbles_processed: z.number().int().meta({ description: 'Number of scrobbles processed' }),
    status: syncResultStatusSchema,
  })
  .meta({ id: 'LastFmSyncResult' })

export type LastFmSyncResult = z.infer<typeof lastFmSyncResultSchema>

export const lastFmSyncResponseSchema = baseResponseSchema
  .extend({
    result: lastFmSyncResultSchema.optional().meta({ description: 'Sync result' }),
  })
  .meta({ id: 'LastFmSyncResponse' })

export type LastFmSyncResponse = z.infer<typeof lastFmSyncResponseSchema>

export const lastFmSyncStatusResponseSchema = baseResponseSchema
  .extend({
    states: z.array(providerSyncStatusSchema).optional().meta({ description: 'Last.fm sync states' }),
  })
  .meta({ id: 'LastFmSyncStatusResponse' })

export type LastFmSyncStatusResponse = z.infer<typeof lastFmSyncStatusResponseSchema>

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

/** Sent by the push agent on each device. */
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

export const activityWatchSyncResultSchema = z
  .object({
    device_name: z.string().meta({ description: 'Device name used for deduplication' }),
    error: z.string().optional().meta({ description: 'Error message if status is error' }),
    records_stored: z.number().int().meta({ description: 'Number of events stored' }),
    status: syncResultStatusSchema,
  })
  .meta({ id: 'ActivityWatchSyncResult' })

export type ActivityWatchSyncResult = z.infer<typeof activityWatchSyncResultSchema>

export const activityWatchSyncResponseSchema = baseResponseSchema
  .extend({
    result: activityWatchSyncResultSchema.optional().meta({ description: 'Sync result' }),
  })
  .meta({ id: 'ActivityWatchSyncResponse' })

export type ActivityWatchSyncResponse = z.infer<typeof activityWatchSyncResponseSchema>

export const activityWatchSyncStatusResponseSchema = baseResponseSchema
  .extend({
    states: z
      .array(providerSyncStatusSchema)
      .optional()
      .meta({ description: 'ActivityWatch sync states per device' }),
  })
  .meta({ id: 'ActivityWatchSyncStatusResponse' })

export type ActivityWatchSyncStatusResponse = z.infer<typeof activityWatchSyncStatusResponseSchema>

/** A single media play pushed by an MPRIS logger. Empty strings mean "not reported by the player". */
export const mediaPlayInputSchema = z
  .object({
    album: z.string(),
    artist: z.string(),
    device: z.string().meta({ description: 'Device the play happened on' }),
    ended_at: iso8601DateTimeSchema,
    id: z
      .string()
      .min(1)
      .max(64)
      .meta({ description: 'Stable client-generated play id; re-posting the same id updates the play' }),
    max_position_secs: z.number().min(0).meta({ description: 'Furthest playback position reached' }),
    played_secs: z.number().min(0).meta({ description: 'Seconds actually played' }),
    player: z.string().meta({ description: 'MPRIS player name, e.g. "firefox" or "mpv"' }),
    seek_count: z.number().int().min(0),
    started_at: iso8601DateTimeSchema,
    title: z.string(),
    track_secs: z
      .number()
      .positive()
      .nullable()
      .meta({ description: 'Track length in seconds, null when the player does not publish it' }),
    url: z.string(),
  })
  .meta({ id: 'MediaPlayInput' })

export type MediaPlayInput = z.infer<typeof mediaPlayInputSchema>

export const syncMediaBodySchema = z
  .object({
    device_name: z.string().max(100).optional().meta({ description: 'Name of the pushing device' }),
    plays: z.array(mediaPlayInputSchema).max(1000).meta({ description: 'Media plays to store' }),
  })
  .meta({ id: 'SyncMediaBody', description: 'Batch of media plays pushed by an MPRIS logger' })

export type SyncMediaBody = z.infer<typeof syncMediaBodySchema>

export const mediaSyncResultSchema = z
  .object({
    plays_received: z.number().int().meta({ description: 'Plays in the request' }),
    plays_stored: z.number().int().meta({ description: 'Plays stored after collapsing duplicate ids' }),
  })
  .meta({ id: 'MediaSyncResult' })

export type MediaSyncResult = z.infer<typeof mediaSyncResultSchema>

export const mediaSyncResponseSchema = baseResponseSchema
  .extend({
    result: mediaSyncResultSchema.optional(),
  })
  .meta({ id: 'MediaSyncResponse' })

export type MediaSyncResponse = z.infer<typeof mediaSyncResponseSchema>
