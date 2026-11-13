import format from 'pg-format'

import type {
  DetectedLocation,
  DetectedLocationInput,
  DetectedLocationUpdate,
  Location,
  NamedLocation,
  NamedLocationInput,
  Place,
} from './types.ts'

import { recordIngestBySource, recordUsage } from '../services/usage-recorder.ts'
import { query } from './connection.ts'
import { buildDynamicUpdate, type UpdateEntry } from './dynamic-update.ts'
import { mapDetectedLocationRow, mapNamedLocationRow } from './row-mappers.ts'

export const insertLocation = async (user: string, location: Location) => {
  const source = location.source || 'owntracks'
  const result = await query(
    user,
    `INSERT INTO locations (source, time, location, accuracy, altitude, velocity, regions)
     VALUES ($1, $2, ST_MakePoint($3, $4)::geography, $5, $6, $7, $8)
     ON CONFLICT (source, time) DO NOTHING`,
    [
      source,
      location.time,
      location.lon,
      location.lat,
      location.accuracy,
      location.altitude,
      location.velocity,
      location.regions || [],
    ],
  )
  if ((result.rowCount ?? 0) > 0) recordUsage(user, 'ingest', source)
}

// pg-format %L produces invalid SQL for empty JS arrays (trailing comma before paren),
// so regions go in as a PostgreSQL array literal. Every element is quoted so a name
// with a comma, brace, quote or backslash (free-text zone names) survives.
const formatRegions = (regions: string[] | undefined): string =>
  regions?.length ? `{${regions.map((r) => `"${r.replaceAll(/[\\"]/g, '\\$&')}"`).join(',')}}` : '{}'

/** Batch-insert multiple locations in a single query. Returns the number of rows that were new. */
export const insertLocations = async (user: string, locations: Location[]): Promise<number> => {
  if (locations.length === 0) return 0

  const values = locations.map((loc) => [
    loc.source || 'owntracks',
    loc.time,
    loc.lon,
    loc.lat,
    loc.accuracy ?? null,
    loc.altitude ?? null,
    loc.velocity ?? null,
    formatRegions(loc.regions),
  ])

  // pg-format %L quotes all values as text; cast to correct types for PostGIS and numeric columns
  const result = await query<{ source: string }>(
    user,
    format(
      `INSERT INTO locations (source, time, location, accuracy, altitude, velocity, regions)
       SELECT v.source, v.time::timestamptz,
              ST_MakePoint(v.lon::double precision, v.lat::double precision)::geography,
              v.accuracy::double precision, v.altitude::double precision,
              v.velocity::double precision, v.regions::text[]
       FROM (VALUES %L) AS v(source, time, lon, lat, accuracy, altitude, velocity, regions)
       ON CONFLICT (source, time) DO NOTHING
       RETURNING source`,
      values,
    ),
  )
  recordIngestBySource(user, result.rows, (row) => row.source)
  return result.rows.length
}

/**
 * Soft-delete locations within a time range from every source *not* in
 * `keepSources`.
 *
 * Gives an activity's own GPS track precedence over passive phone tracking for
 * the activity's full span: a watch or bike computer fixes position far more
 * accurately than a phone does, and keeping both interleaves two tracks into one
 * zig-zagging path. Returns the number of points soft-deleted.
 *
 * Callers pass every activity-track source in `keepSources`, not just their own —
 * see `activityTrackSources` for why they must not supersede each other.
 *
 * Points are only soft-deleted, never removed. Note that re-inserting them does
 * not bring them back: both insert paths are `ON CONFLICT DO NOTHING`, so a
 * superseded point stays superseded.
 */
export const softDeleteSupersededLocations = async (
  user: string,
  keepSources: string[],
  start: Date,
  end: Date,
): Promise<number> => {
  const result = await query(
    user,
    `UPDATE locations SET deleted_at = NOW()
     WHERE NOT (source = ANY($1)) AND time >= $2 AND time <= $3 AND deleted_at IS NULL`,
    [keepSources, start, end],
  )
  return result.rowCount ?? 0
}

/**
 * Soft-delete `source` points in `[start, end]` that fall inside the span of a
 * live, finished activity which has its own GPS track from one of `trackSources`.
 *
 * The late-arrival counterpart of `softDeleteSupersededLocations`: a pulled
 * source (Home Assistant) can deliver phone points after the activity's track
 * was written, when the track writer's soft-delete has already run.
 */
export const softDeleteLocationsInTrackedActivities = async (
  user: string,
  source: string,
  trackSources: string[],
  start: Date,
  end: Date,
): Promise<number> => {
  const result = await query(
    user,
    `UPDATE locations l SET deleted_at = NOW()
     WHERE l.source = $1 AND l.time >= $3 AND l.time <= $4 AND l.deleted_at IS NULL
       AND EXISTS (
         SELECT 1 FROM activities a
         WHERE a.deleted_at IS NULL AND a.end_time IS NOT NULL
           AND a.start_time <= l.time AND a.end_time >= l.time
           AND EXISTS (
             SELECT 1 FROM activity_tracks t WHERE t.activity_id = a.id AND t.source = ANY($2)
           )
       )`,
    [source, trackSources, start, end],
  )
  return result.rowCount ?? 0
}

