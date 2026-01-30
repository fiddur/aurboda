import { Client, QueryResultRow } from 'pg'
import format from 'pg-format'
import {
  ActivityType,
  createTableStatements,
  cumulativeMetrics,
  DataSource,
  healthConnectActivityMapping,
  healthConnectMetricMapping,
  isValidMetric,
  MetricType,
  metricUnits,
  tableCreationOrder,
} from './schema'

const dbByUser: Record<string, Client> = {}

const userDbName = (user: string) => `aurboda_${user}`

/**
 * Inject a database client for a user. Used for testing with testcontainers.
 * @internal
 */
export const _setClientForUser = (user: string, client: Client) => {
  dbByUser[user] = client
}

export const query = async <T extends QueryResultRow = QueryResultRow>(
  dbOrUser: Client | string,
  queryStr: string,
  params?: unknown[],
) => {
  const db = typeof dbOrUser === 'string' ? await getDbForUser(dbOrUser) : dbOrUser
  const result = await db.query<T>(queryStr, params)
  return result
}

export const loginToUserDb = async (user: string, password: string) => {
  // Check if we already have a connection for this user
  const existing = dbByUser[user]
  if (existing) {
    // Already connected - auth is handled by tokens, no need to re-verify password
    // This avoids storing passwords in memory while maintaining security via token auth
    return
  }

  const database = userDbName(user)
  const client = new Client({ database, password, user })
  await client.connect()
  dbByUser[user] = client
}

export const makeNewUserDb = async (userDb: Client, user: string, password: string) => {
  const database = userDbName(user)
  console.log(`New user ${user}`)
  await query(userDb, format('CREATE USER %I WITH ENCRYPTED PASSWORD %L', user, password))
  await query(userDb, format('GRANT %I TO %I', user, process.env.PGUSER))
  await query(userDb, format('CREATE DATABASE %I OWNER %I', database, user))
  const client = new Client({ database, password, user })
  await client.connect()
  dbByUser[user] = client
  await initializeSchema(user)
}

export const getDbForUser = async (user: string) => {
  if (dbByUser[user]) return dbByUser[user]
  const client = new Client({ database: userDbName(user) })
  await client.connect()
  await query(client, format('SET ROLE %L', user))
  dbByUser[user] = client
  return client
}

/**
 * Initialize the database schema for a user.
 * Creates all tables and indexes if they don't exist.
 */
export const initializeSchema = async (user: string) => {
  const db = await getDbForUser(user)

  // Note: PostGIS extension must be created by superuser before calling this
  // sudo -u postgres psql <database> -c "CREATE EXTENSION postgis"

  for (const key of tableCreationOrder) {
    await query(db, createTableStatements[key])
  }
}

/**
 * Run database migrations for a user.
 * Checks which tables exist and creates missing ones.
 */
export const migrateSchema = async (user: string) => {
  const db = await getDbForUser(user)
  const database = `aurboda_${user}`

  // Check which tables exist
  const existingTables = await query(
    db,
    `SELECT table_name FROM information_schema.tables WHERE table_catalog = $1 AND table_schema = 'public'`,
    [database],
  )
  const existingTableNames = new Set(existingTables.rows.map((r) => r.table_name))

  // Create missing tables
  for (const key of tableCreationOrder) {
    const tableName = key.replace('_indexes', '')
    if (!existingTableNames.has(tableName) || key.endsWith('_indexes')) {
      // Always run index creation (IF NOT EXISTS handles duplicates)
      // Create tables only if they don't exist
      await query(db, createTableStatements[key])
    }
  }
}

/**
 * Check if schema is initialized (has required tables).
 */
export const schemaInitialized = async (user: string) => {
  const database = userDbName(user)
  const db = await getDbForUser(user)
  const result = await query(
    db,
    `SELECT 1 FROM information_schema.tables WHERE table_catalog = $1 AND table_name = $2`,
    [database, 'raw_records'],
  )
  return result.rowCount !== 0
}

// ============================================================================
// Raw Records
// ============================================================================

export interface RawRecord {
  id?: string
  source: DataSource
  recordType: string
  externalId?: string
  recordedAt: Date
  data: Record<string, unknown>
}

export const insertRawRecord = async (user: string, record: RawRecord) => {
  await query(
    user,
    `INSERT INTO raw_records (source, record_type, external_id, recorded_at, data)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (source, record_type, external_id) DO UPDATE SET
       data = EXCLUDED.data,
       received_at = NOW()`,
    [record.source, record.recordType, record.externalId, record.recordedAt, record.data],
  )
}

// ============================================================================
// Time Series
// ============================================================================

export interface TimeSeriesPoint {
  time: Date
  metric: MetricType
  value: number
  source: DataSource
}

export const insertTimeSeries = async (user: string, points: TimeSeriesPoint[]) => {
  if (points.length === 0) return

  // Deduplicate points by (time, metric, source) to avoid PostgreSQL ON CONFLICT error
  // when the same key appears multiple times in a single INSERT
  const deduped = new Map<string, TimeSeriesPoint>()
  for (const p of points) {
    const key = `${p.time.toISOString()}|${p.metric}|${p.source}`
    deduped.set(key, p) // Last value wins
  }

  const values = Array.from(deduped.values()).map((p) => [
    p.time,
    p.metric,
    p.value,
    metricUnits[p.metric],
    p.source,
  ])

  await query(
    user,
    format(
      `INSERT INTO time_series (time, metric, value, unit, source)
       VALUES %L
       ON CONFLICT (time, metric, source) DO UPDATE SET value = EXCLUDED.value`,
      values,
    ),
  )
}

