/**
 * Detection trigger with per-user debouncing.
 *
 * When a location is inserted, we debounce detection by 5 seconds per user.
 * This prevents running detection on every single location update.
 */

import { getDetectedLocationById } from '../db'
import { runDetectionForUser } from './detection-worker'
import { enqueueGeocodeJob, getGeocodeQueue } from './geocode-queue'

// ============================================================================
// Configuration
// ============================================================================

const DEBOUNCE_MS = 5000 // 5 seconds

// ============================================================================
// Per-User Debounce State
// ============================================================================

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
 * Trigger location detection for a user with debouncing.
 * If called multiple times within the debounce window, only the last call runs detection.
 */
export const triggerDetectionForUser = (user: string): void => {
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
 * Execute detection and queue geocoding for a user.
 * Called after debounce period expires.
 */
const executeDetectionForUser = async (user: string): Promise<void> => {
  console.log(`Running detection for user ${user}`)

  try {
    const result = await runDetectionForUser(user)

    console.log(
      `Detection complete for ${user}: ${result.created} created, ${result.updated} updated, ${result.needsGeocode.length} need geocoding`,
    )

    // Queue geocoding jobs if the queue is available
    const queue = getGeocodeQueue()
    if (queue && result.needsGeocode.length > 0) {
      for (const locationId of result.needsGeocode) {
        const location = await getDetectedLocationById(user, locationId)
        if (location) {
          await enqueueGeocodeJob({
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

/**
 * Clear all pending detections (used for testing/shutdown).
 */
export const clearPendingDetections = (): void => {
  for (const timeout of pendingDetections.values()) {
    clearTimeout(timeout)
  }
  pendingDetections.clear()
}

/**
 * Get the number of pending detections (for monitoring).
 */
export const getPendingDetectionCount = (): number => pendingDetections.size

/**
 * Check if a user has a pending detection.
 */
export const hasPendingDetection = (user: string): boolean => pendingDetections.has(user)
