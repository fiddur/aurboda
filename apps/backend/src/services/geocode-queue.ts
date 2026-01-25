/**
 * Geocoding job queue using pg-boss.
 *
 * Uses a shared PostgreSQL database for cross-instance job coordination.
 * Enforces 1.1s delay between jobs to respect Nominatim rate limits.
 */

import pg from 'pg'
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

// ============================================================================
// Configuration
// ============================================================================

const QUEUE_NAME = 'geocode-location'
const RATE_LIMIT_DELAY_MS = 1100 // 1.1 seconds between requests (Nominatim rate limit)
const DEFAULT_GEOCODE_DB = 'aurboda'

/**
 * Sleep for a specified duration.
 */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// ============================================================================
// Queue Instance
// ============================================================================

// pg-boss instance - typed as InstanceType of the PgBoss class
let boss: InstanceType<typeof PgBossModule.PgBoss> | null = null

/**
 * Get database connection parameters from environment.
 */
const getDbParams = () => ({
  database: process.env.GEOCODE_DB || DEFAULT_GEOCODE_DB,
  host: process.env.PGHOST || 'localhost',
  password: process.env.PGPASSWORD,
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER,
})

/**
 * Build connection string from environment variables.
 * Uses GEOCODE_DB for database name (defaults to 'aurboda'), with PGHOST, PGPORT, PGUSER, PGPASSWORD.
 */
const buildConnectionString = (database?: string): string | null => {
  const params = getDbParams()
  const db = database || params.database

  if (!params.user || !params.password) {
    console.warn('PGUSER/PGPASSWORD not set, geocoding queue disabled')
    return null
  }

  return `postgresql://${params.user}:${params.password}@${params.host}:${params.port}/${db}`
}

/**
 * Ensure the geocode database exists, creating it if necessary.
 */
const ensureDatabase = async (): Promise<boolean> => {
  const params = getDbParams()

  // First, try connecting directly to the target database (it might already exist)
  // Use minimal config - pg picks up PGUSER, PGPASSWORD, PGHOST, PGPORT from env
  const targetClient = new pg.Client({ database: params.database })

  try {
    await targetClient.connect()
    await targetClient.end()
    // Database exists and is accessible
    return true
  } catch {
    // Database doesn't exist or isn't accessible, try to create it
    await targetClient.end().catch(() => {})
  }

  // Connect to postgres database to create the target database
  // Use same pattern as api.ts - let pg pick up connection params from env
  const postgresClient = new pg.Client({ database: 'postgres' })

  try {
    await postgresClient.connect()

    // Create the database
    // Note: database names can't be parameterized, but we control GEOCODE_DB
    await postgresClient.query(`CREATE DATABASE "${params.database}"`)
    console.log(`Created geocode database: ${params.database}`)

    return true
  } catch (error) {
    console.error(`Failed to create geocode database '${params.database}':`, error)
    return false
  } finally {
    await postgresClient.end()
  }
}

/**
 * Initialize the geocode queue.
 * Creates the database if it doesn't exist.
 * Returns null if PGUSER/PGPASSWORD are not configured.
 */
export const initGeocodeQueue = async (): Promise<InstanceType<typeof PgBossModule.PgBoss> | null> => {
  // Ensure database exists before connecting
  const dbReady = await ensureDatabase()
  if (!dbReady) {
    // Specific error already logged by ensureDatabase
    return null
  }

  const connectionString = buildConnectionString()
  if (!connectionString) {
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
  console.log(`Geocode queue started (database: ${getDbParams().database})`)

  // Register the job handler
  // batchSize: 1 ensures only one job processes at a time across all instances
  await boss.work(QUEUE_NAME, { batchSize: 1, pollingIntervalSeconds: 2 }, handleGeocodeJob)

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
export const getGeocodeQueue = (): InstanceType<typeof PgBossModule.PgBoss> | null => boss

// ============================================================================
// Job Management
// ============================================================================

/**
 * Add a geocoding job to the queue.
 * Jobs are processed with a 1.1s delay to respect Nominatim rate limits.
 */
export const enqueueGeocodeJob = async (data: GeocodeJobData): Promise<string | null> => {
  if (!boss) {
    // Queue not available - location stays in 'pending' status for future retry
    console.warn('Geocode queue not initialized, skipping job')
    return null
  }

  try {
    const jobId = await boss.send(QUEUE_NAME, data, {
      retryBackoff: true,
      retryDelay: 60, // 60 seconds between retries
      retryLimit: 3,
    })

    // Only mark as 'geocoding' after job is successfully enqueued
    await updateDetectedLocation(data.user, data.detectedLocationId, {
      geocodeStatus: 'geocoding',
    })

    console.log(`Enqueued geocode job ${jobId} for location ${data.detectedLocationId}`)
    return jobId
  } catch (error) {
    // Enqueue failed - location stays in 'pending' status for future retry
    console.error(`Failed to enqueue geocode job for ${data.detectedLocationId}:`, error)
    return null
  }
}

/**
 * Handle a geocoding job.
 * Fetches address from Nominatim and updates the detected location.
 * Enforces rate limiting by waiting after each request.
 */
const handleGeocodeJob = async (jobs: PgBossModule.Job<GeocodeJobData>[]): Promise<void> => {
  // Process jobs sequentially with rate limiting
  for (const job of jobs) {
    const { detectedLocationId, lat, lon, user } = job.data

    console.log(`Processing geocode job for location ${detectedLocationId} at ${lat}, ${lon}`)

    const result = await reverseGeocode(lat, lon)

    // Rate limit: wait before allowing next request
    // This ensures we respect Nominatim's 1 request/second limit
    await sleep(RATE_LIMIT_DELAY_MS)

    if (result.success) {
      await updateDetectedLocation(user, detectedLocationId, {
        address: result.data.address,
        geocodeStatus: 'success',
      })
      console.log(`Geocoded location ${detectedLocationId}: ${result.data.address}`)
    } else {
      // Handle different error types
      const { error } = result
      if (error.type === 'network') {
        // Network error - retry by throwing
        console.error(`Network error geocoding ${detectedLocationId}: ${error.message}`)
        throw new Error(`Network error: ${error.message}`)
      } else if (error.type === 'http') {
        // HTTP error - retry for server errors (5xx), fail for client errors
        if (error.status >= 500) {
          console.error(`Server error geocoding ${detectedLocationId}: ${error.status}`)
          throw new Error(`HTTP ${error.status}: ${error.statusText}`)
        }
        // Client error (4xx) - don't retry
        console.warn(`HTTP ${error.status} for location ${detectedLocationId}, marking failed`)
        await updateDetectedLocation(user, detectedLocationId, {
          geocodeStatus: 'failed',
        })
      } else {
        // No results - valid response but location has no address
        console.warn(`No address found for location ${detectedLocationId}`)
        await updateDetectedLocation(user, detectedLocationId, {
          geocodeStatus: 'failed',
        })
      }
    }
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
