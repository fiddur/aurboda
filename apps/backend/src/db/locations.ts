/**
 * Location, Place, Named Location, and Detected Location CRUD operations.
 */
import { query } from './connection'
import { buildDynamicUpdate, type UpdateEntry } from './dynamic-update'
import { mapDetectedLocationRow, mapNamedLocationRow } from './row-mappers'
import type {
  DetectedLocation,
  DetectedLocationInput,
  DetectedLocationUpdate,
  Location,
  NamedLocation,
  NamedLocationInput,
  Place,
} from './types'

// ============================================================================
// Raw Locations
// ============================================================================

export const insertLocation = async (user: string, location: Location) => {
  await query(
    user,
    `INSERT INTO locations (source, time, location, accuracy, altitude, velocity, regions)
     VALUES ($1, $2, ST_MakePoint($3, $4)::geography, $5, $6, $7, $8)
     ON CONFLICT (source, time) DO NOTHING`,
    [
      location.source || 'owntracks',
      location.time,
      location.lon,
      location.lat,
      location.accuracy,
      location.altitude,
      location.velocity,
      location.regions || [],
    ],
  )
}

export const getLocations = async (user: string, start: Date, end: Date) => {
  const result = await query(
    user,
    `SELECT time, ST_AsGeoJSON(location) AS location, regions
     FROM locations
     WHERE time >= $1 AND time <= $2
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

// ============================================================================
// Places (Geofences)
// ============================================================================

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

export const insertNamedLocation = async (
  user: string,
  location: NamedLocationInput,
): Promise<NamedLocation> => {
  const result = await query(
    user,
    `INSERT INTO named_locations (name, location, radius)
     VALUES ($1, ST_MakePoint($2, $3)::geography, $4)
     RETURNING id, name, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lon, radius, created_at, updated_at`,
    [location.name, location.lon, location.lat, location.radius ?? 200],
  )
  return mapNamedLocationRow(result.rows[0])
}

export const getNamedLocations = async (user: string): Promise<NamedLocation[]> => {
  const result = await query(
    user,
    `SELECT id, name, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lon, radius, created_at, updated_at
     FROM named_locations
     ORDER BY name`,
    [],
  )
  return result.rows.map(mapNamedLocationRow)
}

export const getNamedLocationById = async (user: string, id: string): Promise<NamedLocation | null> => {
  const result = await query(
    user,
    `SELECT id, name, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lon, radius, created_at, updated_at
     FROM named_locations
     WHERE id = $1`,
    [id],
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

  const update = buildDynamicUpdate('named_locations', id, fields, {
    defaultClauses: ['updated_at = NOW()'],
    returning:
      'id, name, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lon, radius, created_at, updated_at',
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

// ============================================================================
// Detected Locations (clusters detected from GPS data)
// ============================================================================

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
  if (updates.total_minutes !== undefined)
    fields.push({ column: 'total_minutes', value: updates.total_minutes })
  if (updates.visit_count !== undefined) fields.push({ column: 'visit_count', value: updates.visit_count })
  if (updates.first_visit !== undefined) fields.push({ column: 'first_visit', value: updates.first_visit })
  if (updates.last_visit !== undefined) fields.push({ column: 'last_visit', value: updates.last_visit })
  if (updates.address !== undefined) fields.push({ column: 'address', value: updates.address })
  if (updates.geocode_status !== undefined)
    fields.push({ column: 'geocode_status', value: updates.geocode_status })

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

/**
 * Get detected locations that need geocoding.
 */
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
