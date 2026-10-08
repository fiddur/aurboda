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
    deleted_at      TIMESTAMPTZ,           -- Soft delete
    updated_at      TIMESTAMPTZ DEFAULT NOW(),  -- When the value last changed (NULL for rows from before it was tracked)

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
    { "stage": "light", "start": "2024-01-15T23:00:00Z", "end": "2024-01-15T23:45:00Z" },
    { "stage": "deep", "start": "2024-01-15T23:45:00Z", "end": "2024-01-16T01:00:00Z" }
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
    deleted_at      TIMESTAMPTZ,           -- Soft delete (superseded by an activity's GPS track)

    CONSTRAINT unique_location UNIQUE (source, time)
);

CREATE INDEX idx_locations_time ON locations (time DESC);
CREATE INDEX idx_locations_geo ON locations USING GIST (location);
```

Reads must filter `deleted_at IS NULL`: when an activity carries its own GPS track, passive tracking for the activity's span is soft-deleted rather than removed. See [GPS Precedence](./data-sources.md#gps-precedence).

#### `activity_tracks` - One GPS Line per Activity (PostGIS)

The full-resolution track of an activity, one row per activity and source. `locations` keeps its points as before; this is an additional copy as a line, which route and segment matching run on. See [Routes and segments](./features/routes-and-segments.md).

```sql
CREATE TABLE activity_tracks (
    activity_id      UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    source           VARCHAR(50) NOT NULL,
    geom             GEOMETRY(LINESTRINGZM, 4326) NOT NULL,  -- Z = altitude m (0 when unknown), M = seconds since activities.start_time
    simplified       GEOMETRY(LINESTRING, 4326) NOT NULL,    -- ST_SimplifyPreserveTopology(ST_Force2D(geom), 0.00008), ~8 m
    length_m         DOUBLE PRECISION NOT NULL,              -- ST_Length(ST_Force2D(geom)::geography)
    point_count      INTEGER NOT NULL,
    full_resolution  BOOLEAN NOT NULL DEFAULT true,          -- false for a Strava polyline backfill
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (activity_id, source)
);

