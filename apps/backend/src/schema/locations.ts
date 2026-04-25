/**
 * Location-domain table SQL: detected/named locations, raw GPS, named places.
 */
export const locationsTables: Record<string, string> = {
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
      deleted_at      TIMESTAMPTZ,
      CONSTRAINT unique_location UNIQUE (source, time)
    )
  `,
  locations_indexes: `
    CREATE INDEX IF NOT EXISTS idx_locations_time ON locations (time DESC);
    CREATE INDEX IF NOT EXISTS idx_locations_geo ON locations USING GIST (location)
  `,

  // User-defined named locations (detected and named via Aurboda)
  named_locations: `
    CREATE TABLE IF NOT EXISTS named_locations (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name                  VARCHAR(255) NOT NULL,
      location              GEOGRAPHY(POINT, 4326) NOT NULL,
      radius                INTEGER NOT NULL DEFAULT 200,
      auto_create_activity  BOOLEAN NOT NULL DEFAULT false,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  named_locations_indexes: `
    CREATE INDEX IF NOT EXISTS idx_named_locations_geo ON named_locations USING GIST (location)
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
}
