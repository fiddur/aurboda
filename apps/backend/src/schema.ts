/**
 * Database schema definitions for Aurboda.
 *
 * This module contains all table creation SQL and schema-related utilities.
 * See docs/data-storage.md for design decisions and data flow documentation.
 */

// Re-export common types from shared api-spec package
export {
  aurbodaOnlyMetrics,
  aurbodaOnlySources,
  contextualHrvMetrics,
  cumulativeMetrics,
  cumulativeSources,
  getMetricAggregation,
  getMetricUnit,
  hrZoneMetrics,
  isContextualHrvMetric,
  isHrZoneMetric,
  isValidMetric,
  isValidMetricOrCustom,
  metricUnits,
  sumMetrics,
  validMetrics,
  type ActivityType,
  type CustomMetricDefinition,
  type DataSource,
  type MetricAggregation,
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

  // Lab results / blood work (legacy flat table — superseded by reports + report_entries)
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

  // Meal/nutrition data
  meals: `
    CREATE TABLE IF NOT EXISTS meals (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source          VARCHAR(50) NOT NULL DEFAULT 'manual',
      meal_type       VARCHAR(50),
      name            VARCHAR(255),
      time            TIMESTAMPTZ NOT NULL,
      calories        DOUBLE PRECISION,
      protein         DOUBLE PRECISION,
      carbs           DOUBLE PRECISION,
      fat             DOUBLE PRECISION,
      fiber           DOUBLE PRECISION,
      food_items      JSONB,
      micros          JSONB,
      notes           TEXT,
      sensitivities   TEXT[],
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,

  // Meal log completion flag per day
  meal_log_completed: `
    CREATE TABLE IF NOT EXISTS meal_log_completed (
      date            DATE PRIMARY KEY,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,

  // Canonical food item library (normalized from JSONB)
  food_items: `
    CREATE TABLE IF NOT EXISTS food_items (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name            VARCHAR(255) NOT NULL,
      name_lower      VARCHAR(255) NOT NULL,
      source          VARCHAR(50) NOT NULL DEFAULT 'manual',
      default_quantity DOUBLE PRECISION,
      default_unit    VARCHAR(100),
      calories        DOUBLE PRECISION,
      protein         DOUBLE PRECISION,
      carbs           DOUBLE PRECISION,
      fat             DOUBLE PRECISION,
      fiber           DOUBLE PRECISION,
      alcohol         DOUBLE PRECISION,
      caffeine        DOUBLE PRECISION,
      water           DOUBLE PRECISION,
      net_carbs       DOUBLE PRECISION,
      starch          DOUBLE PRECISION,
      sugars          DOUBLE PRECISION,
      added_sugars    DOUBLE PRECISION,
      cholesterol     DOUBLE PRECISION,
      saturated_fat   DOUBLE PRECISION,
      monounsaturated_fat DOUBLE PRECISION,
      polyunsaturated_fat DOUBLE PRECISION,
      trans_fat       DOUBLE PRECISION,
      omega_3         DOUBLE PRECISION,
      omega_6         DOUBLE PRECISION,
      ala             DOUBLE PRECISION,
      dha             DOUBLE PRECISION,
      epa             DOUBLE PRECISION,
      dpa             DOUBLE PRECISION,
      aa              DOUBLE PRECISION,
      la              DOUBLE PRECISION,
      vitamin_a       DOUBLE PRECISION,
      retinol         DOUBLE PRECISION,
      beta_carotene   DOUBLE PRECISION,
      vitamin_c       DOUBLE PRECISION,
      vitamin_d       DOUBLE PRECISION,
      vitamin_e       DOUBLE PRECISION,
      vitamin_k       DOUBLE PRECISION,
      b1_thiamine     DOUBLE PRECISION,
      b2_riboflavin   DOUBLE PRECISION,
      b3_niacin       DOUBLE PRECISION,
      b5_pantothenic_acid DOUBLE PRECISION,
      b6_pyridoxine   DOUBLE PRECISION,
      b12_cobalamin   DOUBLE PRECISION,
      folate          DOUBLE PRECISION,
      calcium         DOUBLE PRECISION,
      copper          DOUBLE PRECISION,
      iron            DOUBLE PRECISION,
      magnesium       DOUBLE PRECISION,
      manganese       DOUBLE PRECISION,
      phosphorus      DOUBLE PRECISION,
      potassium       DOUBLE PRECISION,
      selenium        DOUBLE PRECISION,
      sodium          DOUBLE PRECISION,
      zinc            DOUBLE PRECISION,
      iodine          DOUBLE PRECISION,
      cystine         DOUBLE PRECISION,
      histidine       DOUBLE PRECISION,
      isoleucine      DOUBLE PRECISION,
      leucine         DOUBLE PRECISION,
      lysine          DOUBLE PRECISION,
      methionine      DOUBLE PRECISION,
      phenylalanine   DOUBLE PRECISION,
      threonine       DOUBLE PRECISION,
      tryptophan      DOUBLE PRECISION,
      tyrosine        DOUBLE PRECISION,
      valine          DOUBLE PRECISION,
      oxalate         DOUBLE PRECISION,
      phytate         DOUBLE PRECISION,
      ash             DOUBLE PRECISION,
      salt            DOUBLE PRECISION,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT unique_food_item_name UNIQUE (name_lower)
    )
  `,

  food_items_indexes: `
    CREATE INDEX IF NOT EXISTS idx_food_items_name_lower ON food_items (name_lower)
  `,

  // Junction: meals <-> food items (snapshot of nutrients at insertion time)
  meal_food_items: `
    CREATE TABLE IF NOT EXISTS meal_food_items (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      meal_id         UUID NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
      food_item_id    UUID NOT NULL REFERENCES food_items(id),
      quantity        DOUBLE PRECISION,
      unit            VARCHAR(100),
      sort_order      INTEGER NOT NULL DEFAULT 0,
      calories        DOUBLE PRECISION,
      protein         DOUBLE PRECISION,
      carbs           DOUBLE PRECISION,
      fat             DOUBLE PRECISION,
      fiber           DOUBLE PRECISION,
      alcohol         DOUBLE PRECISION,
      caffeine        DOUBLE PRECISION,
      water           DOUBLE PRECISION,
      net_carbs       DOUBLE PRECISION,
      starch          DOUBLE PRECISION,
      sugars          DOUBLE PRECISION,
      added_sugars    DOUBLE PRECISION,
      cholesterol     DOUBLE PRECISION,
      saturated_fat   DOUBLE PRECISION,
      monounsaturated_fat DOUBLE PRECISION,
      polyunsaturated_fat DOUBLE PRECISION,
      trans_fat       DOUBLE PRECISION,
      omega_3         DOUBLE PRECISION,
      omega_6         DOUBLE PRECISION,
      ala             DOUBLE PRECISION,
      dha             DOUBLE PRECISION,
      epa             DOUBLE PRECISION,
      dpa             DOUBLE PRECISION,
      aa              DOUBLE PRECISION,
      la              DOUBLE PRECISION,
      vitamin_a       DOUBLE PRECISION,
      retinol         DOUBLE PRECISION,
      beta_carotene   DOUBLE PRECISION,
      vitamin_c       DOUBLE PRECISION,
      vitamin_d       DOUBLE PRECISION,
      vitamin_e       DOUBLE PRECISION,
      vitamin_k       DOUBLE PRECISION,
      b1_thiamine     DOUBLE PRECISION,
      b2_riboflavin   DOUBLE PRECISION,
      b3_niacin       DOUBLE PRECISION,
      b5_pantothenic_acid DOUBLE PRECISION,
      b6_pyridoxine   DOUBLE PRECISION,
      b12_cobalamin   DOUBLE PRECISION,
      folate          DOUBLE PRECISION,
      calcium         DOUBLE PRECISION,
      copper          DOUBLE PRECISION,
      iron            DOUBLE PRECISION,
      magnesium       DOUBLE PRECISION,
      manganese       DOUBLE PRECISION,
      phosphorus      DOUBLE PRECISION,
      potassium       DOUBLE PRECISION,
      selenium        DOUBLE PRECISION,
      sodium          DOUBLE PRECISION,
      zinc            DOUBLE PRECISION,
      iodine          DOUBLE PRECISION,
      cystine         DOUBLE PRECISION,
      histidine       DOUBLE PRECISION,
      isoleucine      DOUBLE PRECISION,
      leucine         DOUBLE PRECISION,
      lysine          DOUBLE PRECISION,
      methionine      DOUBLE PRECISION,
      phenylalanine   DOUBLE PRECISION,
      threonine       DOUBLE PRECISION,
      tryptophan      DOUBLE PRECISION,
      tyrosine        DOUBLE PRECISION,
      valine          DOUBLE PRECISION,
      oxalate         DOUBLE PRECISION,
      phytate         DOUBLE PRECISION,
      ash             DOUBLE PRECISION,
      salt            DOUBLE PRECISION
    )
  `,

  meal_food_items_indexes: `
    CREATE INDEX IF NOT EXISTS idx_meal_food_items_meal ON meal_food_items (meal_id);
    CREATE INDEX IF NOT EXISTS idx_meal_food_items_food ON meal_food_items (food_item_id)
  `,

  meals_indexes: `
    CREATE INDEX IF NOT EXISTS idx_meals_time ON meals (time DESC);
    CREATE INDEX IF NOT EXISTS idx_meals_type_time ON meals (meal_type, time DESC);
    CREATE INDEX IF NOT EXISTS idx_meals_source ON meals (source, time DESC)
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
      source          VARCHAR(50),
      start_time      TIMESTAMPTZ,
      end_time        TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,

  notes_indexes: `
    CREATE INDEX IF NOT EXISTS idx_notes_entity ON notes (entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_notes_created ON notes (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notes_time ON notes (start_time, end_time)
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
      fail_count      INT NOT NULL DEFAULT 0,
      fail_reason     TEXT,
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
      title           TEXT,
      category        VARCHAR(100),
      productivity    SMALLINT,
      duration_sec    INTEGER NOT NULL,
      is_mobile       BOOLEAN DEFAULT FALSE,
      device_name     VARCHAR(100) NOT NULL DEFAULT '',
      resolved_category TEXT[],
      deleted_at      TIMESTAMPTZ,
      CONSTRAINT unique_productivity UNIQUE (source, start_time, activity, device_name)
    )
  `,
  productivity_indexes: `
    CREATE INDEX IF NOT EXISTS idx_productivity_time ON productivity (start_time DESC);
    CREATE INDEX IF NOT EXISTS idx_productivity_category ON productivity (category, start_time DESC);
    CREATE INDEX IF NOT EXISTS idx_productivity_not_deleted ON productivity (start_time DESC) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_productivity_resolved_category ON productivity (resolved_category) WHERE resolved_category IS NOT NULL
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

  report_entries: `
    CREATE TABLE IF NOT EXISTS report_entries (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      report_id       UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      metric          VARCHAR(100) NOT NULL,
      value           DOUBLE PRECISION,
      unit            VARCHAR(30),
      method          VARCHAR(50),
      confidence      VARCHAR(20),
      reference_low   DOUBLE PRECISION,
      reference_high  DOUBLE PRECISION,
      flag            VARCHAR(20)
    )
  `,
  report_entries_indexes: `
    CREATE INDEX IF NOT EXISTS idx_report_entries_report ON report_entries (report_id);
    CREATE INDEX IF NOT EXISTS idx_report_entries_metric ON report_entries (metric)
  `,

  // Structured lab reports (InBody, blood panels, hair mineral analysis, etc.)
  reports: `
    CREATE TABLE IF NOT EXISTS reports (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      report_type     VARCHAR(100) NOT NULL,
      report_date     TIMESTAMPTZ NOT NULL,
      location        VARCHAR(255),
      notes           TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  reports_indexes: `
    CREATE INDEX IF NOT EXISTS idx_reports_date ON reports (report_date DESC);
    CREATE INDEX IF NOT EXISTS idx_reports_type ON reports (report_type, report_date DESC)
  `,
  // User-defined custom metric types (extracted from user_settings JSONB)
  custom_metrics: `
    CREATE TABLE IF NOT EXISTS custom_metrics (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name            VARCHAR(100) NOT NULL UNIQUE,
      unit            VARCHAR(30) NOT NULL,
      description     TEXT,
      min_value       DOUBLE PRECISION,
      max_value       DOUBLE PRECISION,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  custom_metrics_indexes: `
    CREATE INDEX IF NOT EXISTS idx_custom_metrics_name ON custom_metrics (name)
  `,

  // User-defined goals for tracking metrics (extracted from user_settings JSONB)
  goals: `
    CREATE TABLE IF NOT EXISTS goals (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      metric          VARCHAR(50) NOT NULL,
      min_value       DOUBLE PRECISION,
      max_value       DOUBLE PRECISION,
      time_window     VARCHAR(10) NOT NULL DEFAULT '7d',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  goals_indexes: `
    CREATE INDEX IF NOT EXISTS idx_goals_metric ON goals (metric)
  `,

  // Screentime category rules for categorizing productivity records

  screentime_categories: `
    CREATE TABLE IF NOT EXISTS screentime_categories (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name            TEXT[] NOT NULL,
      rule_type       VARCHAR(20) NOT NULL DEFAULT 'none',
      rule_regex      TEXT,
      ignore_case     BOOLEAN DEFAULT TRUE,
      color           VARCHAR(20),
      score           SMALLINT,
      exclude_from_screentime BOOLEAN DEFAULT FALSE,
      sort_order      INTEGER DEFAULT 0,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  screentime_categories_indexes: `
    CREATE INDEX IF NOT EXISTS idx_screentime_categories_name ON screentime_categories USING GIN (name)
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

  // Tag definitions — canonical tag identities with aliases for matching
  tag_definitions: `
    CREATE TABLE IF NOT EXISTS tag_definitions (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name            VARCHAR(100) NOT NULL,
      icon            TEXT,
      aliases         TEXT[] NOT NULL DEFAULT '{}',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  tag_definitions_indexes: `
    CREATE INDEX IF NOT EXISTS idx_tag_definitions_aliases ON tag_definitions USING GIN (aliases);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tag_definitions_name ON tag_definitions (lower(name))
  `,

  // Activity labels/tags
  tags: `
    CREATE TABLE IF NOT EXISTS tags (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source          VARCHAR(50) NOT NULL,
      external_id     VARCHAR(255),
      tag             VARCHAR(100) NOT NULL,
      tag_key         VARCHAR(255),
      tag_definition_id UUID REFERENCES tag_definitions(id),
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
    CREATE INDEX IF NOT EXISTS idx_tags_not_deleted ON tags (start_time DESC) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_tags_definition_id ON tags (tag_definition_id) WHERE tag_definition_id IS NOT NULL
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
    CREATE INDEX IF NOT EXISTS idx_time_series_metric_time ON time_series (metric, time DESC);
    CREATE INDEX IF NOT EXISTS idx_time_series_metric_source_time ON time_series (metric, source, time DESC)
  `,

  // Uploaded icon images (stored as binary blobs)
  uploaded_icons: `
    CREATE TABLE IF NOT EXISTS uploaded_icons (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      content_type    VARCHAR(50) NOT NULL,
      data            BYTEA NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
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

  // Audit log for user-specific events (sync, auth, settings changes, etc.)
  audit_log: `
    CREATE TABLE IF NOT EXISTS audit_log (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      level           VARCHAR(10) NOT NULL DEFAULT 'info',
      category        VARCHAR(20) NOT NULL,
      message         TEXT NOT NULL,
      details         JSONB
    )
  `,

  audit_log_indexes: `
    CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log (timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_log_category ON audit_log (category);
    CREATE INDEX IF NOT EXISTS idx_audit_log_level ON audit_log (level)
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
  'meals',
  'meals_indexes',
  'meal_log_completed',
  'food_items',
  'food_items_indexes',
  'meal_food_items',
  'meal_food_items_indexes',
  'locations',
  'locations_indexes',
  'places',
  'places_indexes',
  'named_locations',
  'named_locations_indexes',
  'detected_locations',
  'detected_locations_indexes',
  'tag_definitions',
  'tag_definitions_indexes',
  'tags',
  'tags_indexes',
  'productivity',
  'productivity_indexes',
  'screentime_categories',
  'screentime_categories_indexes',
  'lab_results',
  'lab_results_indexes',
  'reports',
  'reports_indexes',
  'report_entries',
  'report_entries_indexes',
  'oauth_tokens',
  'sync_state',
  'uploaded_icons',
  'custom_metrics',
  'custom_metrics_indexes',
  'goals',
  'goals_indexes',
  'user_settings',
  'audit_log',
  'audit_log_indexes',
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
  SpeedRecord: 'speed',
  PowerRecord: 'power',
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
  calories_active: 'ActiveCaloriesBurnedRecord',
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
  nap: 'SleepSessionRecord',
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
