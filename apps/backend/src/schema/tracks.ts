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
}
