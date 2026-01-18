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

import { Client } from 'pg'
import { addSeconds } from 'date-fns'
import {
  initializeSchema,
  insertRawRecord,
  insertTimeSeries,
  insertActivity,
  insertLocation,
  insertPlace,
  insertTag,
  upsertOAuthToken,
  query,
  TimeSeriesPoint,
} from './db'
import {
  healthConnectMetricMapping,
  healthConnectActivityMapping,
  DataSource,
  MetricType,
} from './schema'

const userDbName = (user: string) => `nephelai_${user}`

async function tableExists(db: Client, tableName: string): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = $1`,
    [tableName],
  )
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
    const fullData = { ...row.data, metadata: row.metadata, time: row.time, startTime: row.startTime, endTime: row.endTime }

    // Insert into raw_records
    await insertRawRecord(user, {
      source: 'health_connect',
      recordType,
      externalId,
      recordedAt,
      data: fullData,
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
        { time, metric: 'blood_pressure_systolic', value: row.data.systolicInMmHg, source: 'health_connect' },
        { time, metric: 'blood_pressure_diastolic', value: row.data.diastolicInMmHg, source: 'health_connect' },
      ])
    }

    // Normalize to activities if applicable
    const activityType = healthConnectActivityMapping[recordType]
    if (activityType) {
      await insertActivity(user, {
        source: 'health_connect',
        activityType,
        startTime: new Date(row.startTime),
        endTime: row.endTime ? new Date(row.endTime) : undefined,
        title: row.data.title,
        notes: row.data.notes,
        data: fullData,
      })
    }
  }

  console.log(`  Migrated ${result.rowCount} hcdata records`)
}

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

async function migrateHeartrates(db: Client, user: string) {
  if (!(await tableExists(db, 'heartrates'))) {
    console.log('  No heartrates table found, skipping.')
    return
  }

  const result = await db.query(`SELECT time, bpm, source FROM heartrates ORDER BY time`)
  console.log(`  Found ${result.rowCount} heartrate records`)

  if (result.rowCount === 0) return

  const points: TimeSeriesPoint[] = result.rows.map((row) => ({
    time: new Date(row.time),
    metric: 'heart_rate' as MetricType,
    value: row.bpm,
    source: (row.source || 'health_connect') as DataSource,
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
      source: 'owntracks',
      time: new Date(row.tst),
      lat: row.lat,
      lon: row.lon,
      regions: row.inregions,
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
      source: 'owntracks',
      externalId: row.rid || row.id,
      name: row.name,
      lat: row.lat,
      lon: row.lon,
      radius: row.rad,
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
    provider: 'oura',
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: addSeconds(new Date(row.time), row.expires_in),
  })

  console.log(`  Migrated Oura OAuth token`)
}

async function migrateTags(db: Client, user: string) {
  if (!(await tableExists(db, 'tags'))) {
    console.log('  No tags table found, skipping.')
    return
  }

  const result = await db.query(`SELECT id, tag, "startTime", "endTime", source FROM tags ORDER BY "startTime"`)
  console.log(`  Found ${result.rowCount} tag records`)

  for (const row of result.rows) {
    await insertTag(user, {
      source: (row.source || 'oura') as DataSource,
      externalId: row.id,
      tag: row.tag,
      startTime: new Date(row.startTime),
      endTime: row.endTime ? new Date(row.endTime) : undefined,
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
    console.log(`  psql ${database} -c "SELECT activity_type, COUNT(*) FROM activities GROUP BY activity_type"`)

  } catch (err) {
    console.error('Migration failed:', err)
    process.exit(1)
  } finally {
    await db.end()
  }
}

main()
