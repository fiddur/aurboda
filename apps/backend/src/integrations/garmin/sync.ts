import { addDays, addMinutes, isFuture, subDays } from 'date-fns'

import type { SyncState } from '../../db/types.ts'
import type { GarminClient, GarminSource } from './source.ts'

import {
  getActivitiesNeedingDetail,
  getGarminActivitiesNeedingSets,
  getSyncState,
  markActivityDetailSynced,
  upsertSyncState,
} from '../../db/index.ts'
import { auditError, auditInfo, auditWarn } from '../../services/audit-log.ts'
import { importActivityExerciseSets } from './exercise-sets.ts'
import { parseActivityFit } from './fit.ts'
import {
  type GarminDataType,
  garminDataTypes,
  processActivityDetail,
  processActivityFit,
  type ProcessActivityDetailOptions,
  processGarminData,
} from './process.ts'
import { hasGarminConnection } from './source.ts'

export { hasGarminConnection } from './source.ts'

const DEFAULT_SYNC_HISTORY_DAYS = 90

/** Overlap buffer for incremental sync to catch retroactive edits. */
const INCREMENTAL_SYNC_OVERLAP_DAYS = 2

/** Delay between individual day-fetches to avoid rate limiting (ms). */
const REQUEST_DELAY_MS = 100

export interface SyncResult {
  data_type: GarminDataType
  records_processed: number
  status: 'success' | 'skipped' | 'error' | 'rate_limited'
  error?: string
  errors_by_day?: number
  retry_after?: Date
}

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

/** No connection at all is an error; a type no connection serves is skipped, leaving sync_state alone. */
const unsourcedResult = async (
  user: string,
  garmin: GarminClient,
  dataType: GarminDataType,
): Promise<SyncResult | null> => {
  if (!(await hasGarminConnection(user))) {
    return {
      data_type: dataType,
      error: 'User has no Garmin session. Please connect Garmin first.',
      records_processed: 0,
      status: 'error',
    }
  }
  if ((await garmin.sourceFor(user, dataType)) === null) {
    return { data_type: dataType, records_processed: 0, status: 'skipped' }
  }
  return null
}

export const syncGarminDataType = async (
  user: string,
  garmin: GarminClient,
  dataType: GarminDataType,
  options?: { fullResync?: boolean; startDate?: Date },
): Promise<SyncResult> => {
  const unsourced = await unsourcedResult(user, garmin, dataType)
  if (unsourced) return unsourced

  const syncState = await getSyncState(user, 'garmin', dataType)
  if (isRateLimited(syncState)) {
    return {
      data_type: dataType,
      records_processed: 0,
      retry_after: syncState!.retry_after!,
      status: 'rate_limited',
    }
  }

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

    await upsertSyncState(user, {
      data_type: dataType,
      error_message: errorMessage,
      provider: 'garmin',
      status: 'error',
    })
    return { data_type: dataType, error: errorMessage, records_processed: 0, status: 'error' }
  }
}

export const syncAllGarminData = async (
  user: string,
  garmin: GarminClient,
  options?: {
    disabledTypes?: GarminDataType[]
    fullResync?: boolean
    startDate?: Date
    onDetailSynced?: DetailSyncedCallback
    onTrackWritten?: TrackWrittenCallback
  },
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

    if (dataType === 'activities' && result.status === 'success' && !hitRateLimit) {
      await syncActivityDetails(user, garmin, {
        fullResync: options?.fullResync,
        onDetailSynced: options?.onDetailSynced,
        onTrackWritten: options?.onTrackWritten,
      })
    }
  }

  return results
}

/** Told about an activity whose detail just landed for the first time. */
export type DetailSyncedCallback = (user: string, activityId: string) => void

/** Told about an activity whose GPS track was just written. */
export type TrackWrittenCallback = (user: string, activityId: string) => void

interface DetailContext {
  user: string
  garmin: GarminClient
  activityId: string
  garminActivityId: number
  startTime: Date
  now: Date
  options: ProcessActivityDetailOptions
}

const syncJsonDetail = async ({ garmin, garminActivityId, options, user }: DetailContext) => {
  const detail = await garmin.getActivityDetail(user, garminActivityId)
  return processActivityDetail(user, detail, options)
}

/** The FIT file's point count, or null when Garmin has no usable file for the activity. */
const syncFitDetail = async ({ garmin, garminActivityId, options, user }: DetailContext) => {
  const zip = await garmin.getActivityFile(user, garminActivityId)
  const fit = zip ? parseActivityFit(zip) : null
  return fit ? processActivityFit(user, { fit, garminActivityId }, options) : null
}

/** The written point count and where it came from; null when the key found no file and there is no session. */
const fetchDetail = async (
  context: DetailContext,
  source: GarminSource,
  hasSession: boolean,
): Promise<{ count: number; fromFile: boolean } | null> => {
  if (source === 'personal_key') {
    const count = await fitDetailOrNull(context, hasSession)
    if (count !== null) return { count, fromFile: true }
    if (!hasSession) return null
  }
  return { count: await syncJsonDetail(context), fromFile: false }
}

/** With a session to fall back on, a refused or failed download counts as no file; without one it throws, so the activity is retried. */
const fitDetailOrNull = async (context: DetailContext, hasSession: boolean): Promise<number | null> => {
  if (!hasSession) return syncFitDetail(context)
  try {
    return await syncFitDetail(context)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    auditWarn(
      context.user,
      'sync',
      `FIT file for Garmin activity ${context.garminActivityId} failed, using the login's detail`,
      { error: message },
    )
    return null
  }
}

