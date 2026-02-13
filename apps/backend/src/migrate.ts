/**
 * Migration script: Migrate from old schema to new schema.
 *
 * Old tables:
 * - hcdata: Health Connect data (id, recordType, metadata, app, time, startTime, endTime, data)
 * - owntracks: Location data (id, tst, location, inregions)
 * - waypoints: Place/geofence data (id, name, tst, location, rad, rid)
 * - ouraauth: OAuth tokens (access_token, refresh_token, expires_in, time)
 * - tags: Activity tags (id, tag, startTime, endTime, source)
 * - heartrates: Heart rate data (time, bpm, source)
 *
 * New tables:
 * - raw_records, time_series, activities, locations, places, tags, oauth_tokens, etc.
 *
 * Usage:
 *   pnpm migrate <username>
 */

import { addSeconds } from 'date-fns'
import { Client } from 'pg'
import {
  initializeSchema,
  insertActivity,
  insertLocation,
  insertPlace,
  insertRawRecord,
  insertTag,
  insertTimeSeries,
  TimeSeriesPoint,
  upsertOAuthToken,
} from './db'
import { DataSource, healthConnectActivityMapping, healthConnectMetricMapping, MetricType } from './schema'

const userDbName = (user: string) => `aurboda_${user}`

async function tableExists(db: Client, tableName: string): Promise<boolean> {
  const result = await db.query(`SELECT 1 FROM information_schema.tables WHERE table_name = $1`, [tableName])
  return result.rowCount !== 0
}

async function migrateHcData(db: Client, user: string) {
  if (!(await tableExists(db, 'hcdata'))) {
    console.log('  No hcdata table found, skipping.')
    return
  }

  const result = await db.query(`SELECT * FROM hcdata ORDER BY COALESCE(time, "startTime")`)
  console.log(`  Found ${result.rowCount} hcdata records`)

  for (const row of result.rows) {
    const recordType = row.recordType
    const externalId = row.id
    const recordedAt = new Date(row.time || row.startTime)
    const fullData = {
      ...row.data,
      endTime: row.endTime,
      metadata: row.metadata,
      startTime: row.startTime,
      time: row.time,
    }

    // Insert into raw_records
    await insertRawRecord(user, {
      data: fullData,
      externalId,
      recordType,
      recordedAt,
      source: 'health_connect',
    })

    // Normalize to time_series if applicable
    const metric = healthConnectMetricMapping[recordType]
    if (metric) {
      const points = extractTimeSeriesPoints(recordType, metric, fullData)
      if (points.length > 0) {
        await insertTimeSeries(user, points)
      }
    }

    // Handle blood pressure specially
    if (recordType === 'BloodPressureRecord') {
      const time = new Date(row.time || row.startTime)
      await insertTimeSeries(user, [
        { metric: 'blood_pressure_systolic', source: 'health_connect', time, value: row.data.systolicInMmHg },
        {
          metric: 'blood_pressure_diastolic',
          source: 'health_connect',
          time,
          value: row.data.diastolicInMmHg,
        },
      ])
    }

    // Normalize to activities if applicable
    const activityType = healthConnectActivityMapping[recordType]
    if (activityType) {
      await insertActivity(user, {
        activityType,
        data: fullData,
        endTime: row.endTime ? new Date(row.endTime) : undefined,
        notes: row.data.notes,
        source: 'health_connect',
        startTime: new Date(row.startTime),
        title: row.data.title,
      })
    }
  }

  console.log(`  Migrated ${result.rowCount} hcdata records`)
}

// eslint-disable-next-line max-lines-per-function, complexity -- TODO: refactor
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

async function migrateHeartrates(db: Client, user: string) {
  if (!(await tableExists(db, 'heartrates'))) {
    console.log('  No heartrates table found, skipping.')
    return
  }

  const result = await db.query(`SELECT time, bpm, source FROM heartrates ORDER BY time`)
  console.log(`  Found ${result.rowCount} heartrate records`)

  if (result.rowCount === 0) return

  const points: TimeSeriesPoint[] = result.rows.map((row) => ({
    metric: 'heart_rate' as MetricType,
    source: (row.source || 'health_connect') as DataSource,
    time: new Date(row.time),
    value: row.bpm,
  }))

  // Insert in batches of 1000
  const batchSize = 1000
  for (let i = 0; i < points.length; i += batchSize) {
    const batch = points.slice(i, i + batchSize)
    await insertTimeSeries(user, batch)
  }

  console.log(`  Migrated ${result.rowCount} heartrate records`)
}

