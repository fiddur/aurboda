/**
 * Database schema definitions for Aurboda.
 *
 * This module contains all table creation SQL and schema-related utilities.
 * See docs/data-storage.md for design decisions and data flow documentation.
 */

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
      CONSTRAINT unique_activity UNIQUE (source, activity_type, start_time)
    )
  `,

  activities_indexes: `
    CREATE INDEX IF NOT EXISTS idx_activities_type_time ON activities (activity_type, start_time DESC);
    CREATE INDEX IF NOT EXISTS idx_activities_time_range ON activities (start_time, end_time)
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

  // RescueTime productivity data

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
      CONSTRAINT unique_productivity UNIQUE (source, start_time, activity)
    )
  `,
  productivity_indexes: `
    CREATE INDEX IF NOT EXISTS idx_productivity_time ON productivity (start_time DESC);
    CREATE INDEX IF NOT EXISTS idx_productivity_category ON productivity (category, start_time DESC)
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
      start_time      TIMESTAMPTZ NOT NULL,
      end_time        TIMESTAMPTZ,
      CONSTRAINT unique_tag UNIQUE (source, external_id)
    )
  `,

  tags_indexes: `
    CREATE INDEX IF NOT EXISTS idx_tags_time ON tags (start_time DESC);
    CREATE INDEX IF NOT EXISTS idx_tags_tag_time ON tags (tag, start_time DESC)
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
  'locations',
  'locations_indexes',
  'places',
  'places_indexes',
  'tags',
  'tags_indexes',
  'productivity',
  'productivity_indexes',
  'lab_results',
  'lab_results_indexes',
  'oauth_tokens',
  'sync_state',
]

/**
 * Supported data sources.
 */
export type DataSource =
  | 'health_connect'
  | 'health_connect_aggregate'
  | 'oura'
  | 'garmin'
  | 'rescuetime'
  | 'owntracks'
  | 'manual'

/**
 * Metric types for time_series table.
 */
export type MetricType =
  | 'heart_rate'
  | 'resting_heart_rate'
  | 'hrv_rmssd'
  | 'weight'
  | 'body_fat'
  | 'bone_mass'
  | 'lean_body_mass'
  | 'body_water_mass'
  | 'height'
  | 'steps'
  | 'distance'
  | 'floors_climbed'
  | 'calories_active'
  | 'calories_total'
  | 'calories_basal'
  | 'spo2'
  | 'respiratory_rate'
  | 'body_temperature'
  | 'basal_body_temperature'
  | 'blood_glucose'
  | 'blood_pressure_systolic'
  | 'blood_pressure_diastolic'
  | 'vo2_max'
  | 'readiness_score'
  | 'resilience_score'
  | 'productivity_score'
  | 'cardiovascular_age'
  | 'sleep_score'
  // Oura sleep contributors (0-100 scores)
  | 'sleep_efficiency'
  | 'sleep_latency'
  | 'sleep_restfulness'
  | 'sleep_timing'
  | 'sleep_deep_score'
  | 'sleep_rem_score'
  | 'sleep_total_score'

/**
 * Activity types for activities table.
 */
export type ActivityType = 'sleep' | 'exercise' | 'meditation' | 'nap'

/**
 * Unit definitions for metrics.
 */
/**
 * List of all valid metric types.
 */
export const validMetrics: MetricType[] = [
  'heart_rate',
  'resting_heart_rate',
  'hrv_rmssd',
  'weight',
  'body_fat',
  'bone_mass',
  'lean_body_mass',
  'body_water_mass',
  'height',
  'steps',
  'distance',
  'floors_climbed',
  'calories_active',
  'calories_total',
  'calories_basal',
  'spo2',
  'respiratory_rate',
  'body_temperature',
  'basal_body_temperature',
  'blood_glucose',
  'blood_pressure_systolic',
  'blood_pressure_diastolic',
  'vo2_max',
  'readiness_score',
  'resilience_score',
  'productivity_score',
  'cardiovascular_age',
  'sleep_score',
  // Oura sleep contributors
  'sleep_efficiency',
  'sleep_latency',
  'sleep_restfulness',
  'sleep_timing',
  'sleep_deep_score',
  'sleep_rem_score',
  'sleep_total_score',
]

/**
 * Check if a string is a valid metric type.
 */
export function isValidMetric(metric: string): metric is MetricType {
  return validMetrics.includes(metric as MetricType)
}

/**
 * Unit definitions for metrics.
 */
export const metricUnits: Record<MetricType, string> = {
  basal_body_temperature: 'celsius',
  blood_glucose: 'mmol/L',
  blood_pressure_diastolic: 'mmHg',
  blood_pressure_systolic: 'mmHg',
  body_fat: 'percent',
  body_temperature: 'celsius',
  body_water_mass: 'kg',
  bone_mass: 'kg',
  calories_active: 'kcal',
  calories_basal: 'kcal',
  calories_total: 'kcal',
  cardiovascular_age: 'years',
  distance: 'm',
  floors_climbed: 'count',
  heart_rate: 'bpm',
  height: 'm',
  hrv_rmssd: 'ms',
  lean_body_mass: 'kg',
  productivity_score: 'score',
  readiness_score: 'score',
  resilience_score: 'score',
  respiratory_rate: 'brpm',
  resting_heart_rate: 'bpm',
  sleep_deep_score: 'score',
  sleep_efficiency: 'score',
  sleep_latency: 'score',
  sleep_rem_score: 'score',
  sleep_restfulness: 'score',
  sleep_score: 'score',
  sleep_timing: 'score',
  sleep_total_score: 'score',
  spo2: 'percent',
  steps: 'count',
  vo2_max: 'mL/kg/min',
  weight: 'kg',
}

/**
 * Cumulative metrics that are summed over a day and can have duplicate sources.
 * These should prefer aggregate values from Health Connect's aggregate() API.
 */
export const cumulativeMetrics: MetricType[] = [
  'steps',
  'distance',
  'floors_climbed',
  'calories_active',
  'calories_total',
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
