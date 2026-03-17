/**
 * Geocoding job queue using pg-boss.
 *
 * Uses a shared PostgreSQL database for cross-instance job coordination.
 * Enforces 1.1s delay between jobs to respect Nominatim rate limits.
 */

import pg from 'pg'
import * as PgBossModule from 'pg-boss'

import type { DetectedLocationUpdate } from '../db/index.ts'

import { reverseGeocode } from './geocoding.ts'

// ============================================================================
// Types
// ============================================================================

export interface GeocodeJobData {
  user: string
  detectedLocationId: string
  lat: number
  lon: number
}

export interface GeocodeQueueDeps {
  updateDetectedLocation: (user: string, id: string, updates: DetectedLocationUpdate) => Promise<unknown>
}

export interface GeocodeQueue {
  getBoss: () => InstanceType<typeof PgBossModule.PgBoss> | null
  enqueueJob: (data: GeocodeJobData) => Promise<string | null>
  enqueueJobs: (user: string, locations: Array<{ id: string; lat: number; lon: number }>) => Promise<void>
  stop: () => Promise<void>
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
// Database helpers
// ============================================================================

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

// ============================================================================
// Job handler factory
// ============================================================================

/**
 * Create a job handler with the given dependencies.
 */
const createJobHandler = (deps: GeocodeQueueDeps) => {
  return async (jobs: PgBossModule.Job<GeocodeJobData>[]): Promise<void> => {
    // Process jobs sequentially with rate limiting
    for (const job of jobs) {
      const { detectedLocationId, lat, lon, user } = job.data

      console.log(`Processing geocode job for location ${detectedLocationId} at ${lat}, ${lon}`)

      const result = await reverseGeocode(lat, lon)

      // Rate limit: wait before allowing next request
      // This ensures we respect Nominatim's 1 request/second limit
      await sleep(RATE_LIMIT_DELAY_MS)

      if (result.success) {
        await deps.updateDetectedLocation(user, detectedLocationId, {
          address: result.data.address,
          geocode_status: 'success',
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
          await deps.updateDetectedLocation(user, detectedLocationId, {
            geocode_status: 'failed',
          })
        } else {
          // No results - valid response but location has no address
          console.warn(`No address found for location ${detectedLocationId}`)
          await deps.updateDetectedLocation(user, detectedLocationId, {
            geocode_status: 'failed',
          })
        }
      }
    }
  }
}

// ============================================================================
// Queue Factory
// ============================================================================

/**
 * Create a geocode queue instance.
 * Returns an object with queue operations, holding the boss instance internally.
 *
 * @param deps - Dependencies for the queue (updateDetectedLocation function)
 * @returns GeocodeQueue instance or null if initialization fails
 */
export const createGeocodeQueue = async (deps: GeocodeQueueDeps): Promise<GeocodeQueue | null> => {
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
  const boss = new PgBoss({
    connectionString,
    // Limit connection pool size. pg-boss default is 10, but we use 3 to leave
    // room for user database connections (PostgreSQL default max_connections is 100)
    max: 3,
    schema: 'pgboss',
  })

  boss.on('error', (error: Error) => {
    console.error('pg-boss error:', error)
  })

  await boss.start()
  console.log(`Geocode queue started (database: ${getDbParams().database})`)

  // Create the queue if it doesn't exist (required in pg-boss v10+)
  await boss.createQueue(QUEUE_NAME)

  // Register the job handler
  // batchSize: 1 ensures only one job processes at a time across all instances
  await boss.work(QUEUE_NAME, { batchSize: 1, pollingIntervalSeconds: 2 }, createJobHandler(deps))

  // Return the queue interface
  const queue: GeocodeQueue = {
    enqueueJob: async (data: GeocodeJobData): Promise<string | null> => {
      try {
        const jobId = await boss.send(QUEUE_NAME, data, {
          retryBackoff: true,
          retryDelay: 60, // 60 seconds between retries
          retryLimit: 3,
        })

        // Only mark as 'geocoding' after job is successfully enqueued
        await deps.updateDetectedLocation(data.user, data.detectedLocationId, {
          geocode_status: 'geocoding',
        })

        console.log(`Enqueued geocode job ${jobId} for location ${data.detectedLocationId}`)
        return jobId
      } catch (error) {
        // Enqueue failed - location stays in 'pending' status for future retry
        console.error(`Failed to enqueue geocode job for ${data.detectedLocationId}:`, error)
        return null
      }
    },

    enqueueJobs: async (
      user: string,
      locations: Array<{ id: string; lat: number; lon: number }>,
    ): Promise<void> => {
      await Promise.all(
        locations.map((loc) =>
          queue.enqueueJob({
            detectedLocationId: loc.id,
            lat: loc.lat,
            lon: loc.lon,
            user,
          }),
        ),
      )
    },

    getBoss: () => boss,

    stop: async (): Promise<void> => {
      await boss.stop()
      console.log('Geocode queue stopped')
    },
  }

  return queue
}
