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
  insertTimeSeries,
  type TimeSeriesPoint,
  upsertOAuthToken,
} from './db/index.ts'
import {
  type DataSource,
  healthConnectActivityMapping,
  healthConnectMetricMapping,
  type MetricType,
} from './schema.ts'

const userDbName = (user: string) => `aurboda_${user}`

async function tableExists(db: Client, tableName: string): Promise<boolean> {
  const result = await db.query(`SELECT 1 FROM information_schema.tables WHERE table_name = $1`, [tableName])
  return result.rowCount !== 0
}

async function migrateHcData(db: Client, user: string) {
  if (!(await tableExists(db, 'hcdata'))) {
    console.info('  No hcdata table found, skipping.')
    return
  }

  const result = await db.query(`SELECT * FROM hcdata ORDER BY COALESCE(time, "startTime")`)
  console.info(`  Found ${result.rowCount} hcdata records`)

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
      external_id: externalId,
      record_type: recordType,
      recorded_at: recordedAt,
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

    // Normalize to activities if applicable. Notes are no longer kept on the
    // activities row; HC's notes get persisted via upsertSyncedNote during
    // live ingest (this one-shot legacy migration skips them — they'll be
    // backfilled if the source HC payload still includes them).
    const activityType = healthConnectActivityMapping[recordType]
    if (activityType) {
      await insertActivity(user, {
        activity_type: activityType,
        data: fullData,
        end_time: row.endTime ? new Date(row.endTime) : undefined,
        source: 'health_connect',
        start_time: new Date(row.startTime),
        title: row.data.title,
      })
    }
  }

  console.info(`  Migrated ${result.rowCount} hcdata records`)
}

// eslint-disable-next-line complexity -- TODO: refactor
function extractTimeSeriesPoints(
  recordType: string,
  metric: MetricType,
  data: Record<string, unknown>,
): TimeSeriesPoint[] {
  // Records with samples (HeartRateRecord, SpeedRecord, PowerRecord, etc.)
  if (data.samples && Array.isArray(data.samples)) {
    const sampleValueField: Record<string, string> = {
      HeartRateRecord: 'beatsPerMinute',
      SpeedRecord: 'speedInMetersPerSecond',
      PowerRecord: 'powerInWatts',
    }
    const field = sampleValueField[recordType]
    if (!field) return []

    return (data.samples as { time: string; [key: string]: unknown }[]).map((sample) => ({
      metric,
      source: 'health_connect' as DataSource,
      time: new Date(sample.time),
      value: (sample[field] as number) || 0,
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
    console.info('  No heartrates table found, skipping.')
    return
  }

  const result = await db.query(`SELECT time, bpm, source FROM heartrates ORDER BY time`)
  console.info(`  Found ${result.rowCount} heartrate records`)

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

  console.info(`  Migrated ${result.rowCount} heartrate records`)
}

async function migrateOwntracks(db: Client, user: string) {
  if (!(await tableExists(db, 'owntracks'))) {
    console.info('  No owntracks table found, skipping.')
    return
  }

  const result = await db.query(`
    SELECT id, tst, ST_X(location::geometry) AS lon, ST_Y(location::geometry) AS lat, inregions
    FROM owntracks ORDER BY tst
  `)
  console.info(`  Found ${result.rowCount} owntracks location records`)

  for (const row of result.rows) {
    await insertLocation(user, {
      lat: row.lat,
      lon: row.lon,
      regions: row.inregions,
      source: 'owntracks',
      time: new Date(row.tst),
    })
  }

  console.info(`  Migrated ${result.rowCount} location records`)
}

async function migrateWaypoints(db: Client, user: string) {
  if (!(await tableExists(db, 'waypoints'))) {
    console.info('  No waypoints table found, skipping.')
    return
  }

  const result = await db.query(`
    SELECT id, name, tst, ST_X(location::geometry) AS lon, ST_Y(location::geometry) AS lat, rad, rid
    FROM waypoints
  `)
  console.info(`  Found ${result.rowCount} waypoint records`)

  for (const row of result.rows) {
    await insertPlace(user, {
      external_id: row.rid || row.id,
      lat: row.lat,
      lon: row.lon,
      name: row.name,
      radius: row.rad,
      source: 'owntracks',
    })
  }

  console.info(`  Migrated ${result.rowCount} waypoint records`)
}

async function migrateOuraAuth(db: Client, user: string) {
  if (!(await tableExists(db, 'ouraauth'))) {
    console.info('  No ouraauth table found, skipping.')
    return
  }

  const result = await db.query(`SELECT * FROM ouraauth ORDER BY time DESC LIMIT 1`)
  if (result.rowCount === 0) {
    console.info('  No ouraauth records found, skipping.')
    return
  }

  const row = result.rows[0]
  await upsertOAuthToken(user, {
    access_token: row.access_token,
    expires_at: addSeconds(new Date(row.time), row.expires_in),
    provider: 'oura',
    refresh_token: row.refresh_token,
  })

  console.info(`  Migrated Oura OAuth token`)
}

async function migrateTags(db: Client, user: string) {
  if (!(await tableExists(db, 'tags'))) {
    console.info('  No tags table found, skipping.')
    return
  }

  const result = await db.query(`SELECT id, tag, start_time, end_time, source FROM tags ORDER BY start_time`)
  console.info(`  Found ${result.rowCount} tag records`)

  for (const row of result.rows) {
    await insertActivity(user, {
      activity_type: row.tag.toLowerCase().replaceAll(/\s+/g, '_'),
      end_time: row.end_time ? new Date(row.end_time) : undefined,
      external_id: row.id,
      source: (row.source || 'oura') as DataSource,
      start_time: new Date(row.start_time),
    })
  }

  console.info(`  Migrated ${result.rowCount} tag records`)
}

async function main() {
  const username = process.argv[2]

  if (!username) {
    console.error('Usage: pnpm migrate <username>')
    process.exit(1)
  }

  console.info(`Migrating data for user: ${username}`)

  const database = userDbName(username)
  const db = new Client({ database })

  try {
    await db.connect()
    console.info(`Connected to database: ${database}`)

    // Ensure PostGIS extension exists (requires superuser to create)
    console.info('\n1. Checking PostGIS extension...')
    const extResult = await db.query(`SELECT 1 FROM pg_extension WHERE extname = 'postgis'`)
    if (extResult.rowCount === 0) {
      console.error('   PostGIS extension not installed. Run as superuser:')
      console.error(`   sudo -u postgres psql ${database} -c "CREATE EXTENSION postgis"`)
      process.exit(1)
    }
    console.info('   PostGIS ready.')

    // Initialize new schema
    console.info('\n2. Initializing new schema...')
    await initializeSchema(username)
    console.info('   Schema initialized.')

    // Migrate each table
    console.info('\n3. Migrating hcdata...')
    await migrateHcData(db, username)

    console.info('\n4. Migrating heartrates...')
    await migrateHeartrates(db, username)

    console.info('\n5. Migrating owntracks locations...')
    await migrateOwntracks(db, username)

    console.info('\n6. Migrating waypoints...')
    await migrateWaypoints(db, username)

    console.info('\n7. Migrating Oura OAuth...')
    await migrateOuraAuth(db, username)

    console.info('\n8. Migrating tags...')
    await migrateTags(db, username)

    console.info('\n✓ Migration complete!')
    console.info('\nYou can verify by checking the new tables:')
    console.info(`  psql ${database} -c "SELECT COUNT(*) FROM raw_records"`)
    console.info(`  psql ${database} -c "SELECT metric, COUNT(*) FROM time_series GROUP BY metric"`)
    console.info(
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