CREATE INDEX idx_activity_tracks_simplified ON activity_tracks USING GIST (simplified);
```

Garmin writes a track when an activity's detail is synced, Strava when its streams are processed. A track needs at least two distinct fixes; `0,0` fixes are dropped and equal timestamps collapse to the first. The derived columns are computed in SQL from `geom` on every upsert.

History is backfilled from `raw_records` without new API calls: Garmin from the stored activity detail (full resolution), Strava from the stored activity's `map.polyline` (a shape without timestamps, so M is spread evenly over `elapsed_time` and `full_resolution` is false). The backfill is incremental -- activities with a usable raw record and no track -- and runs per user in the `track-backfill` queue after each startup's schema sweep, or on demand through `POST /tracks/backfill` / the `backfill_activity_tracks` MCP tool.

#### `routes` and `activity_routes` - Recognised Courses (PostGIS)

A route is a course run more than once: its line is the simplified track of the older of the
first two runs that matched. See [Routes and segments](./features/routes-and-segments.md#phase-2-routes).

```sql
CREATE TABLE routes (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                   VARCHAR(255) NOT NULL,
    activity_type          VARCHAR(100) NOT NULL REFERENCES activity_type_definitions(name) ON UPDATE CASCADE,
    geom                   GEOMETRY(LINESTRING, 4326) NOT NULL,   -- the canonical track's `simplified`
    buffer                 GEOMETRY(GEOMETRY, 4326) NOT NULL,     -- ST_Buffer(geom::geography, 25)::geometry, stored at creation
    length_m               DOUBLE PRECISION NOT NULL,
    start_pt               GEOGRAPHY(POINT, 4326) NOT NULL,
    end_pt                 GEOGRAPHY(POINT, 4326) NOT NULL,
    canonical_activity_id  UUID REFERENCES activities(id) ON DELETE SET NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_routes_geom ON routes USING GIST (geom);

CREATE TABLE activity_routes (
    activity_id  UUID PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
    route_id     UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    coverage     REAL NOT NULL,          -- the lower of the two buffer coverages when matched
    matched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_activity_routes_route ON activity_routes (route_id);
```

An activity is on at most one route. The run count is derived, never stored: attached,
non-deleted activities, where rows of the same session from several sources (they overlap in
time) count once. Deleting a route keeps its activities; merging moves the `activity_routes`
rows and deletes the source route.

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

#### `notes` - Comments on Anything

Free-text comments with a polymorphic reference. One table carries all three
shapes, and `(entity_type, entity_id)` is what distinguishes them. See
[Comments](features/comments.md) for the feature-level description.

```sql
CREATE TABLE notes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type     VARCHAR(50) NOT NULL,  -- 'activity' | 'productivity' | 'metric' | 'report' | 'meal' | 'note' | 'time'
    entity_id       TEXT,                  -- NULL only for entity_type = 'time'
    content         TEXT NOT NULL,
    source          VARCHAR(50),           -- NULL for user-typed; set for synced comments ('health_connect', 'oura', …)
    start_time      TIMESTAMPTZ,
    end_time        TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT notes_shape_check CHECK (
        (entity_type = 'time' AND entity_id IS NULL AND start_time IS NOT NULL)
        OR (entity_type <> 'time' AND entity_id IS NOT NULL)
    )
);
```

**The three shapes:**

- **On an entity** -- `entity_type` names a real entity and `entity_id` points at
  it (a UUID, or for metrics the composite key `<iso_time>|<metric>|<source>`).
  `start_time`/`end_time` are a _cache_ of the parent's timing so comments can be
  queried by time range; they are rewritten whenever the parent moves and are not
  editable directly.
- **On a moment** -- `entity_type = 'time'`, `entity_id IS NULL`. `start_time` is
  required and `end_time` optional; both are user input and editable.
- **A reply** -- `entity_type = 'note'`, `entity_id` is the root comment's id. It
  inherits the root's times, so the whole thread sits at one point in time, while
  its own `created_at` records when it was written. Threads are exactly one level
  deep: replying to a reply re-anchors to that reply's root.

Replies are never top-level -- `getNotesForTimeRange` and the Health Connect
notes join both filter `entity_type <> 'note'`. Deleting a thread root deletes
its replies (done explicitly; there is no FK).

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

| Health Connect Type             | Target Table | Metric/Type        |
| ------------------------------- | ------------ | ------------------ |
| HeartRateRecord                 | time_series  | heart_rate         |
| RestingHeartRateRecord          | time_series  | resting_heart_rate |
| HeartRateVariabilityRmssdRecord | time_series  | hrv_rmssd          |
| WeightRecord                    | time_series  | weight             |
| BodyFatRecord                   | time_series  | body_fat           |
| StepsRecord                     | time_series  | steps              |
| ActiveCaloriesBurnedRecord      | time_series  | calories_active    |
| TotalCaloriesBurnedRecord       | time_series  | calories_total     |
| BloodGlucoseRecord              | time_series  | blood_glucose      |
| BloodPressureRecord             | time_series  | blood*pressure*\*  |
| SleepSessionRecord              | activities   | sleep              |
| ExerciseSessionRecord           | activities   | exercise           |

### Oura Ring

| Oura Endpoint    | Target Table | Details                    |
| ---------------- | ------------ | -------------------------- |
| daily_sleep      | activities   | Sleep sessions with stages |
| heart_rate       | time_series  | 5-minute HR averages       |
| daily_readiness  | time_series  | readiness_score            |
| daily_resilience | time_series  | resilience\_\* metrics     |
| session          | activities   | Meditation sessions        |
| enhanced_tag     | tags         | Activity tags              |

### RescueTime

| Data Type     | Target Table | Details                    |
| ------------- | ------------ | -------------------------- |
| Interval data | productivity | Per-activity time tracking |
| Daily summary | time_series  | productivity_score (daily) |

### OwnTracks

| Message Type | Target Table |
| ------------ | ------------ |
| location     | locations    |
| waypoint     | places       |

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

## When migrations run

Each user has their own database, so schema changes are applied per user. The
full `migrateSchema` sweep is roughly 130 statements including full-table
rewrites of `activities`, `tags`, `food_items` and `user_settings` — minutes on
a database with years of data — so it is gated by a schema fingerprint and runs
only when there is something to do (#1125).

- **At signup.** `makeNewUserDb` runs `initializeSchema`, which creates every
  table from `createTableStatements`.
- **Just after the server starts listening**, in the background: a
  `postListenCallbacks` task runs `migrateAllUsers`, which visits every
  `aurboda_*` database sequentially. This is where a deploy's migrations
  normally land, before any user asks for anything. One user's broken database
  is logged and skipped rather than stopping the sweep.
- **On a user's first authenticated request per server process.** The auth
  middleware awaits `migrateSchemaIfNeeded` once per user, so no request runs
  against stale schema. Gated by the fingerprint, so it is normally a single
  `SELECT` — and after a deploy the background sweep has usually already done
  the work.
- **On a schema error.** `query(user, …)` catches PostgreSQL schema errors
  (missing table or column, and NOT NULL violations from a column that has
  become nullable), runs a **forced** full sweep once per user via
  `_runMigrationOnce`, and retries the statement. This is the correctness
  safety net.
- **Never at login.** `/login` only authenticates. It used to sweep the schema
  on every login, which grew with the data until it exceeded the reverse
  proxy's timeout and every login failed as "Unauthorized" with nothing in the
  logs (#1123).

### The schema fingerprint

`schemaFingerprint()` (in `apps/backend/src/schema.ts`) is a SHA-256 over every
DDL statement in `tableCreationOrder`, in order, plus `MIGRATION_REVISION`. A
successful sweep appends a `schema@<fingerprint>` row to the user's
`schema_migrations` table; `migrateSchema` returns immediately when that row is
already present. The rows are append-only, so what is left behind reads as the
database's migration history.

A new user's database records the fingerprint at signup: `initializeSchema`
runs every create statement on an empty database, which is exactly the schema
the fingerprint describes, so the first sweep is skipped. On a database that
already held tables (the legacy importer, `migrate.ts`) it records nothing,
because `IF NOT EXISTS` leaves those tables as they were.

Two halves, because migrations have two kinds of content:

- **DDL is covered automatically.** Any change to a statement in
  `createTableStatements`, or to the order they run in, changes the hash. It
  cannot be forgotten.
- **`MIGRATION_REVISION` covers the rest** — the imperative backfills and data
  fixes inside `migrateSchema` that are not expressed as DDL. Bump it when you
  add or change one, or the sweep will be skipped on databases that already
  record the current fingerprint.

A sweep that throws records nothing, so it is retried. And the lazy path
deliberately ignores the fingerprint: a schema error proves something is
missing, which means the recorded fingerprint is wrong and must not be trusted.

## Migration Notes

This schema replaces the previous ad-hoc table creation. Key changes:

1. **Unified raw storage** - All sources go through `raw_records` first
2. **Normalized metrics** - Single `time_series` table instead of per-type tables
3. **Proper indexing** - Time-based and spatial indexes for query performance
4. **RescueTime persistence** - Previously fetched on-demand, now stored
5. **Oura persistence** - Previously only tokens stored, now full data cached
6. **Structured lab results** - New table for blood work tracking
