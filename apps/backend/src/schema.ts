/**
 * Database schema definitions for Aurboda.
 *
 * This module contains all table creation SQL and schema-related utilities.
 * See docs/data-storage.md for design decisions and data flow documentation.
 */

// Re-export common types from shared api-spec package
export {
  contextualHrvMetrics,
  cumulativeMetrics,
  getMetricUnit,
  hrZoneMetrics,
  isContextualHrvMetric,
  isHrZoneMetric,
  isValidMetric,
  isValidMetricOrCustom,
  metricUnits,
  validMetrics,
  type ActivityType,
  type CustomMetricDefinition,
  type DataSource,
  type MetricType,
} from '@aurboda/api-spec'

// Import types for use in local mappings
import type { ActivityType, MetricType } from '@aurboda/api-spec'

export const SCHEMA_VERSION = 1

/**
 * All table creation statements in dependency order.
 * Each table is created with proper indexes for query performance.
 */
export const createTableStatements: Record<string, string> = {
  // Time-ranged activities (sleep, exercise, meditation)
  activities: `
    CREATE TABLE IF NOT EXISTS activities (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source          VARCHAR(50) NOT NULL,
      activity_type   VARCHAR(50) NOT NULL,
      start_time      TIMESTAMPTZ NOT NULL,
      end_time        TIMESTAMPTZ,
      title           VARCHAR(255),
      notes           TEXT,
      data            JSONB,
      deleted_at      TIMESTAMPTZ,
      CONSTRAINT unique_activity UNIQUE (source, activity_type, start_time)
    )
  `,

  activities_indexes: `
    CREATE INDEX IF NOT EXISTS idx_activities_type_time ON activities (activity_type, start_time DESC);
    CREATE INDEX IF NOT EXISTS idx_activities_time_range ON activities (start_time, end_time);
    CREATE INDEX IF NOT EXISTS idx_activities_not_deleted ON activities (activity_type, start_time DESC) WHERE deleted_at IS NULL
  `,

  // Detected locations (clusters detected from GPS data with geocoded addresses)
  detected_locations: `
    CREATE TABLE IF NOT EXISTS detected_locations (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      location        GEOGRAPHY(POINT, 4326) NOT NULL,
      radius          INTEGER NOT NULL DEFAULT 200,
      total_minutes   INTEGER NOT NULL DEFAULT 0,
      visit_count     INTEGER NOT NULL DEFAULT 0,
      first_visit     TIMESTAMPTZ NOT NULL,
      last_visit      TIMESTAMPTZ NOT NULL,
      address         TEXT,
      geocode_status  VARCHAR(20) DEFAULT 'pending',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,

  detected_locations_indexes: `
    CREATE INDEX IF NOT EXISTS idx_detected_locations_geo
      ON detected_locations USING GIST (location);
    CREATE INDEX IF NOT EXISTS idx_detected_locations_geocode_status
      ON detected_locations (geocode_status) WHERE geocode_status = 'pending'
  `,

  // Lab results / blood work
  lab_results: `
    CREATE TABLE IF NOT EXISTS lab_results (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      test_date       DATE NOT NULL,
      test_name       VARCHAR(100) NOT NULL,
      test_category   VARCHAR(50),
      value           DOUBLE PRECISION NOT NULL,
      unit            VARCHAR(30) NOT NULL,
      reference_low   DOUBLE PRECISION,
      reference_high  DOUBLE PRECISION,
      flag            VARCHAR(10),
      lab_name        VARCHAR(100),
      notes           TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,

  lab_results_indexes: `
    CREATE INDEX IF NOT EXISTS idx_lab_results_date ON lab_results (test_date DESC);
    CREATE INDEX IF NOT EXISTS idx_lab_results_test ON lab_results (test_name, test_date DESC);
    CREATE INDEX IF NOT EXISTS idx_lab_results_category ON lab_results (test_category, test_date DESC)
  `,

  // Last.fm auto-tagging rules
  lastfm_tag_rules: `
    CREATE TABLE IF NOT EXISTS lastfm_tag_rules (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      rule_name         VARCHAR(100) NOT NULL,
      match_type        VARCHAR(20) NOT NULL,
      track_name        VARCHAR(255),
      artist_name       VARCHAR(255),
      match_mode        VARCHAR(20) DEFAULT 'exact',
      tag_name          VARCHAR(100) NOT NULL,
      merge_gap_seconds INTEGER,
      artist_names      JSONB,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT unique_rule UNIQUE (match_type, track_name, artist_name, tag_name)
    )
  `,

  lastfm_tag_rules_indexes: `
    CREATE INDEX IF NOT EXISTS idx_lastfm_tag_rules_match ON lastfm_tag_rules (match_type, match_mode)
  `,

  // GPS location data with PostGIS support
  locations: `
    CREATE TABLE IF NOT EXISTS locations (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source          VARCHAR(50) NOT NULL DEFAULT 'owntracks',
      time            TIMESTAMPTZ NOT NULL,
      location        GEOGRAPHY(POINT, 4326) NOT NULL,
      accuracy        DOUBLE PRECISION,
      altitude        DOUBLE PRECISION,
      velocity        DOUBLE PRECISION,
      regions         VARCHAR[] DEFAULT '{}',
      CONSTRAINT unique_location UNIQUE (source, time)
    )
  `,
  locations_indexes: `
    CREATE INDEX IF NOT EXISTS idx_locations_time ON locations (time DESC);
    CREATE INDEX IF NOT EXISTS idx_locations_geo ON locations USING GIST (location)
  `,

  // MCP session persistence for surviving backend restarts
  mcp_sessions: `
    CREATE TABLE IF NOT EXISTS mcp_sessions (
      session_id      UUID PRIMARY KEY,
      username        VARCHAR(255) NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_activity   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,

  mcp_sessions_indexes: `
    CREATE INDEX IF NOT EXISTS idx_mcp_sessions_username ON mcp_sessions (username);
    CREATE INDEX IF NOT EXISTS idx_mcp_sessions_last_activity ON mcp_sessions (last_activity)
  `,

  // User-defined named locations (detected and named via Aurboda)
  named_locations: `
    CREATE TABLE IF NOT EXISTS named_locations (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name            VARCHAR(255) NOT NULL,
      location        GEOGRAPHY(POINT, 4326) NOT NULL,
      radius          INTEGER NOT NULL DEFAULT 200,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  named_locations_indexes: `
    CREATE INDEX IF NOT EXISTS idx_named_locations_geo ON named_locations USING GIST (location)
  `,

  // Notes/comments on any entity (polymorphic reference)
  notes: `
    CREATE TABLE IF NOT EXISTS notes (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type     VARCHAR(50) NOT NULL,
      entity_id       TEXT NOT NULL,
      content         TEXT NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,

  notes_indexes: `
    CREATE INDEX IF NOT EXISTS idx_notes_entity ON notes (entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_notes_created ON notes (created_at DESC)
  `,

  // OAuth tokens for third-party APIs
  oauth_tokens: `
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      provider        VARCHAR(50) NOT NULL,
      access_token    TEXT NOT NULL,
      refresh_token   TEXT,
      expires_at      TIMESTAMPTZ,
      scopes          VARCHAR[],
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT unique_provider UNIQUE (provider)
    )
  `,

  // Outbound sync queue - tracks changes to push to Health Connect

  outbound_sync_queue: `
    CREATE TABLE IF NOT EXISTS outbound_sync_queue (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type     VARCHAR(50) NOT NULL,
      entity_id       VARCHAR(255) NOT NULL,
      operation       VARCHAR(20) NOT NULL,
      hc_record_type  VARCHAR(100) NOT NULL,
      payload         JSONB NOT NULL,
      hc_record_id    VARCHAR(255),
      status          VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      synced_at       TIMESTAMPTZ
    )
  `,
  outbound_sync_queue_indexes: `
    CREATE INDEX IF NOT EXISTS idx_outbound_sync_queue_status ON outbound_sync_queue (status) WHERE status = 'pending';
    CREATE INDEX IF NOT EXISTS idx_outbound_sync_queue_entity ON outbound_sync_queue (entity_type, entity_id)
  `,

  // Named places / geofences

  places: `
    CREATE TABLE IF NOT EXISTS places (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source          VARCHAR(50) NOT NULL DEFAULT 'owntracks',
      external_id     VARCHAR(255),
      name            VARCHAR(255) NOT NULL,
      location        GEOGRAPHY(POINT, 4326) NOT NULL,
      radius          INTEGER NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT unique_place UNIQUE (source, external_id)
    )
  `,
  places_indexes: `
    CREATE INDEX IF NOT EXISTS idx_places_geo ON places USING GIST (location)
  `,

  // Productivity data (RescueTime, ActivityWatch, etc.)

  productivity: `
    CREATE TABLE IF NOT EXISTS productivity (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source          VARCHAR(50) NOT NULL DEFAULT 'rescuetime',
      start_time      TIMESTAMPTZ NOT NULL,
      end_time        TIMESTAMPTZ NOT NULL,
      activity        VARCHAR(255) NOT NULL,
      category        VARCHAR(100),
      productivity    SMALLINT,
      duration_sec    INTEGER NOT NULL,
      is_mobile       BOOLEAN DEFAULT FALSE,
      device_name     VARCHAR(100) NOT NULL DEFAULT '',
      deleted_at      TIMESTAMPTZ,
      CONSTRAINT unique_productivity UNIQUE (source, start_time, activity, device_name)
    )
  `,
  productivity_indexes: `
    CREATE INDEX IF NOT EXISTS idx_productivity_time ON productivity (start_time DESC);
    CREATE INDEX IF NOT EXISTS idx_productivity_category ON productivity (category, start_time DESC);
    CREATE INDEX IF NOT EXISTS idx_productivity_not_deleted ON productivity (start_time DESC) WHERE deleted_at IS NULL
  `,
  // Raw data sink - stores all incoming data in original form

  raw_records: `
    CREATE TABLE IF NOT EXISTS raw_records (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source          VARCHAR(50) NOT NULL,
      record_type     VARCHAR(100) NOT NULL,
      external_id     VARCHAR(255),
      recorded_at     TIMESTAMPTZ NOT NULL,
      received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      data            JSONB NOT NULL,
      CONSTRAINT unique_source_record UNIQUE (source, record_type, external_id)
    )
  `,
  raw_records_indexes: `
    CREATE INDEX IF NOT EXISTS idx_raw_records_source_time ON raw_records (source, recorded_at);
    CREATE INDEX IF NOT EXISTS idx_raw_records_type_time ON raw_records (record_type, recorded_at);
    CREATE INDEX IF NOT EXISTS idx_raw_records_data ON raw_records USING GIN (data)
  `,

  // Sync state tracking for incremental data pulls
  sync_state: `
    CREATE TABLE IF NOT EXISTS sync_state (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      provider        VARCHAR(50) NOT NULL,
      data_type       VARCHAR(100) NOT NULL,
      last_sync_time  TIMESTAMPTZ,
      sync_start_date DATE,
      status          VARCHAR(20) DEFAULT 'idle',
      error_message   TEXT,
      retry_after     TIMESTAMPTZ,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT unique_sync_state UNIQUE (provider, data_type)
    )
  `,

  // Activity labels/tags
  tags: `
    CREATE TABLE IF NOT EXISTS tags (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source          VARCHAR(50) NOT NULL,
      external_id     VARCHAR(255),
      tag             VARCHAR(100) NOT NULL,
      tag_key         VARCHAR(255),
      start_time      TIMESTAMPTZ NOT NULL,
      end_time        TIMESTAMPTZ,
      deleted_at      TIMESTAMPTZ,
      CONSTRAINT unique_tag UNIQUE (source, external_id)
    )
  `,
  tags_indexes: `
    CREATE INDEX IF NOT EXISTS idx_tags_time ON tags (start_time DESC);
    CREATE INDEX IF NOT EXISTS idx_tags_tag_time ON tags (tag, start_time DESC);
    CREATE INDEX IF NOT EXISTS idx_tags_tag_key ON tags (tag_key) WHERE tag_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_tags_not_deleted ON tags (start_time DESC) WHERE deleted_at IS NULL
  `,

  // Normalized time-series metrics for fast charting queries
  time_series: `
    CREATE TABLE IF NOT EXISTS time_series (
      time            TIMESTAMPTZ NOT NULL,
      metric          VARCHAR(50) NOT NULL,
      value           DOUBLE PRECISION NOT NULL,
      unit            VARCHAR(20) NOT NULL,
      source          VARCHAR(50) NOT NULL,
      PRIMARY KEY (time, metric, source)
    )
  `,
  time_series_indexes: `
    CREATE INDEX IF NOT EXISTS idx_time_series_metric_time ON time_series (metric, time DESC)
  `,

  // User settings (HR zones, birth date, etc.)
  user_settings: `
    CREATE TABLE IF NOT EXISTS user_settings (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      settings        JSONB NOT NULL DEFAULT '{}',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
}

/**
 * Order in which tables should be created (respecting dependencies).
 */
export const tableCreationOrder = [
  'raw_records',
  'raw_records_indexes',
  'time_series',
  'time_series_indexes',
  'activities',
  'activities_indexes',
  'lastfm_tag_rules',
  'lastfm_tag_rules_indexes',
  'locations',
  'locations_indexes',
  'places',
  'places_indexes',
  'named_locations',
  'named_locations_indexes',
  'detected_locations',
  'detected_locations_indexes',
  'tags',
  'tags_indexes',
  'productivity',
  'productivity_indexes',
  'lab_results',
  'lab_results_indexes',
  'oauth_tokens',
  'sync_state',
  'user_settings',
  'notes',
  'notes_indexes',
  'mcp_sessions',
  'mcp_sessions_indexes',
  'outbound_sync_queue',
  'outbound_sync_queue_indexes',
]

/**
 * Mapping from Health Connect record types to our metric types.
 */
export const healthConnectMetricMapping: Record<string, MetricType | null> = {
  ActiveCaloriesBurnedRecord: 'calories_active',
  BasalBodyTemperatureRecord: 'basal_body_temperature',
  BasalMetabolicRateRecord: 'calories_basal',
  BloodGlucoseRecord: 'blood_glucose',
  BloodPressureRecord: null, // Handled specially (two metrics)
  BodyFatRecord: 'body_fat',
  BodyTemperatureRecord: 'body_temperature',
  BodyWaterMassRecord: 'body_water_mass',
  BoneMassRecord: 'bone_mass',
  DistanceRecord: 'distance',
  FloorsClimbedRecord: 'floors_climbed',
  HeartRateRecord: 'heart_rate',
  HeartRateVariabilityRmssdRecord: 'hrv_rmssd',
  HeightRecord: 'height',
  LeanBodyMassRecord: 'lean_body_mass',
  OxygenSaturationRecord: 'spo2',
  RespiratoryRateRecord: 'respiratory_rate',
  RestingHeartRateRecord: 'resting_heart_rate',
  StepsRecord: 'steps',
  TotalCaloriesBurnedRecord: 'calories_total',
  Vo2MaxRecord: 'vo2_max',
  WeightRecord: 'weight',
}

/**
 * Health Connect record types that map to activities.
 */
export const healthConnectActivityMapping: Record<string, ActivityType | null> = {
  ExerciseSessionRecord: 'exercise',
  SleepSessionRecord: 'sleep',
}

// ============================================================================
// Reverse mappings: Aurboda data -> Health Connect record types
// Used for outbound sync (writing Aurboda data to Health Connect)
// ============================================================================

/**
 * Mapping from Aurboda metric types to Health Connect record type names.
 * Only metrics that have a direct HC equivalent are included.
 */
export const metricToHealthConnectType: Partial<Record<MetricType, string>> = {
  body_fat: 'BodyFatRecord',
  body_water_mass: 'BodyWaterMassRecord',
  bone_mass: 'BoneMassRecord',
  heart_rate: 'HeartRateRecord',
  height: 'HeightRecord',
  hrv_rmssd: 'HeartRateVariabilityRmssdRecord',
  lean_body_mass: 'LeanBodyMassRecord',
  resting_heart_rate: 'RestingHeartRateRecord',
  steps: 'StepsRecord',
  weight: 'WeightRecord',
}

/**
 * Mapping from Aurboda activity types to Health Connect record type names.
 */
export const activityTypeToHealthConnectType: Partial<Record<ActivityType, string>> = {
  exercise: 'ExerciseSessionRecord',
  sleep: 'SleepSessionRecord',
}

/**
 * Check if a metric type can be synced to Health Connect.
 */
export const isHealthConnectSyncableMetric = (metric: string): boolean => metric in metricToHealthConnectType

/**
 * Check if an activity type can be synced to Health Connect.
 */
export const isHealthConnectSyncableActivity = (activityType: string): boolean =>
  activityType in activityTypeToHealthConnectType
