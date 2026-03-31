/**
 * Garmin Connect sync logic.
 *
 * Manages incremental sync, date range iteration, rate limiting, and sync state.
 * Follows the same patterns as oura-sync.ts.
 */

import { addDays, addMinutes, isFuture, subDays } from 'date-fns'

import type { SyncState } from './db/types.ts'
import type { GarminClient } from './garmin.ts'

import { getSyncState, upsertSyncState } from './db/index.ts'
import { type GarminDataType, garminDataTypes, processGarminData } from './garmin-process.ts'
import { auditError } from './services/audit-log.ts'

// ============================================================================
// Constants
// ============================================================================

/** Default number of days to fetch on first/full sync. */
const DEFAULT_SYNC_HISTORY_DAYS = 90

/** Overlap buffer for incremental sync to catch retroactive edits. */
const INCREMENTAL_SYNC_OVERLAP_DAYS = 2

/** Delay between individual day-fetches to avoid rate limiting (ms). */
const REQUEST_DELAY_MS = 100

// ============================================================================
// Types
// ============================================================================

export interface SyncResult {
  data_type: GarminDataType
  records_processed: number
  status: 'success' | 'skipped' | 'error' | 'rate_limited'
  error?: string
  errors_by_day?: number
  retry_after?: Date
}

// ============================================================================
// Rate limiting helpers
// ============================================================================

/** Exponential backoff schedule: 1, 5, 15, 60 minutes. */
const BACKOFF_MINUTES = [1, 5, 15, 60]

export const calculateRetryAfter = (retryAfterHeader?: string, attemptCount = 0): Date => {
  if (retryAfterHeader) {
    const seconds = parseInt(retryAfterHeader, 10)
    if (!isNaN(seconds)) return addMinutes(new Date(), Math.ceil(seconds / 60))
  }
  const backoffIndex = Math.min(attemptCount, BACKOFF_MINUTES.length - 1)
  return addMinutes(new Date(), BACKOFF_MINUTES[backoffIndex])
}

export const isRateLimited = (syncState: SyncState | null): boolean => {
  if (!syncState) return false
  if (syncState.status !== 'rate_limited') return false
  if (!syncState.retry_after) return false
  return isFuture(syncState.retry_after)
}

// ============================================================================
// Single data type sync
// ============================================================================

/** Iterate day-by-day over a date range, fetching and processing each day. */
const syncDateRange = async (
  user: string,
  garmin: GarminClient,
  dataType: GarminDataType,
  startDate: Date,
  endDate: Date,
): Promise<{ totalRecords: number; dayErrors: number }> => {
  let totalRecords = 0
  let dayErrors = 0

  const currentDate = new Date(startDate)
  while (currentDate <= endDate) {
    const result = await fetchAndProcess(user, garmin, dataType, currentDate)
    totalRecords += result.records
    if (result.error) dayErrors++

    currentDate.setTime(addDays(currentDate, 1).getTime())

    if (currentDate <= endDate) await delay(REQUEST_DELAY_MS)
  }

  return { totalRecords, dayErrors }
}