/** Garmin can list an activity before it serves its file, so a fresh one without a file is asked for again. */
const NO_FILE_GRACE_MS = 24 * 60 * 60 * 1000

/** Fetch, process and mark one activity's detail. A failure is audited and leaves it for the next run. */
const syncOneDetail = async (
  context: DetailContext,
  source: GarminSource,
  hasSession: boolean,
  hadDetail: boolean,
  onDetailSynced?: DetailSyncedCallback,
): Promise<void> => {
  const { activityId, garminActivityId, now, startTime, user } = context
  try {
    const synced = await fetchDetail(context, source, hasSession)
    if (synced === null && now.getTime() - startTime.getTime() < NO_FILE_GRACE_MS) return
    await markActivityDetailSynced(user, activityId)
    if (synced === null) {
      auditInfo(user, 'sync', `📄 Garmin has no activity file for activity ${garminActivityId}`)
      return
    }
    if (!hadDetail) onDetailSynced?.(user, activityId)
    const from = synced.fromFile ? ' from its FIT file' : ''
    auditInfo(
      user,
      'sync',
      `📊 Synced ${synced.count} detail metrics for Garmin activity ${garminActivityId}${from}`,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const via = source === 'personal_key' ? 'FIT file' : 'detail'
    auditError(user, 'sync', `Failed to sync ${via} for Garmin activity ${garminActivityId}`, {
      error: message,
    })
  }
}

/**
 * Fetch granular per-second metrics (HR, respiration, GPS, the track, …) for activities that
 * haven't been processed yet: from the activity's FIT file through a usable Personal API key,
 * else from the session's JSON detail. An activity Garmin has no usable file for, or whose
 * download fails, falls back to the JSON detail when there is a session; without one a failure is
 * retried on the next run and a missing file is asked for again while the activity
 * is under a day old, and then marked done, so a manual activity is not asked for every run.
 * When fullResync is true, re-fetches detail for all activities (e.g. to pick up
 * newly added data extraction like GPS locations); `onDetailSynced` still fires
 * only for activities that had no detail before, so a full re-sync does not
 * re-federate every share.
 */
export const syncActivityDetails = async (
  user: string,
  garmin: GarminClient,
  {
    fullResync = false,
    now = new Date(),
    onDetailSynced,
    onTrackWritten,
  }: {
    fullResync?: boolean
    now?: Date
    onDetailSynced?: DetailSyncedCallback
    onTrackWritten?: TrackWrittenCallback
  } = {},
): Promise<void> => {
  const source = await garmin.sourceFor(user, 'activityDetail')
  if (source === null) return
  const hasSession = (await garmin.sourceFor(user, 'activitySession')) === 'session'
  if (hasSession) await syncActivitySets(user, garmin, { fullResync })
  const activities = await getActivitiesNeedingDetail(user, { forceAll: fullResync })

  for (const activity of activities) {
    const garminActivityId = activity.data?.garmin_activity_id as number | undefined
    if (!garminActivityId || !activity.id) continue

    // No end_time means no usable span — a start-only one would clamp the
    // precedence range to a few minutes around the start. Fall back to the
    // track's own range instead.
    const activitySpan = activity.end_time ? { end: activity.end_time, start: activity.start_time } : null
    const context: DetailContext = {
      activityId: activity.id,
      garmin,
      garminActivityId,
      now,
      options: { activityId: activity.id, activitySpan, activityStart: activity.start_time, onTrackWritten },
      startTime: activity.start_time,
      user,
    }

    await syncOneDetail(context, source, hasSession, activity.data?.detail_synced === true, onDetailSynced)

    await delay(REQUEST_DELAY_MS)
  }
}

/**
 * Read the exercise sets of Garmin strength activities, before their detail so a share composed
 * when the detail lands already carries them. A failed activity stays unmarked for the next run.
 */
export const syncActivitySets = async (
  user: string,
  garmin: GarminClient,
  { fullResync = false }: { fullResync?: boolean } = {},
): Promise<void> => {
  const activities = await getGarminActivitiesNeedingSets(user, { forceAll: fullResync })

  for (const activity of activities) {
    const garminActivityId = activity.data?.garmin_activity_id as number | undefined
    if (!garminActivityId || !activity.id) continue

    try {
      const response = await garmin.getActivityExerciseSets(user, garminActivityId)
      const count = await importActivityExerciseSets(user, activity, response)
      if (count !== null) {
        auditInfo(user, 'sync', `🏋️ Synced ${count} sets for Garmin activity ${garminActivityId}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      auditError(user, 'sync', `Failed to sync sets for Garmin activity ${garminActivityId}`, {
        error: message,
      })
    }

    await delay(REQUEST_DELAY_MS)
  }
}

const fetchAndProcess = async (
  user: string,
  garmin: GarminClient,
  dataType: GarminDataType,
  date: Date,
): Promise<{ records: number; error?: string }> => {
  try {
    const data = await fetchDataType(garmin, user, dataType, date)
    if (data == null) return { records: 0 }
    return {
      records: await processGarminData(user, dataType, data, undefined, date.toISOString().slice(0, 10)),
    }
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

export { garminDataTypes, type GarminDataType } from './process.ts'
