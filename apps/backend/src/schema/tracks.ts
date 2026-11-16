export const tracksTables: Record<string, string> = {
  // One GPS line per activity and source. Z = altitude in metres (0 when
  // unknown), M = seconds since activities.start_time. `simplified` (~8 m
  // tolerance) is what route and segment matching run on.
  activity_tracks: `
    CREATE TABLE IF NOT EXISTS activity_tracks (
      activity_id      UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      source           VARCHAR(50) NOT NULL,
      geom             GEOMETRY(LINESTRINGZM, 4326) NOT NULL,
      simplified       GEOMETRY(LINESTRING, 4326) NOT NULL,
      length_m         DOUBLE PRECISION NOT NULL,
      point_count      INTEGER NOT NULL,
      full_resolution  BOOLEAN NOT NULL DEFAULT true,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (activity_id, source)
    )
  `,
  activity_tracks_indexes: `
    CREATE INDEX IF NOT EXISTS idx_activity_tracks_simplified ON activity_tracks USING GIST (simplified)
  `,
  // When route matching last ran on the activity's tracks; NULL means not yet
  // tried, so the startup backfill skips tracks already tried. Cleared when a
  // track is rewritten or the activity is retyped. Additive (idempotent).
  activity_tracks_route_matched_at: `
    ALTER TABLE activity_tracks ADD COLUMN IF NOT EXISTS route_matched_at TIMESTAMPTZ
  `,
  // A recognised course. `buffer` (25 m) is stored at creation so candidate
  // matching does not re-buffer every route. The activity count is derived from
  // activity_routes, never stored. Deleting a route only sets deleted_at: its
  // activity_routes rows stay so its runs are never paired into a route again.
  routes: `
    CREATE TABLE IF NOT EXISTS routes (
      id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name                   VARCHAR(255) NOT NULL,
      activity_type          VARCHAR(100) NOT NULL REFERENCES activity_type_definitions(name) ON UPDATE CASCADE,
      geom                   GEOMETRY(LINESTRING, 4326) NOT NULL,
      buffer                 GEOMETRY(GEOMETRY, 4326) NOT NULL,
      length_m               DOUBLE PRECISION NOT NULL,
      start_pt               GEOGRAPHY(POINT, 4326) NOT NULL,
      end_pt                 GEOGRAPHY(POINT, 4326) NOT NULL,
      canonical_activity_id  UUID REFERENCES activities(id) ON DELETE SET NULL,
      created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at             TIMESTAMPTZ
    )
  `,
  routes_indexes: `
    CREATE INDEX IF NOT EXISTS idx_routes_geom ON routes USING GIST (geom);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_routes_canonical ON routes (canonical_activity_id)
  `,
  activity_routes: `
    CREATE TABLE IF NOT EXISTS activity_routes (
      activity_id  UUID PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
      route_id     UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
      coverage     REAL NOT NULL,
      matched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  activity_routes_indexes: `
    CREATE INDEX IF NOT EXISTS idx_activity_routes_route ON activity_routes (route_id)
  `,
  // A directional stretch timed on every pass. Deleted for real: its efforts cascade.
  segments: `
    CREATE TABLE IF NOT EXISTS segments (
      id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name                      VARCHAR(255) NOT NULL,
      activity_type             VARCHAR(100) NOT NULL REFERENCES activity_type_definitions(name) ON UPDATE CASCADE,
      geom                      GEOMETRY(LINESTRING, 4326) NOT NULL,
      buffer                    GEOMETRY(GEOMETRY, 4326) NOT NULL,
      length_m                  DOUBLE PRECISION NOT NULL,
      created_from_activity_id  UUID REFERENCES activities(id) ON DELETE SET NULL,
      created_from_route_id     UUID REFERENCES routes(id) ON DELETE SET NULL,
      created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  segments_indexes: `
    CREATE INDEX IF NOT EXISTS idx_segments_geom ON segments USING GIST (geom)
  `,
  // One row per pass: an activity can cross a segment several times, and each of its
  // tracks (one per source) is timed on its own.
  segment_efforts: `
    CREATE TABLE IF NOT EXISTS segment_efforts (
      segment_id      UUID NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
      activity_id     UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      source          VARCHAR(50) NOT NULL,
      start_offset_s  DOUBLE PRECISION NOT NULL,
      elapsed_s       DOUBLE PRECISION NOT NULL,
      avg_hr          DOUBLE PRECISION,
      pace_s_per_km   DOUBLE PRECISION,
      approximate     BOOLEAN NOT NULL DEFAULT false,
      matched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (segment_id, activity_id, source, start_offset_s)
    )
  `,
  segment_efforts_indexes: `
    CREATE INDEX IF NOT EXISTS idx_segment_efforts_activity ON segment_efforts (activity_id)
  `,
  // A stretch several activities pass, offered as a segment. A dismissed or promoted row is
  // kept so the same stretch is never suggested again.
  suggested_segments: `
    CREATE TABLE IF NOT EXISTS suggested_segments (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      activity_type       VARCHAR(100) NOT NULL REFERENCES activity_type_definitions(name) ON UPDATE CASCADE,
      geom                GEOMETRY(LINESTRING, 4326) NOT NULL,
      length_m            DOUBLE PRECISION NOT NULL,
      activity_count      INTEGER NOT NULL,
      source_activity_id  UUID REFERENCES activities(id) ON DELETE SET NULL,
      status              VARCHAR(20) NOT NULL DEFAULT 'pending',
      segment_id          UUID REFERENCES segments(id) ON DELETE SET NULL,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      decided_at          TIMESTAMPTZ
    )
  `,
  suggested_segments_indexes: `
    CREATE INDEX IF NOT EXISTS idx_suggested_segments_geom ON suggested_segments USING GIST (geom)
  `,
  // When segment suggestion last looked at the activity's tracks; NULL means not yet.
  // Cleared when a track is rewritten. Additive (idempotent).
  activity_tracks_segments_suggested_at: `
    ALTER TABLE activity_tracks ADD COLUMN IF NOT EXISTS segments_suggested_at TIMESTAMPTZ
  `,
}
