/**
 * ActivityWatch push sync service.
 *
 * ActivityWatch is a local desktop daemon — it cannot be pulled from a remote server.
 * Instead, a push agent on each device periodically sends batches of events to this endpoint.
 *
 * See docs/activitywatch.md for setup instructions.
 */
import type { ActivityWatchEvent, ActivityWatchSyncResult } from '@aurboda/api-spec'

import type { ProductivityRecord } from './db/types.ts'

import { getScreentimeCategories, insertProductivity, upsertSyncState } from './db/index.ts'
import { categorizeRecords, compileRules } from './services/screentime-categories.ts'

/**
 * Process a batch of ActivityWatch events from a push agent.
 *
 * @param user - The Aurboda username
 * @param events - ActivityWatch events from aw-watcher-window or aw-watcher-android
 * @param deviceName - Hostname or user-configured device name (empty string for single-device setup)
 * @param isMobile - Whether the events come from a mobile device (default false)
 */
export const processActivityWatchEvents = async (
  user: string,
  events: ActivityWatchEvent[],
  deviceName: string,
  isMobile = false,
): Promise<ActivityWatchSyncResult> => {
  try {
    const records: ProductivityRecord[] = events.map((event) => {
      const startTime = new Date(event.timestamp)
      const durationSec = Math.round(event.duration)
      const endTime = new Date(startTime.getTime() + durationSec * 1000)

      return {
        activity: event.app,
        category: undefined,
        device_name: deviceName,
        duration_sec: durationSec,
        end_time: endTime,
        is_mobile: isMobile,
        productivity: undefined,
        source: 'activitywatch',
        start_time: startTime,
        title: event.title || undefined,
      }
    })

    // Resolve categories if user has screentime rules configured
    const categories = await getScreentimeCategories(user)
    if (categories.length > 0) {
      const compiledRules = compileRules(categories)
      categorizeRecords(records, compiledRules)
    }

    await insertProductivity(user, records)

    // Track last push time per device in sync_state
    const dataType = deviceName ? `productivity:${deviceName}` : 'productivity'
    await upsertSyncState(user, {
      data_type: dataType,
      last_sync_time: new Date(),
      provider: 'activitywatch',
      status: 'idle',
    })

    return {
      device_name: deviceName,
      records_stored: records.length,
      status: 'success',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return {
      device_name: deviceName,
      error: message,
      records_stored: 0,
      status: 'error',
    }
  }
}
