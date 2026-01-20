# Data Storage Architecture

## Overview

Aurboda uses PostgreSQL with a **per-user database** architecture for strong data isolation. Each user gets their own database (`aurboda_{username}`) containing all their health and activity data.

This document describes the hybrid schema design that balances flexibility for diverse data sources with query performance for time-series analytics.

## Design Principles

1. **Raw data preservation** - All incoming data is stored in original form for audit and reprocessing
2. **Normalized metrics** - Common measurements are denormalized into a unified time-series table for fast queries
3. **Structured where beneficial** - Data with known schemas (lab results, activities) get dedicated tables
4. **Spatial support** - Location data uses PostGIS for efficient geospatial queries
5. **Source tracking** - All data tracks its origin for filtering and debugging

## Schema

### Core Tables

#### `raw_records` - Universal Data Sink

Stores all incoming data in original form. This is the source of truth.

```sql
CREATE TABLE raw_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source          VARCHAR(50) NOT NULL,  -- 'health_connect', 'oura', 'garmin', 'rescuetime', etc.
    record_type     VARCHAR(100) NOT NULL, -- 'HeartRateRecord', 'SleepSessionRecord', etc.
    external_id     VARCHAR(255),          -- Original ID from source (for deduplication)
    recorded_at     TIMESTAMPTZ NOT NULL,  -- When the measurement was taken
    received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- When we received it
    data            JSONB NOT NULL,        -- Full original payload

    CONSTRAINT unique_source_record UNIQUE (source, record_type, external_id)
);

CREATE INDEX idx_raw_records_source_time ON raw_records (source, recorded_at);
CREATE INDEX idx_raw_records_type_time ON raw_records (record_type, recorded_at);
CREATE INDEX idx_raw_records_data ON raw_records USING GIN (data);
```

**Use cases:**
- Audit trail of all received data
- Reprocessing if normalization logic changes
- Debugging data issues
- Storing data types we don't yet have specialized handling for

#### `time_series` - Normalized Metrics

Single-value measurements over time, optimized for charting and aggregation.

```sql
CREATE TABLE time_series (
    time            TIMESTAMPTZ NOT NULL,
    metric          VARCHAR(50) NOT NULL,  -- 'heart_rate', 'weight', 'steps', 'hrv', etc.
    value           DOUBLE PRECISION NOT NULL,
    unit            VARCHAR(20) NOT NULL,  -- 'bpm', 'kg', 'count', 'ms', etc.
    source          VARCHAR(50) NOT NULL,  -- Origin system

    PRIMARY KEY (time, metric, source)
);

CREATE INDEX idx_time_series_metric_time ON time_series (metric, time DESC);
```

**Supported metrics:**
| Metric | Unit | Sources |
|--------|------|---------|
| `heart_rate` | bpm | health_connect, oura, garmin |
| `resting_heart_rate` | bpm | oura, garmin |
| `hrv_rmssd` | ms | health_connect, oura |
| `weight` | kg | health_connect, manual |
| `body_fat` | percent | health_connect |
| `steps` | count | health_connect, garmin |
| `calories_active` | kcal | health_connect, garmin |
| `calories_total` | kcal | health_connect, garmin |
| `spo2` | percent | health_connect, oura |
| `respiratory_rate` | brpm | oura |
| `body_temperature` | celsius | health_connect |
| `blood_glucose` | mmol/L | health_connect |
| `blood_pressure_systolic` | mmHg | health_connect |
| `blood_pressure_diastolic` | mmHg | health_connect |

#### `activities` - Time-Ranged Events

Events with duration: sleep sessions, workouts, meditation, etc.

```sql
CREATE TABLE activities (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source          VARCHAR(50) NOT NULL,
    activity_type   VARCHAR(50) NOT NULL,  -- 'sleep', 'exercise', 'meditation', etc.
    start_time      TIMESTAMPTZ NOT NULL,
    end_time        TIMESTAMPTZ,           -- NULL for ongoing activities
    title           VARCHAR(255),
    notes           TEXT,
    data            JSONB,                 -- Type-specific details (sleep stages, exercise route, etc.)

    CONSTRAINT unique_activity UNIQUE (source, activity_type, start_time)
);

CREATE INDEX idx_activities_type_time ON activities (activity_type, start_time DESC);
CREATE INDEX idx_activities_time_range ON activities (start_time, end_time);
```

**Activity types:**
- `sleep` - Sleep sessions with stages (awake, light, deep, rem)
- `exercise` - Workouts with exercise type, distance, calories
- `meditation` - Meditation/mindfulness sessions
- `nap` - Daytime sleep

**Example data JSONB for sleep:**
```json
{
  "stages": [
    {"stage": "light", "start": "2024-01-15T23:00:00Z", "end": "2024-01-15T23:45:00Z"},
    {"stage": "deep", "start": "2024-01-15T23:45:00Z", "end": "2024-01-16T01:00:00Z"}
  ],
  "efficiency": 0.92,
  "latency_minutes": 12
}
```