export const getLocations = async (user: string, start: Date, end: Date) => {
  const result = await query(
    user,
    `SELECT time, ST_AsGeoJSON(location) AS location, regions
     FROM locations
     WHERE time >= $1 AND time <= $2 AND deleted_at IS NULL
     ORDER BY time`,
    [start, end],
  )

  const locations = result.rows.map((row) => ({
    coordinates: JSON.parse(row.location).coordinates as [number, number],
    regions: row.regions,
    time: new Date(row.time),
  }))

  // Aggregate consecutive same-region visits into places
  const places = locations.reduce<{ region: string; startTime: Date; endTime: Date }[]>((acc, loc) => {
    const region = loc.regions?.[0] || 'Somewhere'

    if (acc.length > 0 && acc[acc.length - 1].region === region) {
      acc[acc.length - 1].endTime = loc.time
      return acc
    }

    return [...acc, { endTime: loc.time, region, startTime: loc.time }]
  }, [])

  return { locations, places }
}

/** Whether any GPS point falls in the window (what a route image would draw). */
export const hasLocations = async (user: string, start: Date, end: Date): Promise<boolean> => {
  const result = await query<{ exists: boolean }>(
    user,
    `SELECT EXISTS (
       SELECT 1 FROM locations WHERE time >= $1 AND time <= $2 AND deleted_at IS NULL
     ) AS exists`,
    [start, end],
  )
  return result.rows[0]?.exists === true
}

export const insertPlace = async (user: string, place: Place) => {
  await query(
    user,
    `INSERT INTO places (source, external_id, name, location, radius)
     VALUES ($1, $2, $3, ST_MakePoint($4, $5)::geography, $6)
     ON CONFLICT (source, external_id) DO UPDATE SET
       name = EXCLUDED.name,
       location = EXCLUDED.location,
       radius = EXCLUDED.radius`,
    [place.source || 'owntracks', place.external_id, place.name, place.lon, place.lat, place.radius],
  )
}

// ============================================================================
// Named Locations (user-defined via Aurboda)
// ============================================================================

const NAMED_LOCATION_COLS =
  'id, name, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lon, radius, auto_create_activity, created_at, updated_at'

export const insertNamedLocation = async (
  user: string,
  location: NamedLocationInput,
): Promise<NamedLocation> => {
  const result = await query(
    user,
    `INSERT INTO named_locations (name, location, radius, auto_create_activity)
     VALUES ($1, ST_MakePoint($2, $3)::geography, $4, $5)
     RETURNING ${NAMED_LOCATION_COLS}`,
    [
      location.name,
      location.lon,
      location.lat,
      location.radius ?? 200,
      location.auto_create_activity ?? false,
    ],
  )
  return mapNamedLocationRow(result.rows[0])
}

export const getNamedLocations = async (user: string): Promise<NamedLocation[]> => {
  const result = await query(user, `SELECT ${NAMED_LOCATION_COLS} FROM named_locations ORDER BY name`, [])
  return result.rows.map(mapNamedLocationRow)
}

export const getNamedLocationById = async (user: string, id: string): Promise<NamedLocation | null> => {
  const result = await query(user, `SELECT ${NAMED_LOCATION_COLS} FROM named_locations WHERE id = $1`, [id])
  if (result.rows.length === 0) return null
  return mapNamedLocationRow(result.rows[0])
}

/** The nearest named location within `distanceMeters` of the given coordinates. */
export const findNearbyNamedLocation = async (
  user: string,
  lat: number,
  lon: number,
  distanceMeters: number,
): Promise<NamedLocation | null> => {
  const result = await query(
    user,
    `SELECT ${NAMED_LOCATION_COLS}
     FROM named_locations
     WHERE ST_DWithin(location, ST_MakePoint($1, $2)::geography, $3)
     ORDER BY ST_Distance(location, ST_MakePoint($1, $2)::geography)
     LIMIT 1`,
    [lon, lat, distanceMeters],
  )
  if (result.rows.length === 0) return null
  return mapNamedLocationRow(result.rows[0])
}

export const updateNamedLocation = async (
  user: string,
  id: string,
  updates: Partial<NamedLocationInput>,
): Promise<NamedLocation | null> => {
  const fields: UpdateEntry[] = []
  if (updates.name !== undefined) fields.push({ column: 'name', value: updates.name })
  if (updates.lat !== undefined && updates.lon !== undefined) {
    fields.push({
      expression: 'location = ST_MakePoint($NEXT, $NEXT)::geography',
      values: [updates.lon, updates.lat],
    })
  }
  if (updates.radius !== undefined) fields.push({ column: 'radius', value: updates.radius })
  if (updates.auto_create_activity !== undefined) {
    fields.push({ column: 'auto_create_activity', value: updates.auto_create_activity })
  }

  const update = buildDynamicUpdate('named_locations', id, fields, {
    defaultClauses: ['updated_at = NOW()'],
    returning: NAMED_LOCATION_COLS,
  })
  if (!update) return null

  const result = await query(user, update.sql, update.params)
  if (result.rows.length === 0) return null
  return mapNamedLocationRow(result.rows[0])
}