export const getTimeSeries = async (
  user: string,
  metric: MetricType,
  start: Date,
  end: Date,
): Promise<[Date, number][]> => {
  const result = await query(
    user,
    `SELECT time, value FROM time_series
     WHERE metric = $1 AND time >= $2 AND time <= $3
     ORDER BY time`,
    [metric, start, end],
  )

  return result.rows.map((row) => [new Date(row.time), row.value])
}

export const getTimeSeriesMultiMetric = async (
  user: string,
  metrics: MetricType[],
  start: Date,
  end: Date,
): Promise<Record<MetricType, [Date, number][]>> => {
  const result = await query(
    user,
    `SELECT time, metric, value FROM time_series
     WHERE metric = ANY($1) AND time >= $2 AND time <= $3
     ORDER BY metric, time`,
    [metrics, start, end],
  )

  const data: Record<string, [Date, number][]> = {}
  for (const row of result.rows) {
    if (!data[row.metric]) data[row.metric] = []
    data[row.metric].push([new Date(row.time), row.value])
  }

  return data as Record<MetricType, [Date, number][]>
}

// ============================================================================
// Aggregated Time Series Statistics
// ============================================================================

export interface MetricStats {
  metric: MetricType
  count: number
  min: number
  max: number
  avg: number
  stddev: number
  unit: string
}

export const getTimeSeriesStats = async (
  user: string,
  metrics: MetricType[],
  start: Date,
  end: Date,
): Promise<MetricStats[]> => {
  if (metrics.length === 0) return []

  const result = await query(
    user,
    `SELECT
       metric,
       COUNT(*)::integer as count,
       MIN(value) as min,
       MAX(value) as max,
       AVG(value) as avg,
       STDDEV_POP(value) as stddev,
       MAX(unit) as unit
     FROM time_series
     WHERE metric = ANY($1) AND time >= $2 AND time <= $3
     GROUP BY metric
     ORDER BY metric`,
    [metrics, start, end],
  )

  return result.rows.map((row) => ({
    avg: row.avg !== null ? Number(row.avg) : 0,
    count: row.count,
    max: row.max !== null ? Number(row.max) : 0,
    metric: row.metric as MetricType,
    min: row.min !== null ? Number(row.min) : 0,
    stddev: row.stddev !== null ? Number(row.stddev) : 0,
    unit: row.unit,
  }))
}

export interface DailyMetricAggregate {
  date: string
  metric: MetricType
  avg: number
}

export const getDailyAggregates = async (
  user: string,
  metrics: MetricType[],
  start: Date,
  end: Date,
): Promise<DailyMetricAggregate[]> => {
  if (metrics.length === 0) return []

  const result = await query(
    user,
    `SELECT
       DATE(time) as date,
       metric,
       AVG(value) as avg
     FROM time_series
     WHERE metric = ANY($1) AND time >= $2 AND time <= $3
     GROUP BY DATE(time), metric
     ORDER BY metric, date`,
    [metrics, start, end],
  )

  return result.rows.map((row) => ({
    avg: Number(row.avg),
    date: row.date.toISOString().split('T')[0],
    metric: row.metric as MetricType,
  }))
}

// ============================================================================
// Activities
// ============================================================================

export interface Activity {
  id?: string
  source: DataSource
  activityType: ActivityType
  startTime: Date
  endTime?: Date
  title?: string
  notes?: string
  data?: Record<string, unknown>
}

export const insertActivity = async (user: string, activity: Activity) => {
  await query(
    user,
    `INSERT INTO activities (source, activity_type, start_time, end_time, title, notes, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (source, activity_type, start_time) DO UPDATE SET
       end_time = EXCLUDED.end_time,
       title = EXCLUDED.title,
       notes = EXCLUDED.notes,
       data = EXCLUDED.data`,
    [
      activity.source,
      activity.activityType,
      activity.startTime,
      activity.endTime,
      activity.title,
      activity.notes,
      activity.data,
    ],
  )
}

export const getActivities = async (
  user: string,
  activityType: ActivityType | ActivityType[],
  start: Date,
  end: Date,
): Promise<Activity[]> => {
  const types = Array.isArray(activityType) ? activityType : [activityType]

  const result = await query(
    user,
    `SELECT id, source, activity_type, start_time, end_time, title, notes, data
     FROM activities
     WHERE activity_type = ANY($1) AND start_time >= $2 AND start_time <= $3
     ORDER BY start_time`,
    [types, start, end],
  )

  return result.rows.map((row) => ({
    activityType: row.activity_type,
    data: row.data,
    endTime: row.end_time ? new Date(row.end_time) : undefined,
    id: row.id,
    notes: row.notes,
    source: row.source,
    startTime: new Date(row.start_time),
    title: row.title,
  }))
}

/**
 * Get sleep sessions that overlap with a date range.
 * Uses date overlap logic so overnight sleep (starting 11pm, ending 7am)
 * appears on the wake-up day rather than the start day.
 */