#### `locations` - GPS Data (PostGIS)

Location tracking with geospatial support.

```sql
CREATE TABLE locations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source          VARCHAR(50) NOT NULL DEFAULT 'owntracks',
    time            TIMESTAMPTZ NOT NULL,
    location        GEOGRAPHY(POINT, 4326) NOT NULL,
    accuracy        DOUBLE PRECISION,      -- Horizontal accuracy in meters
    altitude        DOUBLE PRECISION,      -- Meters above sea level
    velocity        DOUBLE PRECISION,      -- Speed in m/s
    regions         VARCHAR[] DEFAULT '{}', -- Named regions device is in

    CONSTRAINT unique_location UNIQUE (source, time)
);

CREATE INDEX idx_locations_time ON locations (time DESC);
CREATE INDEX idx_locations_geo ON locations USING GIST (location);
```

#### `places` - Named Locations/Geofences

```sql
CREATE TABLE places (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source          VARCHAR(50) NOT NULL DEFAULT 'owntracks',
    external_id     VARCHAR(255),
    name            VARCHAR(255) NOT NULL,
    location        GEOGRAPHY(POINT, 4326) NOT NULL,
    radius          INTEGER NOT NULL,      -- Geofence radius in meters
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT unique_place UNIQUE (source, external_id)
);

CREATE INDEX idx_places_geo ON places USING GIST (location);
```

#### `tags` - Activity Labels

User-defined or auto-detected activity labels.

```sql
CREATE TABLE tags (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source          VARCHAR(50) NOT NULL,
    external_id     VARCHAR(255),
    tag             VARCHAR(100) NOT NULL,
    start_time      TIMESTAMPTZ NOT NULL,
    end_time        TIMESTAMPTZ,           -- NULL for instant tags

    CONSTRAINT unique_tag UNIQUE (source, external_id)
);

CREATE INDEX idx_tags_time ON tags (start_time DESC);
CREATE INDEX idx_tags_tag_time ON tags (tag, start_time DESC);
```

#### `productivity` - RescueTime Activity Data

Screen time and productivity tracking.

```sql
CREATE TABLE productivity (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source          VARCHAR(50) NOT NULL DEFAULT 'rescuetime',
    start_time      TIMESTAMPTZ NOT NULL,
    end_time        TIMESTAMPTZ NOT NULL,
    activity        VARCHAR(255) NOT NULL, -- App or website name
    category        VARCHAR(100),          -- Activity category
    productivity    SMALLINT,              -- -2 to 2 productivity score
    duration_sec    INTEGER NOT NULL,
    is_mobile       BOOLEAN DEFAULT FALSE,

    CONSTRAINT unique_productivity UNIQUE (source, start_time, activity)
);

CREATE INDEX idx_productivity_time ON productivity (start_time DESC);
CREATE INDEX idx_productivity_category ON productivity (category, start_time DESC);
```

#### `lab_results` - Blood Work and Medical Tests

Structured storage for lab test results with reference ranges.

```sql
CREATE TABLE lab_results (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_date       DATE NOT NULL,
    test_name       VARCHAR(100) NOT NULL,
    test_category   VARCHAR(50),           -- 'lipids', 'metabolic', 'thyroid', 'vitamins', etc.
    value           DOUBLE PRECISION NOT NULL,
    unit            VARCHAR(30) NOT NULL,
    reference_low   DOUBLE PRECISION,
    reference_high  DOUBLE PRECISION,
    flag            VARCHAR(10),           -- 'normal', 'high', 'low', 'critical'
    lab_name        VARCHAR(100),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lab_results_date ON lab_results (test_date DESC);
CREATE INDEX idx_lab_results_test ON lab_results (test_name, test_date DESC);
CREATE INDEX idx_lab_results_category ON lab_results (test_category, test_date DESC);
```

**Common test categories:**
- `lipids` - Cholesterol, triglycerides, HDL, LDL
- `metabolic` - Glucose, HbA1c, insulin
- `thyroid` - TSH, T3, T4
- `vitamins` - Vitamin D, B12, folate
- `minerals` - Iron, ferritin, magnesium
- `liver` - ALT, AST, bilirubin
- `kidney` - Creatinine, BUN, eGFR
- `inflammation` - CRP, ESR
- `hormones` - Testosterone, cortisol, estrogen

#### `oauth_tokens` - API Credentials

Secure storage for third-party API tokens.

```sql
CREATE TABLE oauth_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider        VARCHAR(50) NOT NULL,  -- 'oura', 'garmin', etc.
    access_token    TEXT NOT NULL,
    refresh_token   TEXT,
    expires_at      TIMESTAMPTZ,
    scopes          VARCHAR[],
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT unique_provider UNIQUE (provider)
);
```

