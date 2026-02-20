/**
 * RescueTime data sync module.
 *
 * Handles fetching data from RescueTime API and storing it in the database.
 * Supports incremental sync with rate limit handling.
 */

import { addMinutes, isBefore, isFuture, subDays } from 'date-fns'
import { getSyncState, insertProductivity, SyncState, upsertSyncState } from './db'
import { rescuetimeClient } from './rescuetime'

/** Default start date for historical sync (30 days back) */
const DEFAULT_SYNC_HISTORY_DAYS = 30

/** Backoff intervals for rate limiting (in minutes) */
const RATE_LIMIT_BACKOFF = [1, 5, 15, 60]

/**
 * Calculate retry time based on exponential backoff.
 */
export const calculateRetryAfter = (attemptCount = 0): Date => {
  const backoffIndex = Math.min(attemptCount, RATE_LIMIT_BACKOFF.length - 1)
  return addMinutes(new Date(), RATE_LIMIT_BACKOFF[backoffIndex])
}

/**
 * Check if RescueTime is currently rate limited.
 */
export const isRateLimited = (syncState: SyncState | null): boolean => {
  if (!syncState?.retry_after) return false
  return syncState.status === 'rate_limited' && isFuture(syncState.retry_after)
}

/** Result of a sync operation */
export interface SyncResult {
  records_processed: number
  status: 'success' | 'skipped' | 'error' | 'rate_limited'
  error?: string
  retry_after?: Date
}

/**
 * Sync RescueTime productivity data.
 */
export const syncRescueTimeData = async (
  user: string,
  apiKey: string,
  options: { fullResync?: boolean; startDate?: Date } = {},
): Promise<SyncResult> => {
  const dataType = 'productivity'

  // Check current sync state
  const syncState = await getSyncState(user, 'rescuetime', dataType)

  // Skip if rate limited
  if (isRateLimited(syncState)) {
    return {
      records_processed: 0,
      retry_after: syncState!.retry_after,
      status: 'skipped',
    }
  }

  // Determine date range
  const end = new Date()
  let start: Date

  if (options.fullResync || !syncState?.last_sync_time) {
    start = options.startDate || subDays(end, DEFAULT_SYNC_HISTORY_DAYS)
  } else {
    start = syncState.last_sync_time
  }

  // Mark as syncing
  await upsertSyncState(user, {
    data_type: dataType,
    provider: 'rescuetime',
    status: 'syncing',
    sync_start_date: start,
  })

  try {
    const client = rescuetimeClient(apiKey)
    const data = await client.getIntervalData(start, end)

    // Store the data
    const productivityRecords = data.map((r) => ({
      activity: r.activity,
      category: r.category,
      duration_sec: r.duration,
      end_time: r.endTime,
      is_mobile: r.mobile,
      productivity: r.productivity,
      source: 'rescuetime' as const,
      start_time: r.startTime,
    }))

    if (productivityRecords.length > 0) {
      await insertProductivity(user, productivityRecords)
    }

    // Update sync state on success
    await upsertSyncState(user, {
      data_type: dataType,
      last_sync_time: end,
      provider: 'rescuetime',
      status: 'idle',
    })

    return {
      records_processed: productivityRecords.length,
      status: 'success',
    }
  } catch (error: unknown) {
    const axiosError = error as { response?: { status?: number } }

    // Handle rate limiting (RescueTime uses 429)
    if (axiosError.response?.status === 429) {
      const retryAfter = calculateRetryAfter()
      await upsertSyncState(user, {
        data_type: dataType,
        error_message: 'Rate limited by RescueTime API',
        provider: 'rescuetime',
        retry_after: retryAfter,
        status: 'rate_limited',
      })

      return {
        records_processed: 0,
        retry_after: retryAfter,
        status: 'rate_limited',
      }
    }

    // Handle other errors
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    await upsertSyncState(user, {
      data_type: dataType,
      error_message: errorMessage,
      provider: 'rescuetime',
      status: 'error',
    })

    return {
      error: errorMessage,
      records_processed: 0,
      status: 'error',
    }
  }
}

/**
 * Check if RescueTime sync is needed based on last sync time.
 */
export const needsSync = (syncState: SyncState | null, thresholdMinutes: number): boolean => {
  if (!syncState?.last_sync_time) return true
  const threshold = addMinutes(syncState.last_sync_time, thresholdMinutes)
  return isBefore(threshold, new Date())
}