export const getSleepSessions = async (user: string, start: Date, end: Date): Promise<Activity[]> => {
  const result = await query(
    user,
    `SELECT id, source, activity_type, start_time, end_time, title, notes, data
     FROM activities
     WHERE activity_type = 'sleep'
       AND start_time < $2
       AND (end_time >= $1 OR end_time IS NULL)
     ORDER BY start_time`,
    [start, end],
  )

  return result.rows.map((row) => ({
    activityType: row.activity_type,
    data: row.data,
    endTime: row.end_time ? new Date(row.end_time) : undefined,
    id: row.id,
    notes: row.notes,
    source: row.source,
    startTime: new Date(row.start_time),
    title: row.title,
  }))
}

// ============================================================================
// Locations
// ============================================================================

export interface Location {
  id?: string
  source?: DataSource
  time: Date
  lat: number
  lon: number
  accuracy?: number
  altitude?: number
  velocity?: number
  regions?: string[]
}

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

export interface Place {
  id?: string
  source?: DataSource
  externalId?: string
  name: string
  lat: number
  lon: number
  radius: number
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
    [place.source || 'owntracks', place.externalId, place.name, place.lon, place.lat, place.radius],
  )
}

// ============================================================================
// Named Locations (user-defined via Aurboda)
// ============================================================================

export interface NamedLocation {
  id: string
  name: string
  lat: number
  lon: number
  radius: number
  createdAt: Date
  updatedAt: Date
}

export interface NamedLocationInput {
  name: string
  lat: number
  lon: number
  radius?: number
}

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
  const row = result.rows[0]
  return {
    createdAt: new Date(row.created_at),
    id: row.id,
    lat: row.lat,
    lon: row.lon,
    name: row.name,
    radius: row.radius,
    updatedAt: new Date(row.updated_at),
  }
}

export const getNamedLocations = async (user: string): Promise<NamedLocation[]> => {
  const result = await query(
    user,
    `SELECT id, name, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lon, radius, created_at, updated_at
     FROM named_locations
     ORDER BY name`,
    [],
  )
  return result.rows.map((row) => ({
    createdAt: new Date(row.created_at),
    id: row.id,
    lat: row.lat,
    lon: row.lon,
    name: row.name,
    radius: row.radius,
    updatedAt: new Date(row.updated_at),
  }))
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
  const row = result.rows[0]
  return {
    createdAt: new Date(row.created_at),
    id: row.id,
    lat: row.lat,
    lon: row.lon,
    name: row.name,
    radius: row.radius,
    updatedAt: new Date(row.updated_at),
  }
}

export const updateNamedLocation = async (
  user: string,
  id: string,
  updates: Partial<NamedLocationInput>,
): Promise<NamedLocation | null> => {
  const setClauses: string[] = ['updated_at = NOW()']
  const values: unknown[] = []
  let paramIndex = 1

  if (updates.name !== undefined) {
    setClauses.push(`name = $${paramIndex++}`)
    values.push(updates.name)
  }
  if (updates.lat !== undefined && updates.lon !== undefined) {
    setClauses.push(`location = ST_MakePoint($${paramIndex}, $${paramIndex + 1})::geography`)
    values.push(updates.lon, updates.lat)
    paramIndex += 2
  }
  if (updates.radius !== undefined) {
    setClauses.push(`radius = $${paramIndex++}`)
    values.push(updates.radius)
  }

  values.push(id)

  const result = await query(
    user,
    `UPDATE named_locations
     SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING id, name, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lon, radius, created_at, updated_at`,
    values,
  )

  if (result.rows.length === 0) return null
  const row = result.rows[0]
  return {
    createdAt: new Date(row.created_at),
    id: row.id,
    lat: row.lat,
    lon: row.lon,
    name: row.name,
    radius: row.radius,
    updatedAt: new Date(row.updated_at),
  }
}

export const deleteNamedLocation = async (user: string, id: string): Promise<boolean> => {
  const result = await query(user, `DELETE FROM named_locations WHERE id = $1`, [id])
  return (result.rowCount ?? 0) > 0
}

// ============================================================================
// Detected Locations (clusters detected from GPS data)
// ============================================================================

export type GeocodeStatus = 'pending' | 'geocoding' | 'success' | 'failed'

export interface DetectedLocation {
  id: string
  lat: number
  lon: number
  radius: number
  totalMinutes: number
  visitCount: number
  firstVisit: Date
  lastVisit: Date
  address: string | null
  geocodeStatus: GeocodeStatus
  createdAt: Date
  updatedAt: Date
}

