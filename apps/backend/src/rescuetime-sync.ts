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
  if (!syncState?.retryAfter) return false
  return syncState.status === 'rate_limited' && isFuture(syncState.retryAfter)
}

/** Result of a sync operation */
export interface SyncResult {
  recordsProcessed: number
  status: 'success' | 'skipped' | 'error' | 'rate_limited'
  error?: string
  retryAfter?: Date
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
      recordsProcessed: 0,
      retryAfter: syncState!.retryAfter,
      status: 'skipped',
    }
  }

  // Determine date range
  const end = new Date()
  let start: Date

  if (options.fullResync || !syncState?.lastSyncTime) {
    start = options.startDate || subDays(end, DEFAULT_SYNC_HISTORY_DAYS)
  } else {
    start = syncState.lastSyncTime
  }

  // Mark as syncing
  await upsertSyncState(user, {
    dataType,
    provider: 'rescuetime',
    status: 'syncing',
    syncStartDate: start,
  })

  try {
    const client = rescuetimeClient(apiKey)
    const data = await client.getIntervalData(start, end)

    // Store the data
    const productivityRecords = data.map((r) => ({
      activity: r.activity,
      category: r.category,
      durationSec: r.duration,
      endTime: r.endTime,
      isMobile: r.mobile,
      productivity: r.productivity,
      source: 'rescuetime' as const,
      startTime: r.startTime,
    }))

    if (productivityRecords.length > 0) {
      await insertProductivity(user, productivityRecords)
    }

    // Update sync state on success
    await upsertSyncState(user, {
      dataType,
      lastSyncTime: end,
      provider: 'rescuetime',
      status: 'idle',
    })

    return {
      recordsProcessed: productivityRecords.length,
      status: 'success',
    }
  } catch (error: unknown) {
    const axiosError = error as { response?: { status?: number } }

    // Handle rate limiting (RescueTime uses 429)
    if (axiosError.response?.status === 429) {
      const retryAfter = calculateRetryAfter()
      await upsertSyncState(user, {
        dataType,
        errorMessage: 'Rate limited by RescueTime API',
        provider: 'rescuetime',
        retryAfter,
        status: 'rate_limited',
      })

      return {
        recordsProcessed: 0,
        retryAfter,
        status: 'rate_limited',
      }
    }

    // Handle other errors
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    await upsertSyncState(user, {
      dataType,
      errorMessage,
      provider: 'rescuetime',
      status: 'error',
    })

    return {
      error: errorMessage,
      recordsProcessed: 0,
      status: 'error',
    }
  }
}

/**
 * Check if RescueTime sync is needed based on last sync time.
 */
export const needsSync = (syncState: SyncState | null, thresholdMinutes: number): boolean => {
  if (!syncState?.lastSyncTime) return true
  const threshold = addMinutes(syncState.lastSyncTime, thresholdMinutes)
  return isBefore(threshold, new Date())
}
