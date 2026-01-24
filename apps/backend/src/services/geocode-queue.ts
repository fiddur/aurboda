/**
 * Geocoding job queue using pg-boss.
 *
 * Uses a shared PostgreSQL database for cross-instance job coordination.
 * Enforces 1.1s delay between jobs to respect Nominatim rate limits.
 */

import * as PgBossModule from 'pg-boss'
import { updateDetectedLocation } from '../db'
import { reverseGeocode } from './geocoding'

// ============================================================================
// Types
// ============================================================================

export interface GeocodeJobData {
  user: string
  detectedLocationId: string
  lat: number
  lon: number
}

interface GeocodeJob {
  data: GeocodeJobData
}

// ============================================================================
// Configuration
// ============================================================================

const QUEUE_NAME = 'geocode-location'
const JOB_DELAY_MS = 1100 // 1.1 seconds between jobs (Nominatim rate limit)

// ============================================================================
// Queue Instance
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let boss: any = null

/**
 * Build connection string from environment variables.
 * Uses GEOCODE_DB for database name, with PGHOST, PGPORT, PGUSER, PGPASSWORD.
 */
const buildConnectionString = (): string | null => {
  const db = process.env.GEOCODE_DB
  if (!db) return null

  const host = process.env.PGHOST || 'localhost'
  const port = process.env.PGPORT || '5432'
  const user = process.env.PGUSER
  const password = process.env.PGPASSWORD

  if (!user || !password) {
    console.warn('GEOCODE_DB set but PGUSER/PGPASSWORD missing')
    return null
  }

  return `postgresql://${user}:${password}@${host}:${port}/${db}`
}

/**
 * Initialize the geocode queue.
 * Returns null if GEOCODE_DB is not configured.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const initGeocodeQueue = async (): Promise<any> => {
  const connectionString = buildConnectionString()
  if (!connectionString) {
    console.log('GEOCODE_DB not set, geocoding queue disabled')
    return null
  }

  // pg-boss exports the constructor as PgBoss.PgBoss
  const PgBoss = PgBossModule.PgBoss
  boss = new PgBoss({
    connectionString,
    schema: 'pgboss',
  })

  boss.on('error', (error: Error) => {
    console.error('pg-boss error:', error)
  })

  await boss.start()
  console.log('Geocode queue started')

  // Register the job handler
  await boss.work(QUEUE_NAME, { pollingIntervalSeconds: 2 }, handleGeocodeJob)

  return boss
}

/**
 * Stop the geocode queue gracefully.
 */
export const stopGeocodeQueue = async (): Promise<void> => {
  if (boss) {
    await boss.stop()
    boss = null
    console.log('Geocode queue stopped')
  }
}

/**
 * Get the queue instance.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const getGeocodeQueue = (): any => boss

// ============================================================================
// Job Management
// ============================================================================

/**
 * Add a geocoding job to the queue.
 * Jobs are processed with a 1.1s delay to respect Nominatim rate limits.
 */
export const enqueueGeocodeJob = async (data: GeocodeJobData): Promise<string | null> => {
  if (!boss) {
    console.warn('Geocode queue not initialized, skipping job')
    return null
  }

  // Mark the location as geocoding in progress
  await updateDetectedLocation(data.user, data.detectedLocationId, {
    geocodeStatus: 'geocoding',
  })

  const jobId = await boss.send(QUEUE_NAME, data, {
    retryBackoff: true,
    retryDelay: 60, // 60 seconds between retries
    // Retry with exponential backoff on failure
    retryLimit: 3,
    // Each job should start at least 1.1s after the previous one
    startAfter: JOB_DELAY_MS,
  })

  console.log(`Enqueued geocode job ${jobId} for location ${data.detectedLocationId}`)
  return jobId
}

/**
 * Handle a geocoding job.
 * Fetches address from Nominatim and updates the detected location.
 */
const handleGeocodeJob = async (job: GeocodeJob): Promise<void> => {
  const { detectedLocationId, lat, lon, user } = job.data

  console.log(`Processing geocode job for location ${detectedLocationId} at ${lat}, ${lon}`)

  try {
    const result = await reverseGeocode(lat, lon)

    if (result) {
      await updateDetectedLocation(user, detectedLocationId, {
        address: result.address,
        geocodeStatus: 'success',
      })
      console.log(`Geocoded location ${detectedLocationId}: ${result.address}`)
    } else {
      await updateDetectedLocation(user, detectedLocationId, {
        geocodeStatus: 'failed',
      })
      console.warn(`Failed to geocode location ${detectedLocationId}`)
    }
  } catch (error) {
    console.error(`Error geocoding location ${detectedLocationId}:`, error)
    await updateDetectedLocation(user, detectedLocationId, {
      geocodeStatus: 'failed',
    })
    throw error // Re-throw to trigger retry
  }
}

/**
 * Enqueue multiple geocoding jobs.
 * Useful after detection runs find new or moved locations.
 */
export const enqueueGeocodeJobs = async (
  user: string,
  locations: Array<{ id: string; lat: number; lon: number }>,
): Promise<void> => {
  for (const loc of locations) {
    await enqueueGeocodeJob({
      detectedLocationId: loc.id,
      lat: loc.lat,
      lon: loc.lon,
      user,
    })
  }
}
