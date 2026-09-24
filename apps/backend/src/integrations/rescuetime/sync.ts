import { addMinutes, isBefore, isFuture, subDays } from 'date-fns'

import type { ProductivityRecord } from '../../db/types.ts'

import {
  getScreentimeCategories,
  getSyncState,
  insertActivities,
  insertProductivity,
  type SyncState,
  upsertSyncState,
} from '../../db/index.ts'
import { buildScreentimeActivitySpans, spansToActivities } from '../../services/screentime-activities.ts'
import { categorizeRecords, compileRules } from '../../services/screentime-categories.ts'
import { ensureAllCategoriesHaveTypes } from '../../services/screentime-category-sync.ts'
import { rescuetimeClient } from './client.ts'

/** Default start date for historical sync (30 days back) */
const DEFAULT_SYNC_HISTORY_DAYS = 30

/** Backoff intervals for rate limiting (in minutes) */
const RATE_LIMIT_BACKOFF = [1, 5, 15, 60]

export const calculateRetryAfter = (attemptCount = 0): Date => {
  const backoffIndex = Math.min(attemptCount, RATE_LIMIT_BACKOFF.length - 1)
  return addMinutes(new Date(), RATE_LIMIT_BACKOFF[backoffIndex])
}

export const isRateLimited = (syncState: SyncState | null): boolean => {
  if (!syncState?.retry_after) return false
  return syncState.status === 'rate_limited' && isFuture(syncState.retry_after)
}

export interface SyncResult {
  records_processed: number
  status: 'success' | 'skipped' | 'error' | 'rate_limited'
  error?: string
  retry_after?: Date
}

export const syncRescueTimeData = async (
  user: string,
  apiKey: string,
  options: { fullResync?: boolean; startDate?: Date } = {},
): Promise<SyncResult> => {
  const dataType = 'productivity'

  const syncState = await getSyncState(user, 'rescuetime', dataType)

  if (isRateLimited(syncState)) {
    return {
      records_processed: 0,
      retry_after: syncState!.retry_after,
      status: 'skipped',
    }
  }

  const end = new Date()
  let start: Date

  if (options.fullResync || !syncState?.last_sync_time) {
    start = options.startDate || subDays(end, DEFAULT_SYNC_HISTORY_DAYS)
  } else {
    start = syncState.last_sync_time
  }

  await upsertSyncState(user, {
    data_type: dataType,
    provider: 'rescuetime',
    status: 'syncing',
    sync_start_date: start,
  })

  try {
    const client = rescuetimeClient(apiKey)
    const data = await client.getIntervalData(start, end)

    const productivityRecords: ProductivityRecord[] = data.map((r) => ({
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
      const categories = await getScreentimeCategories(user)
      if (categories.length > 0) {
        const compiledRules = compileRules(categories)
        categorizeRecords(productivityRecords, compiledRules)
      }
      await insertProductivity(user, productivityRecords)

      // Also create merged-span activities so screentime participates in the
      // unified activity pipeline (charts, queries, deduction rules).
      if (categories.length > 0) {
        // Ensure each category has its derived activity_type linked. Lazy
        // backfill: pre-link migration users hit this path on their first
        // sync after deploy and get their types created in depth order.
        await ensureAllCategoriesHaveTypes(user, categories)
        const spans = buildScreentimeActivitySpans(productivityRecords, categories)
        if (spans.length > 0) await insertActivities(user, spansToActivities(spans))
      }
    }

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

export const needsSync = (syncState: SyncState | null, thresholdMinutes: number): boolean => {
  if (!syncState?.last_sync_time) return true
  const threshold = addMinutes(syncState.last_sync_time, thresholdMinutes)
  return isBefore(threshold, new Date())
}
