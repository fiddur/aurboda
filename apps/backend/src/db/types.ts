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
  recordType: string
  externalId?: string
  recordedAt: Date
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
  bucketStart: Date
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
  activityType: ActivityType
  startTime: Date
  endTime?: Date
  title?: string
  notes?: string
  data?: Record<string, unknown>
}

export interface ActivityUpdate {
  startTime?: Date
  endTime?: Date
  title?: string
  notes?: string
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
  externalId?: string
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
  createdAt: Date
  updatedAt: Date
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
  totalMinutes: number
  visitCount: number
  firstVisit: Date
  lastVisit: Date
  address: string | null
  geocodeStatus: GeocodeStatus
  createdAt: Date
  updatedAt: Date
}

export interface DetectedLocationInput {
  lat: number
  lon: number
  radius?: number
  totalMinutes: number
  visitCount: number
  firstVisit: Date
  lastVisit: Date
}

export interface DetectedLocationUpdate {
  lat?: number
  lon?: number
  radius?: number
  totalMinutes?: number
  visitCount?: number
  firstVisit?: Date
  lastVisit?: Date
  address?: string | null
  geocodeStatus?: GeocodeStatus
}

// ============================================================================
// Tags
// ============================================================================

export interface Tag {
  id?: string
  source: DataSource
  externalId?: string
  tag: string
  startTime: Date
  endTime?: Date
}

// ============================================================================
// Productivity
// ============================================================================

export interface ProductivityRecord {
  source?: DataSource
  startTime: Date
  endTime: Date
  activity: string
  category?: string
  productivity?: number
  durationSec: number
  isMobile?: boolean
}

// ============================================================================
// Lab Results
// ============================================================================

export interface LabResult {
  id?: string
  testDate: Date
  testName: string
  testCategory?: string
  value: number
  unit: string
  referenceLow?: number
  referenceHigh?: number
  flag?: 'normal' | 'high' | 'low' | 'critical'
  labName?: string
  notes?: string
}

// ============================================================================
// OAuth
// ============================================================================

export interface OAuthToken {
  provider: string
  accessToken: string
  refreshToken?: string
  expiresAt?: Date
  scopes?: string[]
}

// ============================================================================
// Sync State
// ============================================================================

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'rate_limited'

export interface SyncState {
  id?: string
  provider: string
  dataType: string
  lastSyncTime?: Date
  syncStartDate?: Date
  status: SyncStatus
  errorMessage?: string
  retryAfter?: Date
  updatedAt?: Date
}

// ============================================================================
// Health Connect
// ============================================================================

export interface DailyAggregate {
  date: string // "2024-01-15"
  metric: string // "steps", "distance", etc.
  value: number
  dataOrigins: string[] // Contributing app package names
}

// ============================================================================
// User Settings
// ============================================================================

export interface CalendarConfig {
  name: string
  url: string
}

export interface UserSettings {
  birthDate?: string // YYYY-MM-DD
  calendars?: CalendarConfig[] // Calendar ICS URL configurations
  customMetrics?: CustomMetricDefinition[] // User-defined custom metric types
  dashboard?: DashboardConfig // Custom dashboard configuration
  goals?: Goal[] // User-defined goals for tracking metrics
  hrZoneStart?: { 1: number; 2: number; 3: number; 4: number; 5: number }
  lastFmUsername?: string // Last.fm username for scrobble sync
  rescueTimeKey?: string // RescueTime API key (personal token)
  tagMappings?: Record<string, string> // Tag name mappings from UUIDs to display names
}

// ============================================================================
// Last.fm Tag Rules
// ============================================================================

export type LastFmMatchType = 'track' | 'artist' | 'track_artist'
export type LastFmMatchMode = 'exact' | 'contains'

export interface LastFmTagRule {
  id: string
  ruleName: string
  matchType: LastFmMatchType
  trackName?: string
  artistName?: string
  artistNames?: string[]
  matchMode: LastFmMatchMode
  tagName: string
  mergeGapSeconds?: number
  createdAt: Date
}

export interface LastFmTagRuleInput {
  ruleName: string
  matchType: LastFmMatchType
  trackName?: string
  artistName?: string
  artistNames?: string[]
  matchMode?: LastFmMatchMode
  tagName: string
  mergeGapSeconds?: number
}

// ============================================================================
// MCP Sessions
// ============================================================================

export interface McpSessionRecord {
  sessionId: string
  username: string
  createdAt: Date
  lastActivity: Date
}
