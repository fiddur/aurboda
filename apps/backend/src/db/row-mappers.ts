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
  activityType: parseActivityType(row.activity_type),
  data: row.data,
  endTime: row.end_time ? new Date(row.end_time) : undefined,
  id: row.id,
  notes: row.notes,
  source: parseDataSource(row.source),
  startTime: new Date(row.start_time),
  title: row.title,
})

export const mapNamedLocationRow = (row: QueryResultRow): NamedLocation => ({
  createdAt: new Date(row.created_at),
  id: row.id,
  lat: row.lat,
  lon: row.lon,
  name: row.name,
  radius: row.radius,
  updatedAt: new Date(row.updated_at),
})

export const mapDetectedLocationRow = (row: QueryResultRow): DetectedLocation => ({
  address: row.address,
  createdAt: new Date(row.created_at),
  firstVisit: new Date(row.first_visit),
  geocodeStatus: parseGeocodeStatus(row.geocode_status),
  id: row.id,
  lastVisit: new Date(row.last_visit),
  lat: row.lat,
  lon: row.lon,
  radius: row.radius,
  totalMinutes: row.total_minutes,
  updatedAt: new Date(row.updated_at),
  visitCount: row.visit_count,
})

export const mapSyncStateRow = (row: QueryResultRow): SyncState => ({
  dataType: row.data_type,
  errorMessage: row.error_message,
  id: row.id,
  lastSyncTime: row.last_sync_time ? new Date(row.last_sync_time) : undefined,
  provider: row.provider,
  retryAfter: row.retry_after ? new Date(row.retry_after) : undefined,
  status: parseSyncStatus(row.status),
  syncStartDate: row.sync_start_date ? new Date(row.sync_start_date) : undefined,
  updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
})

export const mapTagRow = (row: QueryResultRow): Tag => ({
  endTime: row.end_time ? new Date(row.end_time) : undefined,
  externalId: row.external_id,
  id: row.id,
  source: row.source,
  startTime: new Date(row.start_time),
  tag: row.tag,
})

export const mapMcpSessionRow = (row: QueryResultRow): McpSessionRecord => ({
  createdAt: new Date(row.created_at),
  lastActivity: new Date(row.last_activity),
  sessionId: row.session_id,
  username: row.username,
})

export const mapLastFmTagRuleRow = (row: QueryResultRow): LastFmTagRule => ({
  artistName: row.artist_name ?? undefined,
  createdAt: new Date(row.created_at),
  id: row.id,
  matchMode: parseLastFmMatchMode(row.match_mode),
  matchType: parseLastFmMatchType(row.match_type),
  ruleName: row.rule_name,
  tagName: row.tag_name,
  trackName: row.track_name ?? undefined,
})