export interface DetectedLocationInput {
  lat: number
  lon: number
  radius?: number
  totalMinutes: number
  visitCount: number
  firstVisit: Date
  lastVisit: Date
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
      location.totalMinutes,
      location.visitCount,
      location.firstVisit,
      location.lastVisit,
    ],
  )
  const row = result.rows[0]
  return {
    address: row.address,
    createdAt: new Date(row.created_at),
    firstVisit: new Date(row.first_visit),
    geocodeStatus: row.geocode_status as GeocodeStatus,
    id: row.id,
    lastVisit: new Date(row.last_visit),
    lat: row.lat,
    lon: row.lon,
    radius: row.radius,
    totalMinutes: row.total_minutes,
    updatedAt: new Date(row.updated_at),
    visitCount: row.visit_count,
  }
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
  return result.rows.map((row) => ({
    address: row.address,
    createdAt: new Date(row.created_at),
    firstVisit: new Date(row.first_visit),
    geocodeStatus: row.geocode_status as GeocodeStatus,
    id: row.id,
    lastVisit: new Date(row.last_visit),
    lat: row.lat,
    lon: row.lon,
    radius: row.radius,
    totalMinutes: row.total_minutes,
    updatedAt: new Date(row.updated_at),
    visitCount: row.visit_count,
  }))
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
  const row = result.rows[0]
  return {
    address: row.address,
    createdAt: new Date(row.created_at),
    firstVisit: new Date(row.first_visit),
    geocodeStatus: row.geocode_status as GeocodeStatus,
    id: row.id,
    lastVisit: new Date(row.last_visit),
    lat: row.lat,
    lon: row.lon,
    radius: row.radius,
    totalMinutes: row.total_minutes,
    updatedAt: new Date(row.updated_at),
    visitCount: row.visit_count,
  }
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
  const row = result.rows[0]
  return {
    address: row.address,
    createdAt: new Date(row.created_at),
    firstVisit: new Date(row.first_visit),
    geocodeStatus: row.geocode_status as GeocodeStatus,
    id: row.id,
    lastVisit: new Date(row.last_visit),
    lat: row.lat,
    lon: row.lon,
    radius: row.radius,
    totalMinutes: row.total_minutes,
    updatedAt: new Date(row.updated_at),
    visitCount: row.visit_count,
  }
}

export interface DetectedLocationUpdate {
  lat?: number
  lon?: number
  radius?: number
  totalMinutes?: number
  visitCount?: number
  firstVisit?: Date
  lastVisit?: Date
  address?: string | null
  geocodeStatus?: GeocodeStatus
}

export const updateDetectedLocation = async (
  user: string,
  id: string,
  updates: DetectedLocationUpdate,
): Promise<DetectedLocation | null> => {
  const setClauses: string[] = ['updated_at = NOW()']
  const values: unknown[] = []
  let paramIndex = 1

  if (updates.lat !== undefined && updates.lon !== undefined) {
    setClauses.push(`location = ST_MakePoint($${paramIndex}, $${paramIndex + 1})::geography`)
    values.push(updates.lon, updates.lat)
    paramIndex += 2
  }
  if (updates.radius !== undefined) {
    setClauses.push(`radius = $${paramIndex++}`)
    values.push(updates.radius)
  }
  if (updates.totalMinutes !== undefined) {
    setClauses.push(`total_minutes = $${paramIndex++}`)
    values.push(updates.totalMinutes)
  }
  if (updates.visitCount !== undefined) {
    setClauses.push(`visit_count = $${paramIndex++}`)
    values.push(updates.visitCount)
  }
  if (updates.firstVisit !== undefined) {
    setClauses.push(`first_visit = $${paramIndex++}`)
    values.push(updates.firstVisit)
  }
  if (updates.lastVisit !== undefined) {
    setClauses.push(`last_visit = $${paramIndex++}`)
    values.push(updates.lastVisit)
  }
  if (updates.address !== undefined) {
    setClauses.push(`address = $${paramIndex++}`)
    values.push(updates.address)
  }
  if (updates.geocodeStatus !== undefined) {
    setClauses.push(`geocode_status = $${paramIndex++}`)
    values.push(updates.geocodeStatus)
  }

  values.push(id)

  const result = await query(
    user,
    `UPDATE detected_locations
     SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING id, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lon, radius,
       total_minutes, visit_count, first_visit, last_visit, address, geocode_status, created_at, updated_at`,
    values,
  )

  if (result.rows.length === 0) return null
  const row = result.rows[0]
  return {
    address: row.address,
    createdAt: new Date(row.created_at),
    firstVisit: new Date(row.first_visit),
    geocodeStatus: row.geocode_status as GeocodeStatus,
    id: row.id,
    lastVisit: new Date(row.last_visit),
    lat: row.lat,
    lon: row.lon,
    radius: row.radius,
    totalMinutes: row.total_minutes,
    updatedAt: new Date(row.updated_at),
    visitCount: row.visit_count,
  }
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
  return result.rows.map((row) => ({
    address: row.address,
    createdAt: new Date(row.created_at),
    firstVisit: new Date(row.first_visit),
    geocodeStatus: row.geocode_status as GeocodeStatus,
    id: row.id,
    lastVisit: new Date(row.last_visit),
    lat: row.lat,
    lon: row.lon,
    radius: row.radius,
    totalMinutes: row.total_minutes,
    updatedAt: new Date(row.updated_at),
    visitCount: row.visit_count,
  }))
}

// ============================================================================
// Tags
// ============================================================================

export interface Tag {
  id?: string
  source: DataSource
  externalId?: string
  tag: string
  startTime: Date
  endTime?: Date
}

export const insertTag = async (user: string, tag: Tag) => {
  await query(
    user,
    `INSERT INTO tags (source, external_id, tag, start_time, end_time)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (source, external_id) DO UPDATE SET
       tag = EXCLUDED.tag,
       start_time = EXCLUDED.start_time,
       end_time = EXCLUDED.end_time`,
    [tag.source, tag.externalId, tag.tag, tag.startTime, tag.endTime],
  )
}

export const getTags = async (user: string, start: Date, end: Date): Promise<Tag[]> => {
  const result = await query(
    user,
    `SELECT id, source, external_id, tag, start_time, end_time
     FROM tags
     WHERE start_time >= $1 AND start_time <= $2
     ORDER BY start_time`,
    [start, end],
  )

  return result.rows.map((row) => ({
    endTime: row.end_time ? new Date(row.end_time) : undefined,
    externalId: row.external_id,
    id: row.id,
    source: row.source,
    startTime: new Date(row.start_time),
    tag: row.tag,
  }))
}

