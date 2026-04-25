/**
 * Detection trigger with per-user debouncing.
 *
 * When a location is inserted, we debounce detection by 5 seconds per user.
 * This prevents running detection on every single location update.
 */

import type { Activity, DetectedLocation, NamedLocation } from '../db/index.ts'
import type { GeocodeQueue } from './geocode-queue.ts'
import type { PlaceVisit } from './locations.ts'

import { auditError, auditInfo } from './audit-log.ts'
import { materializeForRange } from './location-visit-activities.ts'

// ============================================================================
// Types
// ============================================================================

export interface DetectionTriggerDeps {
  runDetectionForUser: (user: string) => Promise<{ created: number; updated: number; needsGeocode: string[] }>
  getDetectedLocationById: (user: string, id: string) => Promise<DetectedLocation | null>
  geocodeQueue: GeocodeQueue | null
  /** Lookback window for location_visit activity materialization. Default 7 days. */
  materializeLookbackDays?: number
  getPlaceVisits: (user: string, start: Date, end: Date) => Promise<PlaceVisit[]>
  getNamedLocations: (user: string) => Promise<NamedLocation[]>
  insertActivities: (user: string, activities: Activity[]) => Promise<unknown>
}

export interface DetectionTrigger {
  triggerDetectionForUser: (user: string) => void
  clearPendingDetections: () => void
  getPendingDetectionCount: () => number
  hasPendingDetection: (user: string) => boolean
}

// ============================================================================
// Configuration
// ============================================================================

const DEBOUNCE_MS = 5000 // 5 seconds
const DEFAULT_MATERIALIZE_LOOKBACK_DAYS = 7

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a detection trigger instance with per-user debouncing.
 *
 * @param deps - Dependencies for the trigger
 * @returns DetectionTrigger instance
 */
export const createDetectionTrigger = (deps: DetectionTriggerDeps): DetectionTrigger => {
  /**
   * In-memory map of pending detection timeouts per user.
   *
   * NOTE: This state is lost on server restart. This is acceptable because:
   * - Detection only delays processing by 5 seconds
   * - Worst case: a detection run is skipped, but next location update triggers new detection
   * - The geocode queue (pg-boss) persists jobs, so no geocoding work is lost
   */
  const pendingDetections: Map<string, NodeJS.Timeout> = new Map()

  const lookbackDays = deps.materializeLookbackDays ?? DEFAULT_MATERIALIZE_LOOKBACK_DAYS

  /**
   * Materialize location_visit activities for the recent window. Runs after
   * detection so opted-in named-location visits become activities without
   * waiting for someone to browse /locations for the range.
   */
  const materializeRecentVisits = async (user: string): Promise<void> => {
    const end = new Date()
    const start = new Date(end.getTime() - lookbackDays * 24 * 60 * 60 * 1000)
    const result = await materializeForRange(user, start, end, {
      getNamedLocations: deps.getNamedLocations,
      getPlaceVisits: deps.getPlaceVisits,
      insertActivities: deps.insertActivities,
    })
    if (result.upserted > 0) {
      auditInfo(user, 'data', 'location_visit activities materialized', {
        upserted: result.upserted,
      })
    }
  }

  /**
   * Execute detection and queue geocoding for a user.
   * Called after debounce period expires.
   */
  const executeDetectionForUser = async (user: string): Promise<void> => {
    auditInfo(user, 'data', 'Running location detection')

    try {
      const result = await deps.runDetectionForUser(user)

      auditInfo(user, 'data', 'Location detection complete', {
        created: result.created,
        updated: result.updated,
        needs_geocode: result.needsGeocode.length,
      })

      // Queue geocoding jobs if the queue is available
      if (deps.geocodeQueue && result.needsGeocode.length > 0) {
        for (const locationId of result.needsGeocode) {
          const location = await deps.getDetectedLocationById(user, locationId)
          if (location) {
            await deps.geocodeQueue.enqueueJob({
              detectedLocationId: locationId,
              lat: location.lat,
              lon: location.lon,
              user,
            })
          }
        }
      }

      // Proactive location_visit materialization. Don't let failures here
      // affect detection bookkeeping — the /locations on-read backstop will
      // catch up next time someone browses the range.
      try {
        await materializeRecentVisits(user)
      } catch (error) {
        auditError(user, 'data', 'location_visit materialization failed', { error: String(error) })
      }
    } catch (error) {
      auditError(user, 'data', 'Location detection failed', { error: String(error) })
    }
  }

  /**
   * Trigger location detection for a user with debouncing.
   * If called multiple times within the debounce window, only the last call runs detection.
   */
  const triggerDetectionForUser = (user: string): void => {
    // Clear any existing pending detection for this user
    const existing = pendingDetections.get(user)
    if (existing) {
      clearTimeout(existing)
    }

    // Schedule detection after debounce period
    const timeout = setTimeout(() => {
      // Execute detection and handle errors properly
      // Delete from pending map only after detection completes (success or failure)
      executeDetectionForUser(user)
        .catch((error) => {
          console.error(`Unhandled error in detection for user ${user}:`, error)
        })
        .finally(() => {
          pendingDetections.delete(user)
        })
    }, DEBOUNCE_MS)

    pendingDetections.set(user, timeout)
  }

  /**
   * Clear all pending detections (used for testing/shutdown).
   */
  const clearPendingDetections = (): void => {
    for (const timeout of pendingDetections.values()) {
      clearTimeout(timeout)
    }
    pendingDetections.clear()
  }

  /**
   * Get the number of pending detections (for monitoring).
   */
  const getPendingDetectionCount = (): number => pendingDetections.size

  /**
   * Check if a user has a pending detection.
   */
  const hasPendingDetection = (user: string): boolean => pendingDetections.has(user)

  return {
    clearPendingDetections,
    getPendingDetectionCount,
    hasPendingDetection,
    triggerDetectionForUser,
  }
}
