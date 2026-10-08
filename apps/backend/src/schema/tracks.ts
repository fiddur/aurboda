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
  // A recognised course. `buffer` (25 m) is stored at creation so candidate
  // matching does not re-buffer every route. The activity count is derived from
  // activity_routes, never stored.
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
      updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  routes_indexes: `
    CREATE INDEX IF NOT EXISTS idx_routes_geom ON routes USING GIST (geom)
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
}