export const syncGarminDataType = async (
  user: string,
  garmin: GarminClient,
  dataType: GarminDataType,
  options?: { fullResync?: boolean; startDate?: Date },
): Promise<SyncResult> => {
  // Check existing sync state
  const syncState = await getSyncState(user, 'garmin', dataType)
  if (isRateLimited(syncState)) {
    return {
      data_type: dataType,
      records_processed: 0,
      retry_after: syncState!.retry_after!,
      status: 'rate_limited',
    }
  }

  // Mark as syncing
  await upsertSyncState(user, {
    data_type: dataType,
    provider: 'garmin',
    status: 'syncing',
  })

  try {
    const now = new Date()
    const startDate =
      options?.fullResync || !syncState?.last_sync_time
        ? (options?.startDate ?? subDays(now, DEFAULT_SYNC_HISTORY_DAYS))
        : subDays(syncState.last_sync_time, INCREMENTAL_SYNC_OVERLAP_DAYS)

    const { totalRecords, dayErrors } = await syncDateRange(user, garmin, dataType, startDate, now)

    // Mark as idle on success (with warning if some days had errors)
    const errorMessage = dayErrors > 0 ? `${dayErrors} day(s) had fetch errors` : undefined
    await upsertSyncState(user, {
      data_type: dataType,
      error_message: errorMessage,
      last_sync_time: now,
      provider: 'garmin',
      retry_after: undefined,
      status: 'idle',
    })

    return {
      data_type: dataType,
      errors_by_day: dayErrors > 0 ? dayErrors : undefined,
      records_processed: totalRecords,
      status: 'success',
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    // Check for rate limiting (429 or known patterns)
    const is429 = errorMessage.includes('429') || errorMessage.toLowerCase().includes('rate limit')
    if (is429) {
      const retryAfter = calculateRetryAfter()
      await upsertSyncState(user, {
        data_type: dataType,
        error_message: errorMessage,
        provider: 'garmin',
        retry_after: retryAfter,
        status: 'rate_limited',
      })
      return { data_type: dataType, records_processed: 0, retry_after: retryAfter, status: 'rate_limited' }
    }

    // Generic error
    await upsertSyncState(user, {
      data_type: dataType,
      error_message: errorMessage,
      provider: 'garmin',
      status: 'error',
    })
    return { data_type: dataType, error: errorMessage, records_processed: 0, status: 'error' }
  }
}

// ============================================================================
// Sync all data types
// ============================================================================

export const syncAllGarminData = async (
  user: string,
  garmin: GarminClient,
  options?: { disabledTypes?: GarminDataType[]; fullResync?: boolean; startDate?: Date },
): Promise<SyncResult[]> => {
  const results: SyncResult[] = []
  let hitRateLimit = false
  const disabled = new Set(options?.disabledTypes ?? [])

  for (const dataType of garminDataTypes) {
    if (disabled.has(dataType)) {
      results.push({ data_type: dataType, records_processed: 0, status: 'skipped' })
      continue
    }

    if (hitRateLimit) {
      results.push({ data_type: dataType, records_processed: 0, status: 'skipped' })
      continue
    }

    const result = await syncGarminDataType(user, garmin, dataType, options)
    results.push(result)

    if (result.status === 'rate_limited') {
      hitRateLimit = true
    }
  }

  return results
}

// ============================================================================
// Helpers
// ============================================================================

/** Fetch data for a single day + data type, then process it. */
const fetchAndProcess = async (
  user: string,
  garmin: GarminClient,
  dataType: GarminDataType,
  date: Date,
): Promise<{ records: number; error?: string }> => {
  try {
    const data = await fetchDataType(garmin, user, dataType, date)
    if (data == null) return { records: 0 }
    return { records: await processGarminData(user, dataType, data) }
  } catch (error) {
    // If a single day fails, log and continue (don't abort the whole sync)
    const message = error instanceof Error ? error.message : String(error)
    auditError(user, 'sync', `Garmin sync error for ${dataType}`, {
      date: date.toISOString().slice(0, 10),
      error: message,
    })
    return { error: message, records: 0 }
  }
}

/** Dispatch to the correct garmin client method based on data type. */
const fetchDataType = async (
  garmin: GarminClient,
  user: string,
  dataType: GarminDataType,
  date: Date,
): Promise<unknown> => {
  switch (dataType) {
    case 'dailySummary':
      return garmin.getDailySummary(user, date)
    case 'heartRate':
      return garmin.getHeartRate(user, date)
    case 'hrv':
      return garmin.getHrv(user, date)
    case 'sleep':
      return garmin.getSleep(user, date)
    case 'stress':
      return garmin.getStress(user, date)
    case 'bodyBattery':
      // Body battery supports date ranges, but for consistency we fetch per-day
      return garmin.getBodyBattery(user, date, date)
    case 'activities':
      // Activities are fetched by offset/limit, not date. Fetch recent 20 per sync.
      // For a proper implementation, we'd paginate, but this covers the typical case.
      return garmin.getActivities(user, 0, 20)
    case 'spo2':
      return garmin.getSpo2(user, date)
    case 'respiration':
      return garmin.getRespiration(user, date)
    case 'trainingReadiness':
      return garmin.getTrainingReadiness(user, date)
    case 'intensityMinutes':
      return garmin.getIntensityMinutes(user, date)
  }
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// Re-export for convenience
export { garminDataTypes, type GarminDataType } from './garmin-process.ts'
