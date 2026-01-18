import { Client, QueryResultRow } from 'pg'
import format from 'pg-format'
import {
  ActivityType,
  createTableStatements,
  DataSource,
  healthConnectActivityMapping,
  healthConnectMetricMapping,
  MetricType,
  metricUnits,
  tableCreationOrder,
} from './schema'

const dbByUser: Record<string, Client> = {}

const userDbName = (user: string) => `nephelai_${user}`

export const query = async <T extends QueryResultRow = QueryResultRow>(
  dbOrUser: Client | string,
  queryStr: string,
  params?: unknown[],
) => {
  const db = typeof dbOrUser === 'string' ? await getDbForUser(dbOrUser) : dbOrUser
  console.log(`>>>`, queryStr, params)
  const result = await db.query<T>(queryStr, params)
  return result
}

export const loginToUserDb = async (user: string, password: string) => {
  const database = userDbName(user)
  dbByUser[user] = new Client({ database, password, user })
  await dbByUser[user].connect()
}

export const makeNewUserDb = async (userDb: Client, user: string, password: string) => {
  const database = userDbName(user)
  console.log(`New user ${user}`)
  await query(userDb, format('CREATE USER %I WITH ENCRYPTED PASSWORD %L', user, password))
  await query(userDb, format('GRANT %I TO %I', user, process.env.PGUSER))
  await query(userDb, format('CREATE DATABASE %I OWNER %I', database, user))
  dbByUser[user] = new Client({ database, password, user })
  await dbByUser[user].connect()
  await initializeSchema(user)
}

export const getDbForUser = async (user: string) => {
  if (dbByUser[user]) return dbByUser[user]
  dbByUser[user] = new Client({ database: userDbName(user) })
  await dbByUser[user].connect()
  await query(dbByUser[user], format('SET ROLE %L', user))
  return dbByUser[user]
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

  const values = points.map((p) => [p.time, p.metric, p.value, metricUnits[p.metric], p.source])

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
    id: row.id,
    source: row.source,
    activityType: row.activity_type,
    startTime: new Date(row.start_time),
    endTime: row.end_time ? new Date(row.end_time) : undefined,
    title: row.title,
    notes: row.notes,
    data: row.data,
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
    time: new Date(row.time),
    coordinates: JSON.parse(row.location).coordinates as [number, number],
    regions: row.regions,
  }))

  // Aggregate consecutive same-region visits into places
  const places = locations.reduce<{ region: string; startTime: Date; endTime: Date }[]>(
    (acc, loc) => {
      const region = loc.regions?.[0] || 'Somewhere'

      if (acc.length > 0 && acc[acc.length - 1].region === region) {
        acc[acc.length - 1].endTime = loc.time
        return acc
      }

      return [...acc, { region, startTime: loc.time, endTime: loc.time }]
    },
    [],
  )

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
    id: row.id,
    source: row.source,
    externalId: row.external_id,
    tag: row.tag,
    startTime: new Date(row.start_time),
    endTime: row.end_time ? new Date(row.end_time) : undefined,
  }))
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
    source: row.source,
    startTime: new Date(row.start_time),
    endTime: new Date(row.end_time),
    activity: row.activity,
    category: row.category,
    productivity: row.productivity,
    durationSec: row.duration_sec,
    isMobile: row.is_mobile,
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
    id: row.id,
    testDate: new Date(row.test_date),
    testName: row.test_name,
    testCategory: row.test_category,
    value: row.value,
    unit: row.unit,
    referenceLow: row.reference_low,
    referenceHigh: row.reference_high,
    flag: row.flag,
    labName: row.lab_name,
    notes: row.notes,
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
    provider: row.provider,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
    scopes: row.scopes,
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
    source: 'health_connect',
    recordType,
    externalId,
    recordedAt: new Date((data.startTime || data.time) as string),
    data,
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
        time,
        metric: 'blood_pressure_systolic',
        value: data.systolicInMmHg as number,
        source: 'health_connect',
      },
      {
        time,
        metric: 'blood_pressure_diastolic',
        value: data.diastolicInMmHg as number,
        source: 'health_connect',
      },
    ])
  }

  // Normalize to activities if applicable
  const activityType = healthConnectActivityMapping[recordType]
  if (activityType) {
    await insertActivity(user, {
      source: 'health_connect',
      activityType,
      startTime: new Date(data.startTime as string),
      endTime: data.endTime ? new Date(data.endTime as string) : undefined,
      title: data.title as string | undefined,
      notes: data.notes as string | undefined,
      data,
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
      time: new Date(sample.time),
      metric,
      value: sample.beatsPerMinute || 0,
      source: 'health_connect' as DataSource,
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
      value = data.hrvInMilliseconds as number
      break
    default:
      return []
  }

  if (value === undefined) return []

  return [
    {
      time: new Date(time as string),
      metric,
      value,
      source: 'health_connect' as DataSource,
    },
  ]
}
