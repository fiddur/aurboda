/**
 * Geocoding job queue using pg-boss.
 *
 * Uses the shared pg-boss instance for cross-instance job coordination.
 * Enforces 1.1s delay between jobs to respect Nominatim rate limits.
 */

import type { DetectedLocationUpdate } from '../db/index.ts'
import type { Job, PgBoss } from './pg-boss.ts'

import { auditError, auditInfo, auditWarn } from './audit-log.ts'
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
  enqueueJob: (data: GeocodeJobData) => Promise<string | null>
  enqueueJobs: (user: string, locations: Array<{ id: string; lat: number; lon: number }>) => Promise<void>
}

// ============================================================================
// Configuration
// ============================================================================

const QUEUE_NAME = 'geocode-location'
const RATE_LIMIT_DELAY_MS = 1100 // 1.1 seconds between requests (Nominatim rate limit)

/**
 * Sleep for a specified duration.
 */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// ============================================================================
// Job handler factory
// ============================================================================

/**
 * Create a job handler with the given dependencies.
 */
const createJobHandler = (deps: GeocodeQueueDeps) => {
  return async (jobs: Job<GeocodeJobData>[]): Promise<void> => {
    // Process jobs sequentially with rate limiting
    for (const job of jobs) {
      const { detectedLocationId, lat, lon, user } = job.data

      auditInfo(user, 'data', `Processing geocode job for location ${detectedLocationId}`, { lat, lon })

      const result = await reverseGeocode(lat, lon)

      // Rate limit: wait before allowing next request
      // This ensures we respect Nominatim's 1 request/second limit
      await sleep(RATE_LIMIT_DELAY_MS)

      if (result.success) {
        await deps.updateDetectedLocation(user, detectedLocationId, {
          address: result.data.address,
          geocode_status: 'success',
        })
        auditInfo(user, 'data', `Geocoded location ${detectedLocationId}`, { address: result.data.address })
      } else {
        // Handle different error types
        const { error } = result
        if (error.type === 'network') {
          // Network error - retry by throwing
          auditError(user, 'data', `Network error geocoding ${detectedLocationId}`, { error: error.message })
          throw new Error(`Network error: ${error.message}`)
        } else if (error.type === 'http') {
          // HTTP error - retry for server errors (5xx), fail for client errors
          if (error.status >= 500) {
            auditError(user, 'data', `Server error geocoding ${detectedLocationId}`, { status: error.status })
            throw new Error(`HTTP ${error.status}: ${error.statusText}`)
          }
          // Client error (4xx) - don't retry
          auditWarn(user, 'data', `HTTP ${error.status} for location ${detectedLocationId}, marking failed`)
          await deps.updateDetectedLocation(user, detectedLocationId, {
            geocode_status: 'failed',
          })
        } else {
          // No results - valid response but location has no address
          auditWarn(user, 'data', `No address found for location ${detectedLocationId}`)
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
 * Create a geocode queue instance using a shared pg-boss instance.
 *
 * @param boss - Shared pg-boss instance
 * @param deps - Dependencies for the queue (updateDetectedLocation function)
 * @returns GeocodeQueue instance
 */
export const createGeocodeQueue = async (boss: PgBoss, deps: GeocodeQueueDeps): Promise<GeocodeQueue> => {
  await boss.createQueue(QUEUE_NAME)

  // batchSize: 1 ensures only one job processes at a time across all instances
  await boss.work(QUEUE_NAME, { batchSize: 1, pollingIntervalSeconds: 2 }, createJobHandler(deps))
  console.log('📍 Geocode queue ready')

  const queue: GeocodeQueue = {
    enqueueJob: async (data: GeocodeJobData): Promise<string | null> => {
      try {
        const jobId = await boss.send(QUEUE_NAME, data, {
          retryBackoff: true,
          retryDelay: 60,
          retryLimit: 3,
        })

        await deps.updateDetectedLocation(data.user, data.detectedLocationId, {
          geocode_status: 'geocoding',
        })

        return jobId
      } catch (error) {
        auditError(data.user, 'data', `Failed to enqueue geocode job for ${data.detectedLocationId}`, {
          error: String(error),
        })
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
  }

  return queue
}