export const deleteTag = async (user: string, externalId: string): Promise<boolean> => {
  const result = await query(user, `DELETE FROM tags WHERE external_id = $1`, [externalId])

  return (result.rowCount ?? 0) > 0
}

/**
 * Find a tag that can be merged with a new tag.
 * Matches on:
 * - Same tag name
 * - end_time within mergeSpanSeconds of newStartTime (for tags with end_time)
 * - OR start_time within mergeSpanSeconds of newStartTime (for point-in-time tags without end_time)
 * Only considers manual source tags.
 */
export const findMergeableTag = async (
  user: string,
  tagName: string,
  newStartTime: Date,
  mergeSpanSeconds: number,
): Promise<Tag | undefined> => {
  // Calculate the earliest allowed end_time/start_time for merging
  const earliestMergeTime = new Date(newStartTime.getTime() - mergeSpanSeconds * 1000)

  const result = await query(
    user,
    `SELECT id, source, external_id, tag, start_time, end_time
     FROM tags
     WHERE tag = $1
       AND source = 'manual'
       AND (
         (end_time IS NOT NULL AND end_time >= $2 AND end_time <= $3)
         OR (end_time IS NULL AND start_time >= $2 AND start_time <= $3)
       )
     ORDER BY COALESCE(end_time, start_time) DESC
     LIMIT 1`,
    [tagName, earliestMergeTime, newStartTime],
  )

  if (result.rows.length === 0) return undefined

  const row = result.rows[0]
  return {
    endTime: row.end_time ? new Date(row.end_time) : undefined,
    externalId: row.external_id,
    id: row.id,
    source: row.source,
    startTime: new Date(row.start_time),
    tag: row.tag,
  }
}

/**
 * Update the end_time of an existing tag.
 */
export const updateTagEndTime = async (user: string, externalId: string, endTime: Date): Promise<boolean> => {
  const result = await query(user, `UPDATE tags SET end_time = $1 WHERE external_id = $2`, [
    endTime,
    externalId,
  ])

  return (result.rowCount ?? 0) > 0
}

// ============================================================================
// Productivity (RescueTime)
// ============================================================================

export interface ProductivityRecord {
  source?: DataSource
  startTime: Date
  endTime: Date
  activity: string
  category?: string
  productivity?: number
  durationSec: number
  isMobile?: boolean
}

export const insertProductivity = async (user: string, records: ProductivityRecord[]) => {
  if (records.length === 0) return

  const values = records.map((r) => [
    r.source || 'rescuetime',
    r.startTime,
    r.endTime,
    r.activity,
    r.category,
    r.productivity,
    r.durationSec,
    r.isMobile || false,
  ])

  await query(
    user,
    format(
      `INSERT INTO productivity (source, start_time, end_time, activity, category, productivity, duration_sec, is_mobile)
       VALUES %L
       ON CONFLICT (source, start_time, activity) DO UPDATE SET
         end_time = EXCLUDED.end_time,
         category = EXCLUDED.category,
         productivity = EXCLUDED.productivity,
         duration_sec = EXCLUDED.duration_sec`,
      values,
    ),
  )
}

export const getProductivity = async (
  user: string,
  start: Date,
  end: Date,
): Promise<ProductivityRecord[]> => {
  const result = await query(
    user,
    `SELECT source, start_time, end_time, activity, category, productivity, duration_sec, is_mobile
     FROM productivity
     WHERE start_time >= $1 AND start_time <= $2
     ORDER BY start_time`,
    [start, end],
  )

  return result.rows.map((row) => ({
    activity: row.activity,
    category: row.category,
    durationSec: row.duration_sec,
    endTime: new Date(row.end_time),
    isMobile: row.is_mobile,
    productivity: row.productivity,
    source: row.source,
    startTime: new Date(row.start_time),
  }))
}

// ============================================================================
// Lab Results
// ============================================================================

export interface LabResult {
  id?: string
  testDate: Date
  testName: string
  testCategory?: string
  value: number
  unit: string
  referenceLow?: number
  referenceHigh?: number
  flag?: 'normal' | 'high' | 'low' | 'critical'
  labName?: string
  notes?: string
}

