/**
 * Detection trigger with per-user debouncing.
 *
 * When a location is inserted, we debounce detection by 5 seconds per user.
 * This prevents running detection on every single location update.
 */

import { DetectedLocation } from '../db'
import { GeocodeQueue } from './geocode-queue'

// ============================================================================
// Types
// ============================================================================

export interface DetectionTriggerDeps {
  runDetectionForUser: (user: string) => Promise<{ created: number; updated: number; needsGeocode: string[] }>
  getDetectedLocationById: (user: string, id: string) => Promise<DetectedLocation | null>
  geocodeQueue: GeocodeQueue | null
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

  /**
   * Execute detection and queue geocoding for a user.
   * Called after debounce period expires.
   */
  const executeDetectionForUser = async (user: string): Promise<void> => {
    console.log(`Running detection for user ${user}`)

    try {
      const result = await deps.runDetectionForUser(user)

      console.log(
        `Detection complete for ${user}: ${result.created} created, ${result.updated} updated, ${result.needsGeocode.length} need geocoding`,
      )

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
    } catch (error) {
      console.error(`Detection failed for user ${user}:`, error)
    }
  }

  return {
    /**
     * Clear all pending detections (used for testing/shutdown).
     */
    clearPendingDetections: (): void => {
      for (const timeout of pendingDetections.values()) {
        clearTimeout(timeout)
      }
      pendingDetections.clear()
    },

    /**
     * Get the number of pending detections (for monitoring).
     */
    getPendingDetectionCount: (): number => pendingDetections.size,

    /**
     * Check if a user has a pending detection.
     */
    hasPendingDetection: (user: string): boolean => pendingDetections.has(user),
    /**
     * Trigger location detection for a user with debouncing.
     * If called multiple times within the debounce window, only the last call runs detection.
     */
    triggerDetectionForUser: (user: string): void => {
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
    },
  }
}
