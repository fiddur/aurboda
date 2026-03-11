/**
 * Oura data sync module.
 *
 * Handles fetching data from Oura API and storing it in the database.
 * Supports incremental sync with rate limit handling.
 *
 * Data processing (transforming Oura responses into DB records) lives in oura-process.ts.
 */

import { addMinutes, isFuture, subDays } from 'date-fns'
import { getSyncState, getUserSettings, SyncState, upsertSyncState } from './db'
import { ouraClient } from './oura'
import { type OuraDataType, processOuraData } from './oura-process'
import { triggerCalorieComputation } from './services/calorie-computation'

// Re-export for consumers that import from oura-sync
export {
  computeSleepMinutes,
  convertOuraSleepPhases,
  processOuraData,
  type OuraDataType,
} from './oura-process'

/** Default start date for historical sync (90 days back) */
const DEFAULT_SYNC_HISTORY_DAYS = 90

/** Overlap buffer for incremental syncs to catch retroactive edits (in days). */
const INCREMENTAL_SYNC_OVERLAP_DAYS = 2

/** Backoff intervals for rate limiting (in minutes) */
const RATE_LIMIT_BACKOFF = [1, 5, 15, 60]

/**
 * Calculate retry time based on Retry-After header or exponential backoff.
 */
export const calculateRetryAfter = (retryAfterHeader?: string, attemptCount = 0): Date => {
  if (retryAfterHeader) {
    const seconds = parseInt(retryAfterHeader, 10)
    if (!isNaN(seconds)) {
      return addMinutes(new Date(), Math.ceil(seconds / 60))
    }
  }

  const backoffIndex = Math.min(attemptCount, RATE_LIMIT_BACKOFF.length - 1)
  return addMinutes(new Date(), RATE_LIMIT_BACKOFF[backoffIndex])
}

/**
 * Check if a data type is currently rate limited.
 */
export const isRateLimited = (syncState: SyncState | null): boolean => {
  if (!syncState?.retry_after) return false
  return syncState.status === 'rate_limited' && isFuture(syncState.retry_after)
}

/** Result of a sync operation */
export interface SyncResult {
  data_type: OuraDataType
  records_processed: number
  status: 'success' | 'skipped' | 'error' | 'rate_limited'
  error?: string
  retry_after?: Date
}

/**
 * Sync a single Oura data type.
 */
/* eslint-disable complexity -- switch over 7 Oura data types + error handling is inherently branchy */
export const syncOuraDataType = async (
  user: string,
  oura: ReturnType<typeof ouraClient>,
  dataType: OuraDataType,
  accessToken: string,
  options: { fullResync?: boolean; startDate?: Date } = {},
): Promise<SyncResult> => {
  // Check current sync state
  const syncState = await getSyncState(user, 'oura', dataType)

  // Skip if rate limited
  if (isRateLimited(syncState)) {
    return {
      data_type: dataType,
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
    // Add overlap buffer to catch retroactive edits in Oura
    start = subDays(syncState.last_sync_time, INCREMENTAL_SYNC_OVERLAP_DAYS)
  }

  // Mark as syncing
  await upsertSyncState(user, {
    data_type: dataType,
    provider: 'oura',
    status: 'syncing',
    sync_start_date: start,
  })

  try {
    let data: unknown[]

    switch (dataType) {
      case 'dailyCardiovascularAge':
        data = await oura.getDailyCardiovascularAge(start, end, accessToken)
        break
      case 'dailyReadiness':
        data = await oura.getDailyReadiness(start, end, accessToken)
        break
      case 'dailyResilience':
        data = await oura.getDailyResilience(start, end, accessToken)
        break
      case 'dailySleep':
        data = await oura.getDailySleep(start, end, accessToken)
        break
      case 'sessions':
        data = await oura.getSessions(start, end, accessToken)
        break
      case 'sleep':
        data = await oura.getSleep(start, end, accessToken)
        break
      case 'tags': {
        const settings = await getUserSettings(user)
        data = await oura.getTags(start, end, accessToken, settings?.tag_mappings)
        break
      }
    }

    await processOuraData(user, dataType, data)

    // Trigger calorie computation for data types that include HR samples
    if ((dataType === 'sleep' || dataType === 'sessions') && data.length > 0) {
      await triggerCalorieComputation(user, start, end)
    }

    // Update sync state on success
    await upsertSyncState(user, {
      data_type: dataType,
      last_sync_time: end,
      provider: 'oura',
      status: 'idle',
    })

    return {
      data_type: dataType,
      records_processed: data.length,
      status: 'success',
    }
  } catch (error: unknown) {
    const axiosError = error as { response?: { status?: number; headers?: Record<string, string> } }

    // Handle rate limiting
    if (axiosError.response?.status === 429) {
      const retryAfter = calculateRetryAfter(axiosError.response.headers?.['retry-after'])
      await upsertSyncState(user, {
        data_type: dataType,
        error_message: 'Rate limited by Oura API',
        provider: 'oura',
        retry_after: retryAfter,
        status: 'rate_limited',
      })

      return {
        data_type: dataType,
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
      provider: 'oura',
      status: 'error',
    })

    return {
      data_type: dataType,
      error: errorMessage,
      records_processed: 0,
      status: 'error',
    }
  }
}
/* eslint-enable complexity */

/**
 * Sync all Oura data types.
 */
export const syncAllOuraData = async (
  user: string,
  oura: ReturnType<typeof ouraClient>,
  options: { fullResync?: boolean; startDate?: Date } = {},
): Promise<SyncResult[]> => {
  const accessToken = await oura.getAccessToken(user)
  const dataTypes: OuraDataType[] = [
    'dailyCardiovascularAge',
    'dailyReadiness',
    'dailyResilience',
    'dailySleep',
    'sessions',
    'sleep',
    'tags',
  ]

  const results: SyncResult[] = []

  for (const dataType of dataTypes) {
    const result = await syncOuraDataType(user, oura, dataType, accessToken, options)
    results.push(result)

    // Stop if we hit rate limiting to avoid more 429s
    if (result.status === 'rate_limited') {
      // Mark remaining types as skipped
      const remaining = dataTypes.slice(dataTypes.indexOf(dataType) + 1)
      for (const remainingType of remaining) {
        results.push({
          data_type: remainingType,
          records_processed: 0,
          retry_after: result.retry_after,
          status: 'skipped',
        })
      }
      break
    }
  }

  return results
}