export const deleteNamedLocation = async (user: string, id: string): Promise<boolean> => {
  const result = await query(user, `DELETE FROM named_locations WHERE id = $1`, [id])
  return (result.rowCount ?? 0) > 0
}

export const insertDetectedLocation = async (
  user: string,
  location: DetectedLocationInput,
): Promise<DetectedLocation> => {
  const result = await query(
    user,
    `INSERT INTO detected_locations (location, radius, total_minutes, visit_count, first_visit, last_visit)
     VALUES (ST_MakePoint($1, $2)::geography, $3, $4, $5, $6, $7)
     RETURNING id, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lon, radius,
       total_minutes, visit_count, first_visit, last_visit, address, geocode_status, created_at, updated_at`,
    [
      location.lon,
      location.lat,
      location.radius ?? 200,
      location.total_minutes,
      location.visit_count,
      location.first_visit,
      location.last_visit,
    ],
  )
  return mapDetectedLocationRow(result.rows[0])
}

export const getDetectedLocations = async (user: string): Promise<DetectedLocation[]> => {
  const result = await query(
    user,
    `SELECT id, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lon, radius,
       total_minutes, visit_count, first_visit, last_visit, address, geocode_status, created_at, updated_at
     FROM detected_locations
     ORDER BY last_visit DESC`,
    [],
  )
  return result.rows.map(mapDetectedLocationRow)
}

export const getDetectedLocationById = async (user: string, id: string): Promise<DetectedLocation | null> => {
  const result = await query(
    user,
    `SELECT id, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lon, radius,
       total_minutes, visit_count, first_visit, last_visit, address, geocode_status, created_at, updated_at
     FROM detected_locations
     WHERE id = $1`,
    [id],
  )
  if (result.rows.length === 0) return null
  return mapDetectedLocationRow(result.rows[0])
}

/**
 * Find an existing detected location near the given coordinates.
 * Returns the nearest location within the given distance threshold (meters).
 */
export const findNearbyDetectedLocation = async (
  user: string,
  lat: number,
  lon: number,
  distanceMeters: number = 50,
): Promise<DetectedLocation | null> => {
  const result = await query(
    user,
    `SELECT id, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lon, radius,
       total_minutes, visit_count, first_visit, last_visit, address, geocode_status, created_at, updated_at,
       ST_Distance(location, ST_MakePoint($1, $2)::geography) as distance
     FROM detected_locations
     WHERE ST_DWithin(location, ST_MakePoint($1, $2)::geography, $3)
     ORDER BY distance
     LIMIT 1`,
    [lon, lat, distanceMeters],
  )
  if (result.rows.length === 0) return null
  return mapDetectedLocationRow(result.rows[0])
}

export const updateDetectedLocation = async (
  user: string,
  id: string,
  updates: DetectedLocationUpdate,
): Promise<DetectedLocation | null> => {
  const fields: UpdateEntry[] = []
  if (updates.lat !== undefined && updates.lon !== undefined) {
    fields.push({
      expression: 'location = ST_MakePoint($NEXT, $NEXT)::geography',
      values: [updates.lon, updates.lat],
    })
  }
  if (updates.radius !== undefined) fields.push({ column: 'radius', value: updates.radius })
  if (updates.total_minutes !== undefined) {
    fields.push({ column: 'total_minutes', value: updates.total_minutes })
  }
  if (updates.visit_count !== undefined) fields.push({ column: 'visit_count', value: updates.visit_count })
  if (updates.first_visit !== undefined) fields.push({ column: 'first_visit', value: updates.first_visit })
  if (updates.last_visit !== undefined) fields.push({ column: 'last_visit', value: updates.last_visit })
  if (updates.address !== undefined) fields.push({ column: 'address', value: updates.address })
  if (updates.geocode_status !== undefined) {
    fields.push({ column: 'geocode_status', value: updates.geocode_status })
  }

  const update = buildDynamicUpdate('detected_locations', id, fields, {
    defaultClauses: ['updated_at = NOW()'],
    returning:
      'id, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lon, radius, total_minutes, visit_count, first_visit, last_visit, address, geocode_status, created_at, updated_at',
  })
  if (!update) return null

  const result = await query(user, update.sql, update.params)
  if (result.rows.length === 0) return null
  return mapDetectedLocationRow(result.rows[0])
}

export const deleteDetectedLocation = async (user: string, id: string): Promise<boolean> => {
  const result = await query(user, `DELETE FROM detected_locations WHERE id = $1`, [id])
  return (result.rowCount ?? 0) > 0
}

export const getDetectedLocationsNeedingGeocode = async (user: string): Promise<DetectedLocation[]> => {
  const result = await query(
    user,
    `SELECT id, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lon, radius,
       total_minutes, visit_count, first_visit, last_visit, address, geocode_status, created_at, updated_at
     FROM detected_locations
     WHERE geocode_status = 'pending'
     ORDER BY created_at`,
    [],
  )
  return result.rows.map(mapDetectedLocationRow)
}
