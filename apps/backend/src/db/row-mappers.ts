/**
 * Row mapper functions for converting PostgreSQL rows to typed objects.
 *
 * Replaces inline `as Type` casts with validated type guards.
 */
import { activityTypes, type ActivityType, type DataSource, type MetricType } from '@aurboda/api-spec'
import type { QueryResultRow } from 'pg'
import type {
  Activity,
  DetectedLocation,
  GeocodeStatus,
  LastFmTagRule,
  McpSessionRecord,
  NamedLocation,
  SyncState,
  SyncStatus,
  Tag,
} from './types'

// ============================================================================
// Type Guards
// ============================================================================

const VALID_DATA_SOURCES = [
  'health_connect',
  'health_connect_aggregate',
  'oura',
  'garmin',
  'rescuetime',
  'owntracks',
  'calendar',
  'manual',
  'lastfm',
] as const

const VALID_GEOCODE_STATUSES = ['pending', 'geocoding', 'success', 'failed'] as const
const VALID_SYNC_STATUSES = ['idle', 'syncing', 'error', 'rate_limited'] as const
const VALID_LASTFM_MATCH_TYPES = ['track', 'artist', 'track_artist'] as const
const VALID_LASTFM_MATCH_MODES = ['exact', 'contains'] as const

export const parseActivityType = (value: unknown): ActivityType => {
  if (typeof value === 'string' && (activityTypes as readonly string[]).includes(value)) {
    return value as ActivityType
  }
  throw new Error(`Invalid ActivityType: ${JSON.stringify(value)}`)
}

export const parseDataSource = (value: unknown): DataSource => {
  if (typeof value === 'string' && (VALID_DATA_SOURCES as readonly string[]).includes(value)) {
    return value as DataSource
  }
  throw new Error(`Invalid DataSource: ${JSON.stringify(value)}`)
}

export const parseGeocodeStatus = (value: unknown): GeocodeStatus => {
  if (typeof value === 'string' && (VALID_GEOCODE_STATUSES as readonly string[]).includes(value)) {
    return value as GeocodeStatus
  }
  throw new Error(`Invalid GeocodeStatus: ${JSON.stringify(value)}`)
}

export const parseSyncStatus = (value: unknown): SyncStatus => {
  if (typeof value === 'string' && (VALID_SYNC_STATUSES as readonly string[]).includes(value)) {
    return value as SyncStatus
  }
  throw new Error(`Invalid SyncStatus: ${JSON.stringify(value)}`)
}

export const parseMetricType = (value: unknown): MetricType => {
  // MetricType is a wide union; for DB rows we trust the value is valid
  if (typeof value !== 'string') {
    throw new Error(`Invalid MetricType: ${JSON.stringify(value)}`)
  }
  return value as MetricType
}

const parseLastFmMatchType = (value: unknown) => {
  if (typeof value === 'string' && (VALID_LASTFM_MATCH_TYPES as readonly string[]).includes(value)) {
    return value as (typeof VALID_LASTFM_MATCH_TYPES)[number]
  }
  throw new Error(`Invalid LastFmMatchType: ${JSON.stringify(value)}`)
}

const parseLastFmMatchMode = (value: unknown) => {
  if (typeof value === 'string' && (VALID_LASTFM_MATCH_MODES as readonly string[]).includes(value)) {
    return value as (typeof VALID_LASTFM_MATCH_MODES)[number]
  }
  throw new Error(`Invalid LastFmMatchMode: ${JSON.stringify(value)}`)
}

// ============================================================================
// Row Mappers
// ============================================================================

export const mapActivityRow = (row: QueryResultRow): Activity => ({
  activity_type: parseActivityType(row.activity_type),
  data: row.data,
  end_time: row.end_time ? new Date(row.end_time) : undefined,
  id: row.id,
  notes: row.notes,
  source: parseDataSource(row.source),
  start_time: new Date(row.start_time),
  title: row.title,
})

export const mapNamedLocationRow = (row: QueryResultRow): NamedLocation => ({
  created_at: new Date(row.created_at),
  id: row.id,
  lat: row.lat,
  lon: row.lon,
  name: row.name,
  radius: row.radius,
  updated_at: new Date(row.updated_at),
})

export const mapDetectedLocationRow = (row: QueryResultRow): DetectedLocation => ({
  address: row.address,
  created_at: new Date(row.created_at),
  first_visit: new Date(row.first_visit),
  geocode_status: parseGeocodeStatus(row.geocode_status),
  id: row.id,
  last_visit: new Date(row.last_visit),
  lat: row.lat,
  lon: row.lon,
  radius: row.radius,
  total_minutes: row.total_minutes,
  updated_at: new Date(row.updated_at),
  visit_count: row.visit_count,
})

export const mapSyncStateRow = (row: QueryResultRow): SyncState => ({
  data_type: row.data_type,
  error_message: row.error_message,
  id: row.id,
  last_sync_time: row.last_sync_time ? new Date(row.last_sync_time) : undefined,
  provider: row.provider,
  retry_after: row.retry_after ? new Date(row.retry_after) : undefined,
  status: parseSyncStatus(row.status),
  sync_start_date: row.sync_start_date ? new Date(row.sync_start_date) : undefined,
  updated_at: row.updated_at ? new Date(row.updated_at) : undefined,
})

export const mapTagRow = (row: QueryResultRow): Tag => ({
  end_time: row.end_time ? new Date(row.end_time) : undefined,
  external_id: row.external_id,
  id: row.id,
  source: row.source,
  start_time: new Date(row.start_time),
  tag: row.tag,
  tag_key: row.tag_key ?? undefined,
})

export const mapMcpSessionRow = (row: QueryResultRow): McpSessionRecord => ({
  created_at: new Date(row.created_at),
  last_activity: new Date(row.last_activity),
  session_id: row.session_id,
  username: row.username,
})

export const mapLastFmTagRuleRow = (row: QueryResultRow): LastFmTagRule => ({
  artist_name: row.artist_name ?? undefined,
  artist_names: row.artist_names ?? undefined,
  created_at: new Date(row.created_at),
  id: row.id,
  match_mode: parseLastFmMatchMode(row.match_mode),
  match_type: parseLastFmMatchType(row.match_type),
  merge_gap_seconds: row.merge_gap_seconds ?? undefined,
  rule_name: row.rule_name,
  tag_name: row.tag_name,
  track_name: row.track_name ?? undefined,
})