async function migrateOwntracks(db: Client, user: string) {
  if (!(await tableExists(db, 'owntracks'))) {
    console.log('  No owntracks table found, skipping.')
    return
  }

  const result = await db.query(`
    SELECT id, tst, ST_X(location::geometry) AS lon, ST_Y(location::geometry) AS lat, inregions
    FROM owntracks ORDER BY tst
  `)
  console.log(`  Found ${result.rowCount} owntracks location records`)

  for (const row of result.rows) {
    await insertLocation(user, {
      lat: row.lat,
      lon: row.lon,
      regions: row.inregions,
      source: 'owntracks',
      time: new Date(row.tst),
    })
  }

  console.log(`  Migrated ${result.rowCount} location records`)
}

async function migrateWaypoints(db: Client, user: string) {
  if (!(await tableExists(db, 'waypoints'))) {
    console.log('  No waypoints table found, skipping.')
    return
  }

  const result = await db.query(`
    SELECT id, name, tst, ST_X(location::geometry) AS lon, ST_Y(location::geometry) AS lat, rad, rid
    FROM waypoints
  `)
  console.log(`  Found ${result.rowCount} waypoint records`)

  for (const row of result.rows) {
    await insertPlace(user, {
      externalId: row.rid || row.id,
      lat: row.lat,
      lon: row.lon,
      name: row.name,
      radius: row.rad,
      source: 'owntracks',
    })
  }

  console.log(`  Migrated ${result.rowCount} waypoint records`)
}

async function migrateOuraAuth(db: Client, user: string) {
  if (!(await tableExists(db, 'ouraauth'))) {
    console.log('  No ouraauth table found, skipping.')
    return
  }

  const result = await db.query(`SELECT * FROM ouraauth ORDER BY time DESC LIMIT 1`)
  if (result.rowCount === 0) {
    console.log('  No ouraauth records found, skipping.')
    return
  }

  const row = result.rows[0]
  await upsertOAuthToken(user, {
    accessToken: row.access_token,
    expiresAt: addSeconds(new Date(row.time), row.expires_in),
    provider: 'oura',
    refreshToken: row.refresh_token,
  })

  console.log(`  Migrated Oura OAuth token`)
}

async function migrateTags(db: Client, user: string) {
  if (!(await tableExists(db, 'tags'))) {
    console.log('  No tags table found, skipping.')
    return
  }

  const result = await db.query(`SELECT id, tag, start_time, end_time, source FROM tags ORDER BY start_time`)
  console.log(`  Found ${result.rowCount} tag records`)

  for (const row of result.rows) {
    await insertTag(user, {
      endTime: row.end_time ? new Date(row.end_time) : undefined,
      externalId: row.id,
      source: (row.source || 'oura') as DataSource,
      startTime: new Date(row.start_time),
      tag: row.tag,
    })
  }

  console.log(`  Migrated ${result.rowCount} tag records`)
}

async function main() {
  const username = process.argv[2]

  if (!username) {
    console.error('Usage: pnpm migrate <username>')
    process.exit(1)
  }

  console.log(`Migrating data for user: ${username}`)

  const database = userDbName(username)
  const db = new Client({ database })

  try {
    await db.connect()
    console.log(`Connected to database: ${database}`)

    // Ensure PostGIS extension exists (requires superuser to create)
    console.log('\n1. Checking PostGIS extension...')
    const extResult = await db.query(`SELECT 1 FROM pg_extension WHERE extname = 'postgis'`)
    if (extResult.rowCount === 0) {
      console.error('   PostGIS extension not installed. Run as superuser:')
      console.error(`   sudo -u postgres psql ${database} -c "CREATE EXTENSION postgis"`)
      process.exit(1)
    }
    console.log('   PostGIS ready.')

    // Initialize new schema
    console.log('\n2. Initializing new schema...')
    await initializeSchema(username)
    console.log('   Schema initialized.')

    // Migrate each table
    console.log('\n3. Migrating hcdata...')
    await migrateHcData(db, username)

    console.log('\n4. Migrating heartrates...')
    await migrateHeartrates(db, username)

    console.log('\n5. Migrating owntracks locations...')
    await migrateOwntracks(db, username)

    console.log('\n6. Migrating waypoints...')
    await migrateWaypoints(db, username)

    console.log('\n7. Migrating Oura OAuth...')
    await migrateOuraAuth(db, username)

    console.log('\n8. Migrating tags...')
    await migrateTags(db, username)

    console.log('\n✓ Migration complete!')
    console.log('\nYou can verify by checking the new tables:')
    console.log(`  psql ${database} -c "SELECT COUNT(*) FROM raw_records"`)
    console.log(`  psql ${database} -c "SELECT metric, COUNT(*) FROM time_series GROUP BY metric"`)
    console.log(
      `  psql ${database} -c "SELECT activity_type, COUNT(*) FROM activities GROUP BY activity_type"`,
    )
  } catch (err) {
    console.error('Migration failed:', err)
    process.exit(1)
  } finally {
    await db.end()
  }
}

main()
