/**
 * Shared type definitions for all db modules.
 *
 * Interfaces and type aliases extracted from the monolithic db.ts.
 * These are imported by both domain modules and row-mappers to avoid circular dependencies.
 */
import type {
  ActivityType,
  CustomMetricDefinition,
  DashboardConfig,
  DataSource,
  Goal,
  MetricType,
} from '@aurboda/api-spec'

// ============================================================================
// Raw Records
// ============================================================================

export interface RawRecord {
  id?: string
  source: DataSource
  record_type: string
  external_id?: string
  recorded_at: Date
  data: Record<string, unknown>
}

// ============================================================================
// Time Series
// ============================================================================

export interface TimeSeriesPoint {
  time: Date
  metric: string
  value: number
  unit?: string
  source: DataSource
}

export interface MetricStats {
  metric: string
  count: number
  min: number
  max: number
  avg: number
  stddev: number
  unit: string
}

export interface DailyMetricAggregate {
  date: string
  metric: string
  avg: number
  sum: number
}

export interface BucketedMetricData {
  bucket_start: Date
  metric: MetricType
  avg: number
  min: number
  max: number
  count: number
}

// ============================================================================
// Activities
// ============================================================================

export interface Activity {
  id?: string
  source: DataSource
  activity_type: ActivityType
  start_time: Date
  end_time?: Date
  title?: string
  notes?: string
  data?: Record<string, unknown>
  deleted_at?: Date
}

export interface MergedActivity extends Activity {
  source_ids?: string[] // only set when 2+ activities were merged
}

export interface ActivityUpdate {
  start_time?: Date
  end_time?: Date
  title?: string
  notes?: string
  data?: Record<string, unknown>
}

// ============================================================================
// Locations
// ============================================================================

export interface Location {
  id?: string
  source?: DataSource
  time: Date
  lat: number
  lon: number
  accuracy?: number
  altitude?: number
  velocity?: number
  regions?: string[]
}

export interface Place {
  id?: string
  source?: DataSource
  external_id?: string
  name: string
  lat: number
  lon: number
  radius: number
}

export interface NamedLocation {
  id: string
  name: string
  lat: number
  lon: number
  radius: number
  created_at: Date
  updated_at: Date
}

export interface NamedLocationInput {
  name: string
  lat: number
  lon: number
  radius?: number
}

export type GeocodeStatus = 'pending' | 'geocoding' | 'success' | 'failed'

export interface DetectedLocation {
  id: string
  lat: number
  lon: number
  radius: number
  total_minutes: number
  visit_count: number
  first_visit: Date
  last_visit: Date
  address: string | null
  geocode_status: GeocodeStatus
  created_at: Date
  updated_at: Date
}

export interface DetectedLocationInput {
  lat: number
  lon: number
  radius?: number
  total_minutes: number
  visit_count: number
  first_visit: Date
  last_visit: Date
}

export interface DetectedLocationUpdate {
  lat?: number
  lon?: number
  radius?: number
  total_minutes?: number
  visit_count?: number
  first_visit?: Date
  last_visit?: Date
  address?: string | null
  geocode_status?: GeocodeStatus
}

// ============================================================================
// Tags
// ============================================================================

export interface Tag {
  id?: string
  source: DataSource
  external_id?: string
  tag: string
  tag_key?: string
  start_time: Date
  end_time?: Date
  deleted_at?: Date
}

// ============================================================================
// Productivity
// ============================================================================

export interface ProductivityRecord {
  id?: string
  source?: DataSource
  start_time: Date
  end_time: Date
  activity: string
  title?: string
  category?: string
  productivity?: number
  duration_sec: number
  is_mobile?: boolean
  device_name?: string
  resolved_category?: string[]
  deleted_at?: Date
}

// ============================================================================
// Screentime Categories
// ============================================================================

export interface ScreentimeCategory {
  id: string
  name: string[]
  rule_type: 'regex' | 'none'
  rule_regex?: string
  ignore_case: boolean
  color?: string
  score?: number
  sort_order: number
  created_at: Date
  updated_at: Date
}

export interface ScreentimeCategoryInput {
  name: string[]
  rule_type: 'regex' | 'none'
  rule_regex?: string
  ignore_case?: boolean
  color?: string
  score?: number
  sort_order?: number
}

// ============================================================================
// Notes
// ============================================================================

export type EntityType = 'activity' | 'tag' | 'productivity' | 'metric'

export interface Note {
  id: string
  entity_type: EntityType
  entity_id: string
  content: string
  /** Inherited from the parent entity's start_time. Null for metric notes (composite key). */
  start_time?: Date
  /** Inherited from the parent entity's end_time, if any. */
  end_time?: Date
  created_at: Date
  updated_at: Date
}

// ============================================================================
// Lab Results
// ============================================================================

export interface LabResult {
  id?: string
  test_date: Date
  test_name: string
  test_category?: string
  value: number
  unit: string
  reference_low?: number
  reference_high?: number
  flag?: 'normal' | 'high' | 'low' | 'critical'
  lab_name?: string
  notes?: string
}

// ============================================================================
// OAuth
// ============================================================================

export interface OAuthToken {
  provider: string
  access_token: string
  refresh_token?: string
  expires_at?: Date
  scopes?: string[]
}

// ============================================================================
// Sync State
// ============================================================================

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'rate_limited'

export interface SyncState {
  id?: string
  provider: string
  data_type: string
  last_sync_time?: Date
  sync_start_date?: Date
  status: SyncStatus
  error_message?: string
  retry_after?: Date
  updated_at?: Date
}

// ============================================================================
// Health Connect
// ============================================================================

export interface DailyAggregate {
  date: string // "2024-01-15"
  metric: string // "steps", "distance", etc.
  value: number
  data_origins: string[] // Contributing app package names
}

// ============================================================================
// User Settings
// ============================================================================

export interface CalendarConfig {
  name: string
  url: string
}

export interface UserSettings {
  birth_date?: string // YYYY-MM-DD
  calendars?: CalendarConfig[] // Calendar ICS URL configurations
  custom_metrics?: CustomMetricDefinition[] // User-defined custom metric types
  dashboard?: DashboardConfig // Custom dashboard configuration
  goals?: Goal[] // User-defined goals for tracking metrics
  hr_zone_start?: { 1: number; 2: number; 3: number; 4: number; 5: number }
  lastfm_username?: string // Last.fm username for scrobble sync
  rescue_time_key?: string // RescueTime API key (personal token)
  tag_icons?: Record<string, string> // Tag icon mappings (tag key or name -> emoji/URL)
  tag_mappings?: Record<string, string> // Tag name mappings from UUIDs to display names
}

// ============================================================================
// Last.fm Tag Rules
// ============================================================================

export type LastFmMatchType = 'track' | 'artist' | 'track_artist'
export type LastFmMatchMode = 'exact' | 'contains'

export interface LastFmTagRule {
  id: string
  rule_name: string
  match_type: LastFmMatchType
  track_name?: string
  artist_name?: string
  artist_names?: string[]
  match_mode: LastFmMatchMode
  tag_name: string
  merge_gap_seconds?: number
  created_at: Date
}

export interface LastFmTagRuleInput {
  rule_name: string
  match_type: LastFmMatchType
  track_name?: string
  artist_name?: string
  artist_names?: string[]
  match_mode?: LastFmMatchMode
  tag_name: string
  merge_gap_seconds?: number
}

// ============================================================================
// MCP Sessions
// ============================================================================

export interface McpSessionRecord {
  session_id: string
  username: string
  created_at: Date
  last_activity: Date
}