export const insertLabResult = async (user: string, result: LabResult) => {
  await query(
    user,
    `INSERT INTO lab_results (test_date, test_name, test_category, value, unit, reference_low, reference_high, flag, lab_name, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      result.testDate,
      result.testName,
      result.testCategory,
      result.value,
      result.unit,
      result.referenceLow,
      result.referenceHigh,
      result.flag,
      result.labName,
      result.notes,
    ],
  )
}

export const getLabResults = async (
  user: string,
  start: Date,
  end: Date,
  testCategory?: string,
): Promise<LabResult[]> => {
  let sql = `SELECT * FROM lab_results WHERE test_date >= $1 AND test_date <= $2`
  const params: unknown[] = [start, end]

  if (testCategory) {
    sql += ` AND test_category = $3`
    params.push(testCategory)
  }

  sql += ` ORDER BY test_date DESC, test_name`

  const result = await query(user, sql, params)

  return result.rows.map((row) => ({
    flag: row.flag,
    id: row.id,
    labName: row.lab_name,
    notes: row.notes,
    referenceHigh: row.reference_high,
    referenceLow: row.reference_low,
    testCategory: row.test_category,
    testDate: new Date(row.test_date),
    testName: row.test_name,
    unit: row.unit,
    value: row.value,
  }))
}

// ============================================================================
// OAuth Tokens
// ============================================================================

export interface OAuthToken {
  provider: string
  accessToken: string
  refreshToken?: string
  expiresAt?: Date
  scopes?: string[]
}

export const upsertOAuthToken = async (user: string, token: OAuthToken) => {
  await query(
    user,
    `INSERT INTO oauth_tokens (provider, access_token, refresh_token, expires_at, scopes, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (provider) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = COALESCE(EXCLUDED.refresh_token, oauth_tokens.refresh_token),
       expires_at = EXCLUDED.expires_at,
       scopes = EXCLUDED.scopes,
       updated_at = NOW()`,
    [token.provider, token.accessToken, token.refreshToken, token.expiresAt, token.scopes],
  )
}

export const getOAuthToken = async (user: string, provider: string): Promise<OAuthToken | null> => {
  const result = await query(
    user,
    `SELECT provider, access_token, refresh_token, expires_at, scopes
     FROM oauth_tokens
     WHERE provider = $1`,
    [provider],
  )

  if (result.rows.length === 0) return null

  const row = result.rows[0]
  return {
    accessToken: row.access_token,
    expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
    provider: row.provider,
    refreshToken: row.refresh_token,
    scopes: row.scopes,
  }
}

// ============================================================================
// Sync State
// ============================================================================

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'rate_limited'

export interface SyncState {
  id?: string
  provider: string
  dataType: string
  lastSyncTime?: Date
  syncStartDate?: Date
  status: SyncStatus
  errorMessage?: string
  retryAfter?: Date
  updatedAt?: Date
}

export const getSyncState = async (
  user: string,
  provider: string,
  dataType: string,
): Promise<SyncState | null> => {
  const result = await query(
    user,
    `SELECT id, provider, data_type, last_sync_time, sync_start_date, status, error_message, retry_after, updated_at
     FROM sync_state
     WHERE provider = $1 AND data_type = $2`,
    [provider, dataType],
  )

  if (result.rows.length === 0) return null

  const row = result.rows[0]
  return {
    dataType: row.data_type,
    errorMessage: row.error_message,
    id: row.id,
    lastSyncTime: row.last_sync_time ? new Date(row.last_sync_time) : undefined,
    provider: row.provider,
    retryAfter: row.retry_after ? new Date(row.retry_after) : undefined,
    status: row.status as SyncStatus,
    syncStartDate: row.sync_start_date ? new Date(row.sync_start_date) : undefined,
    updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
  }
}

export const upsertSyncState = async (user: string, state: SyncState) => {
  await query(
    user,
    `INSERT INTO sync_state (provider, data_type, last_sync_time, sync_start_date, status, error_message, retry_after, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (provider, data_type) DO UPDATE SET
       last_sync_time = COALESCE(EXCLUDED.last_sync_time, sync_state.last_sync_time),
       sync_start_date = COALESCE(EXCLUDED.sync_start_date, sync_state.sync_start_date),
       status = EXCLUDED.status,
       error_message = EXCLUDED.error_message,
       retry_after = EXCLUDED.retry_after,
       updated_at = NOW()`,
    [
      state.provider,
      state.dataType,
      state.lastSyncTime,
      state.syncStartDate,
      state.status,
      state.errorMessage,
      state.retryAfter,
    ],
  )
}

export const getAllSyncStates = async (user: string, provider: string): Promise<SyncState[]> => {
  const result = await query(
    user,
    `SELECT id, provider, data_type, last_sync_time, sync_start_date, status, error_message, retry_after, updated_at
     FROM sync_state
     WHERE provider = $1
     ORDER BY data_type`,
    [provider],
  )

  return result.rows.map((row) => ({
    dataType: row.data_type,
    errorMessage: row.error_message,
    id: row.id,
    lastSyncTime: row.last_sync_time ? new Date(row.last_sync_time) : undefined,
    provider: row.provider,
    retryAfter: row.retry_after ? new Date(row.retry_after) : undefined,
    status: row.status as SyncStatus,
    syncStartDate: row.sync_start_date ? new Date(row.sync_start_date) : undefined,
    updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
  }))
}

export const resetSyncState = async (user: string, provider: string, dataType?: string) => {
  if (dataType) {
    await query(user, `DELETE FROM sync_state WHERE provider = $1 AND data_type = $2`, [provider, dataType])
  } else {
    await query(user, `DELETE FROM sync_state WHERE provider = $1`, [provider])
  }
}

// ============================================================================
// Health Connect Data Processing
// ============================================================================

/**
 * Process incoming Health Connect data and normalize into appropriate tables.
 */
export const processHealthConnectData = async (
  user: string,
  recordType: string,
  data: Record<string, unknown>,
) => {
  const externalId = (data.metadata as Record<string, unknown>)?.id as string | undefined

  // Always store raw record
  await insertRawRecord(user, {
    data,
    externalId,
    recordType,
    recordedAt: new Date((data.startTime || data.time) as string),
    source: 'health_connect',
  })

  // Normalize to time_series if applicable
  const metric = healthConnectMetricMapping[recordType]
  if (metric) {
    const points = extractTimeSeriesPoints(recordType, metric, data)
    if (points.length > 0) {
      await insertTimeSeries(user, points)
    }
  }

  // Handle blood pressure specially (two metrics)
  if (recordType === 'BloodPressureRecord') {
    const time = new Date((data.time as string) || (data.startTime as string))
    await insertTimeSeries(user, [
      {
        metric: 'blood_pressure_systolic',
        source: 'health_connect',
        time,
        value: data.systolicInMmHg as number,
      },
      {
        metric: 'blood_pressure_diastolic',
        source: 'health_connect',
        time,
        value: data.diastolicInMmHg as number,
      },
    ])
  }

  // Normalize to activities if applicable
  const activityType = healthConnectActivityMapping[recordType]
  if (activityType) {
    await insertActivity(user, {
      activityType,
      data,
      endTime: data.endTime ? new Date(data.endTime as string) : undefined,
      notes: data.notes as string | undefined,
      source: 'health_connect',
      startTime: new Date(data.startTime as string),
      title: data.title as string | undefined,
    })
  }
}

/**
 * Extract time series points from Health Connect record.
 */
function extractTimeSeriesPoints(
  recordType: string,
  metric: MetricType,
  data: Record<string, unknown>,
): TimeSeriesPoint[] {
  // Records with samples (HeartRateRecord, etc.)
  if (data.samples && Array.isArray(data.samples)) {
    return (data.samples as { time: string; beatsPerMinute?: number }[]).map((sample) => ({
      metric,
      source: 'health_connect' as DataSource,
      time: new Date(sample.time),
      value: sample.beatsPerMinute || 0,
    }))
  }

  // Instant records (WeightRecord, BodyFatRecord, etc.)
  const time = data.time || data.startTime
  if (!time) return []

  let value: number | undefined

  switch (recordType) {
    case 'WeightRecord':
      value = data.weightInKilograms as number
      break
    case 'BodyFatRecord':
      value = data.percentage as number
      break
    case 'BoneMassRecord':
    case 'LeanBodyMassRecord':
    case 'BodyWaterMassRecord':
      value = data.massInKilograms as number
      break
    case 'HeightRecord':
      value = data.heightInMeters as number
      break
    case 'StepsRecord':
      value = data.count as number
      break
    case 'DistanceRecord':
      value = data.distanceInMeters as number
      break
    case 'FloorsClimbedRecord':
      value = data.floors as number
      break
    case 'ActiveCaloriesBurnedRecord':
    case 'TotalCaloriesBurnedRecord':
      value = data.energyInKilocalories as number
      break
    case 'BasalMetabolicRateRecord':
      value = data.basalMetabolicRateInKcalPerDay as number
      break
    case 'OxygenSaturationRecord':
      value = data.percentage as number
      break
    case 'RespiratoryRateRecord':
      value = data.rate as number
      break
    case 'BodyTemperatureRecord':
    case 'BasalBodyTemperatureRecord':
      value = data.temperatureInCelsius as number
      break
    case 'BloodGlucoseRecord':
      value = data.levelInMmolPerL as number
      break
    case 'Vo2MaxRecord':
      value = data.vo2MillilitersPerMinuteKilogram as number
      break
    case 'RestingHeartRateRecord':
      value = data.beatsPerMinute as number
      break
    case 'HeartRateVariabilityRmssdRecord':
      // Accept both field names for backwards compatibility with stored raw_records
      value = (data.heartRateVariabilityMillis ?? data.hrvInMilliseconds) as number
      break
    default:
      return []
  }

  if (value === undefined) return []

  return [
    {
      metric,
      source: 'health_connect' as DataSource,
      time: new Date(time as string),
      value,
    },
  ]
}

// ============================================================================
// Daily Aggregates (Deduplicated cumulative metrics from Health Connect)
// ============================================================================

export interface DailyAggregate {
  date: string // "2024-01-15"
  metric: string // "steps", "distance", etc.
  value: number
  dataOrigins: string[] // Contributing app package names
}

/**
 * Process a daily aggregate from Health Connect.
 * Stores deduplicated daily totals for cumulative metrics.
 */
export const processDailyAggregate = async (user: string, aggregate: DailyAggregate) => {
  if (!isValidMetric(aggregate.metric)) {
    console.warn(`Invalid metric in daily aggregate: ${aggregate.metric}`)
    return
  }

  const metric = aggregate.metric as MetricType
  if (!cumulativeMetrics.includes(metric)) {
    console.warn(`Metric ${metric} is not a cumulative metric, skipping aggregate`)
    return
  }

  // Parse the date and set to midnight UTC
  const time = new Date(aggregate.date)
  time.setUTCHours(0, 0, 0, 0)

  await query(
    user,
    `INSERT INTO time_series (time, metric, value, unit, source)
     VALUES ($1, $2, $3, $4, 'health_connect_aggregate')
     ON CONFLICT (time, metric, source) DO UPDATE SET value = EXCLUDED.value`,
    [time, metric, aggregate.value, metricUnits[metric]],
  )
}

/**
 * Get the aggregate value for a cumulative metric on a specific day.
 * Returns null if no aggregate exists.
 */
export const getDailyAggregateValue = async (
  user: string,
  metric: MetricType,
  date: Date,
): Promise<number | null> => {
  const start = new Date(date)
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(date)
  end.setUTCHours(23, 59, 59, 999)

  const result = await query(
    user,
    `SELECT value FROM time_series
     WHERE metric = $1 AND source = 'health_connect_aggregate'
     AND time >= $2 AND time < $3
     LIMIT 1`,
    [metric, start, end],
  )

  if (result.rows.length === 0) return null
  return result.rows[0].value
}

// ============================================================================
// User Settings
// ============================================================================

export interface UserSettings {
  birthDate?: string // YYYY-MM-DD
  hrZoneStart?: { 1: number; 2: number; 3: number; 4: number; 5: number }
  rescueTimeKey?: string // RescueTime API key (personal token)
}

/**
 * Get user settings from the database.
 * Returns null if no settings exist.
 */
export const getUserSettings = async (user: string): Promise<UserSettings | null> => {
  const result = await query(user, `SELECT settings FROM user_settings LIMIT 1`)

  if (result.rows.length === 0) return null

  const settings = result.rows[0].settings as Record<string, unknown>
  return {
    birthDate: settings.birthDate as string | undefined,
    hrZoneStart: settings.hrZoneStart as UserSettings['hrZoneStart'],
    rescueTimeKey: settings.rescueTimeKey as string | undefined,
  }
}

/**
 * Upsert user settings (creates or updates).
 * Merges the provided updates with existing settings.
 */
export const upsertUserSettings = async (
  user: string,
  updates: Partial<UserSettings>,
): Promise<UserSettings> => {
  // Get existing settings
  const existing = (await getUserSettings(user)) ?? {}

  // Merge updates
  const merged: UserSettings = { ...existing }
  if (updates.birthDate !== undefined) {
    merged.birthDate = updates.birthDate
  }
  if (updates.hrZoneStart !== undefined) {
    merged.hrZoneStart = updates.hrZoneStart
  }
  if (updates.rescueTimeKey !== undefined) {
    merged.rescueTimeKey = updates.rescueTimeKey
  }

  // Check if settings row exists
  const existingRow = await query(user, `SELECT id FROM user_settings LIMIT 1`)

  if (existingRow.rows.length === 0) {
    // Insert new row
    await query(user, `INSERT INTO user_settings (settings) VALUES ($1)`, [merged])
  } else {
    // Update existing row
    await query(user, `UPDATE user_settings SET settings = $1, updated_at = NOW()`, [merged])
  }

  return merged
}

// ============================================================================
// MCP Sessions (persist sessions across backend restarts)
// ============================================================================

export interface McpSessionRecord {
  sessionId: string
  username: string
  createdAt: Date
  lastActivity: Date
}

/**
 * Save an MCP session to the database.
 */
export const saveMcpSession = async (user: string, sessionId: string): Promise<McpSessionRecord> => {
  const result = await query(
    user,
    `INSERT INTO mcp_sessions (session_id, username, created_at, last_activity)
     VALUES ($1, $2, NOW(), NOW())
     ON CONFLICT (session_id) DO UPDATE SET last_activity = NOW()
     RETURNING session_id, username, created_at, last_activity`,
    [sessionId, user],
  )

  const row = result.rows[0]
  return {
    createdAt: new Date(row.created_at),
    lastActivity: new Date(row.last_activity),
    sessionId: row.session_id,
    username: row.username,
  }
}

/**
 * Get an MCP session by ID.
 */
export const getMcpSession = async (user: string, sessionId: string): Promise<McpSessionRecord | null> => {
  const result = await query(
    user,
    `SELECT session_id, username, created_at, last_activity
     FROM mcp_sessions
     WHERE session_id = $1`,
    [sessionId],
  )

  if (result.rows.length === 0) return null

  const row = result.rows[0]
  return {
    createdAt: new Date(row.created_at),
    lastActivity: new Date(row.last_activity),
    sessionId: row.session_id,
    username: row.username,
  }
}

/**
 * Update the last_activity timestamp for a session.
 */
export const touchMcpSession = async (user: string, sessionId: string): Promise<void> => {
  await query(user, `UPDATE mcp_sessions SET last_activity = NOW() WHERE session_id = $1`, [sessionId])
}

/**
 * Delete an MCP session.
 */
export const deleteMcpSession = async (user: string, sessionId: string): Promise<boolean> => {
  const result = await query(user, `DELETE FROM mcp_sessions WHERE session_id = $1`, [sessionId])
  return (result.rowCount ?? 0) > 0
}

/**
 * Delete MCP sessions that have been inactive for longer than the specified duration.
 * @param maxInactivityMs Maximum inactivity time in milliseconds (default: 7 days)
 */
export const deleteExpiredMcpSessions = async (
  user: string,
  maxInactivityMs: number = 7 * 24 * 60 * 60 * 1000,
): Promise<string[]> => {
  const cutoff = new Date(Date.now() - maxInactivityMs)

  const result = await query(
    user,
    `DELETE FROM mcp_sessions
     WHERE last_activity < $1
     RETURNING session_id`,
    [cutoff],
  )

  return result.rows.map((row) => row.session_id)
}

/**
 * Get all active MCP sessions for a user.
 */
export const getMcpSessionsForUser = async (user: string): Promise<McpSessionRecord[]> => {
  const result = await query(
    user,
    `SELECT session_id, username, created_at, last_activity
     FROM mcp_sessions
     WHERE username = $1
     ORDER BY last_activity DESC`,
    [user],
  )

  return result.rows.map((row) => ({
    createdAt: new Date(row.created_at),
    lastActivity: new Date(row.last_activity),
    sessionId: row.session_id,
    username: row.username,
  }))
}