## Data Flow

### Ingestion

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Health Connect │     │   Oura API      │     │  RescueTime API │
│  (Android sync) │     │  (OAuth)        │     │  (API key)      │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                        POST /api/v2/sync                        │
└────────┬────────────────────────┬───────────────────────┬───────┘
         │                        │                       │
         ▼                        ▼                       ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  raw_records    │     │  raw_records    │     │  raw_records    │
│  (preserved)    │     │  (preserved)    │     │  (preserved)    │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                        │                       │
         ▼                        ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Normalization Layer                          │
│  - Extract metrics → time_series                                │
│  - Extract activities → activities                              │
│  - Extract productivity → productivity                          │
└─────────────────────────────────────────────────────────────────┘
```

### Querying

For charting heart rate over a week:
```sql
SELECT
    date_trunc('hour', time) AS hour,
    avg(value) AS avg_hr,
    min(value) AS min_hr,
    max(value) AS max_hr
FROM time_series
WHERE metric = 'heart_rate'
  AND time > NOW() - INTERVAL '7 days'
GROUP BY 1
ORDER BY 1;
```

For sleep analysis:
```sql
SELECT
    date(start_time) AS night,
    extract(epoch FROM (end_time - start_time)) / 3600 AS hours,
    data->'efficiency' AS efficiency,
    data->'stages' AS stages
FROM activities
WHERE activity_type = 'sleep'
  AND start_time > NOW() - INTERVAL '30 days'
ORDER BY start_time DESC;
```

For AI summary export:
```sql
SELECT json_build_object(
    'period', '2024-01',
    'metrics', (
        SELECT json_object_agg(metric, stats) FROM (
            SELECT metric, json_build_object(
                'avg', avg(value),
                'min', min(value),
                'max', max(value),
                'count', count(*)
            ) AS stats
            FROM time_series
            WHERE time BETWEEN '2024-01-01' AND '2024-02-01'
            GROUP BY metric
        ) t
    ),
    'sleep', (
        SELECT json_build_object(
            'avg_hours', avg(extract(epoch FROM (end_time - start_time)) / 3600),
            'sessions', count(*)
        )
        FROM activities
        WHERE activity_type = 'sleep'
          AND start_time BETWEEN '2024-01-01' AND '2024-02-01'
    )
);
```

## Source-Specific Handling

### Health Connect (Android)

Record types mapped to normalized tables:

| Health Connect Type | Target Table | Metric/Type |
|---------------------|--------------|-------------|
| HeartRateRecord | time_series | heart_rate |
| RestingHeartRateRecord | time_series | resting_heart_rate |
| HeartRateVariabilityRmssdRecord | time_series | hrv_rmssd |
| WeightRecord | time_series | weight |
| BodyFatRecord | time_series | body_fat |
| StepsRecord | time_series | steps |
| ActiveCaloriesBurnedRecord | time_series | calories_active |
| TotalCaloriesBurnedRecord | time_series | calories_total |
| BloodGlucoseRecord | time_series | blood_glucose |
| BloodPressureRecord | time_series | blood_pressure_* |
| SleepSessionRecord | activities | sleep |
| ExerciseSessionRecord | activities | exercise |

### Oura Ring

| Oura Endpoint | Target Table | Details |
|---------------|--------------|---------|
| daily_sleep | activities | Sleep sessions with stages |
| heart_rate | time_series | 5-minute HR averages |
| daily_readiness | time_series | readiness_score |
| daily_resilience | time_series | resilience_* metrics |
| session | activities | Meditation sessions |
| enhanced_tag | tags | Activity tags |

### RescueTime

| Data Type | Target Table | Details |
|-----------|--------------|---------|
| Interval data | productivity | Per-activity time tracking |
| Daily summary | time_series | productivity_score (daily) |

### OwnTracks

| Message Type | Target Table |
|--------------|--------------|
| location | locations |
| waypoint | places |

## Future Extensions

### Garmin Connect

When adding Garmin support, map to existing tables:
- Daily summaries → time_series
- Activities → activities
- Sleep → activities (type: sleep)
- Heart rate → time_series

### Blood Tests

Use `lab_results` table with appropriate `test_category` values.

### Manual Entry

Support manual data entry with `source = 'manual'` for:
- Weight measurements
- Blood pressure readings
- Lab results
- Activity logs

## Migration Notes

This schema replaces the previous ad-hoc table creation. Key changes:

1. **Unified raw storage** - All sources go through `raw_records` first
2. **Normalized metrics** - Single `time_series` table instead of per-type tables
3. **Proper indexing** - Time-based and spatial indexes for query performance
4. **RescueTime persistence** - Previously fetched on-demand, now stored
5. **Oura persistence** - Previously only tokens stored, now full data cached
6. **Structured lab results** - New table for blood work tracking
