/**
 * Strava sync queue using pg-boss.
 *
 * Uses the shared pg-boss instance for cross-instance job coordination.
 * batchSize: 1 ensures one Strava API call at a time across all instances,
 * which is critical because Strava rate limits are per-application
 * (100 reads/15min, 1,000 reads/day).
 *
 * Two job types:
 * - list_activities: paginate through activity list, enqueue fetch_activity for each
 * - fetch_activity: fetch detail + streams, process into DB (2 API calls per activity)
 *
 * Rate limit tracking uses in-memory state updated from Strava response headers.
 */

import axios from 'axios'

import type { StravaApiResponse } from '../integrations/strava/client.ts'
import type { StravaProcessDeps } from '../integrations/strava/process.ts'
import type {
  StravaDetailedActivity,
  StravaStreamsResponse,
  StravaSyncJobData,
  StravaSummaryActivity,
} from '../integrations/strava/types.ts'
import type { Job, PgBoss } from './pg-boss.ts'

import { processStravaActivity } from '../integrations/strava/process.ts'
import { parseRateLimitHeaders } from '../integrations/strava/types.ts'
import { auditError, auditInfo, auditWarn } from './audit-log.ts'

// ============================================================================
// Types
// ============================================================================

export interface StravaQueueDeps {
  getAccessToken: (user: string) => Promise<string>
  listActivities: (
    token: string,
    params: { before?: number; after?: number; page?: number; per_page?: number },
  ) => Promise<StravaApiResponse<StravaSummaryActivity[]>>
  getActivity: (token: string, activityId: number) => Promise<StravaApiResponse<StravaDetailedActivity>>
  getActivityStreams: (token: string, activityId: number) => Promise<StravaApiResponse<StravaStreamsResponse>>
  processDeps: StravaProcessDeps
  updateSyncState: (user: string, dataType: string, updates: Record<string, unknown>) => Promise<void>
}

export interface StravaQueueStatus {
  active_count: number
  queued_count: number
}

export interface StravaQueue {
  enqueueSync: (user: string, options: { fullResync?: boolean; after?: number }) => Promise<void>
  enqueueActivityFetch: (user: string, activityId: number, priority: number) => Promise<void>
  getStatus: () => Promise<StravaQueueStatus>
}

// ============================================================================
// Configuration
// ============================================================================

const QUEUE_NAME = 'strava-sync'
const DEAD_LETTER_QUEUE = 'strava-sync-dead-letter'

/** Priority levels: lower = higher priority */
export const PRIORITY_WEBHOOK = 1
export const PRIORITY_INCREMENTAL = 5
export const PRIORITY_BACKFILL = 10

/**
 * Retry limits per job type. List jobs form the pagination chain — if one
 * dies permanently, the chain breaks and missing pages never get enumerated,
 * so give them more retries. Fetch failures only lose one activity each.
 */
const LIST_RETRY_LIMIT = 10
const FETCH_RETRY_LIMIT = 3

const listSendOptions = (priority: number) => ({
  deadLetter: DEAD_LETTER_QUEUE,
  priority,
  retryBackoff: true,
  retryDelay: 60,
  retryLimit: LIST_RETRY_LIMIT,
})

const fetchSendOptions = (priority: number) => ({
  deadLetter: DEAD_LETTER_QUEUE,
  priority,
  retryBackoff: true,
  retryDelay: 60,
  retryLimit: FETCH_RETRY_LIMIT,
})

/** Safety margins — leave headroom for webhook requests */
const MAX_READS_15MIN = 90
const MAX_READS_DAILY = 900

/** Base delay between requests (ms) */
const BASE_DELAY_MS = 1000

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Milliseconds until the next 15-minute boundary (:00, :15, :30, :45). */
const msUntilNext15MinBoundary = (): number => {
  const now = new Date()
  const minutes = now.getMinutes()
  const nextBoundary = Math.ceil((minutes + 1) / 15) * 15
  const target = new Date(now)
  target.setMinutes(nextBoundary, 0, 0)
  if (target <= now) target.setMinutes(target.getMinutes() + 15)
  return target.getTime() - now.getTime()
}

// ============================================================================
// Job handler
// ============================================================================

const createJobHandler = (deps: StravaQueueDeps, boss: PgBoss) => {
  // Rate limit state scoped to this queue instance (not module-level)
  let reads15min = 0
  let readsDaily = 0

  const updateRateLimit = (info: { reads_15min: number; reads_daily: number }): void => {
    reads15min = info.reads_15min
    readsDaily = info.reads_daily
  }

  const calculateDelay = (): number => {
    const remaining15min = Math.max(0, MAX_READS_15MIN - reads15min)
    const remainingDaily = Math.max(0, MAX_READS_DAILY - readsDaily)

    if (remaining15min <= 5 || remainingDaily <= 10) return 10_000
    if (remaining15min <= 20 || remainingDaily <= 50) return 3_000
    return BASE_DELAY_MS
  }

  const enqueueJob = async (data: StravaSyncJobData, priority: number): Promise<void> => {
    const options =
      data.request_type === 'list_activities' ? listSendOptions(priority) : fetchSendOptions(priority)
    await boss.send(QUEUE_NAME, data, options)
  }

  const handleListActivities = async (
    user: string,
    token: string,
    listParams: StravaSyncJobData['list_params'],
  ): Promise<void> => {
    const result = await deps.listActivities(token, {
      after: listParams?.after,
      before: listParams?.before,
      page: listParams?.page,
      per_page: 200,
    })
    updateRateLimit(result.rateLimit)

    const activities = result.data
    auditInfo(user, 'sync', `📋 Strava: listed ${activities.length} activities`)

    const priority = (listParams?.after ? PRIORITY_INCREMENTAL : PRIORITY_BACKFILL) + 1
    for (const activity of activities) {
      await enqueueJob({ request_type: 'fetch_activity', strava_activity_id: activity.id, user }, priority)
    }

    if (activities.length === 200) {
      const oldestStart = activities[activities.length - 1].start_date
      const before = Math.floor(new Date(oldestStart).getTime() / 1000)
      await enqueueJob(
        { list_params: { ...listParams, before }, request_type: 'list_activities', user },
        listParams?.after ? PRIORITY_INCREMENTAL : PRIORITY_BACKFILL,
      )
    } else {
      await deps.updateSyncState(user, 'activities', { last_sync_time: new Date(), status: 'idle' })
    }
  }

  const handleFetchActivity = async (user: string, token: string, activityId: number): Promise<void> => {
    const detailResult = await deps.getActivity(token, activityId)
    updateRateLimit(detailResult.rateLimit)
    await sleep(calculateDelay())

    let streams: StravaStreamsResponse | null = null
    try {
      const streamsResult = await deps.getActivityStreams(token, activityId)
      updateRateLimit(streamsResult.rateLimit)
      streams = streamsResult.data
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        auditInfo(user, 'sync', `📊 Strava: no streams for activity ${activityId} (manual?)`)
      } else {
        throw error
      }
    }

    const pointCount = await processStravaActivity(user, detailResult.data, streams, deps.processDeps)
    auditInfo(user, 'sync', `✅ Strava: processed activity ${activityId} (${pointCount} data points)`)

    await deps.updateSyncState(user, 'activity_details', { last_sync_time: new Date(), status: 'idle' })
  }

  return async (jobs: Job<StravaSyncJobData>[]): Promise<void> => {
    for (const job of jobs) {
      const { user, request_type, strava_activity_id, list_params } = job.data

      if (reads15min >= MAX_READS_15MIN || readsDaily >= MAX_READS_DAILY) {
        const waitMs = reads15min >= MAX_READS_15MIN ? msUntilNext15MinBoundary() : 60_000
        auditWarn(user, 'sync', `⏳ Strava rate limit reached, sleeping ${Math.round(waitMs / 1000)}s`)
        await sleep(waitMs)
        throw new Error('Rate limit budget exhausted, retrying')
      }

      try {
        const token = await deps.getAccessToken(user)

        if (request_type === 'list_activities') {
          await handleListActivities(user, token, list_params)
        } else if (request_type === 'fetch_activity' && strava_activity_id) {
          await handleFetchActivity(user, token, strava_activity_id)
        }

        await sleep(calculateDelay())
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 429) {
          if (error.response.headers) {
            updateRateLimit(parseRateLimitHeaders(error.response.headers as Record<string, unknown>))
          }
          const waitMs = msUntilNext15MinBoundary()
          auditWarn(user, 'sync', `🚫 Strava 429, waiting ${Math.round(waitMs / 1000)}s`)
          await sleep(waitMs)
        }

        const msg = error instanceof Error ? error.message : String(error)
        auditError(user, 'sync', `Strava sync error (${request_type}): ${msg}`)
        throw error
      }
    }
  }
}

// ============================================================================
// Dead-letter handler
// ============================================================================

/**
 * Receives jobs that exhausted their retry limit. Audit-logs the permanent
 * failure, and for list_activities jobs also marks sync_state as 'error' —
 * otherwise a broken pagination chain leaves the status stuck on 'syncing'
 * and subsequent sync_strava calls return 'already_syncing'.
 */
const createDeadLetterHandler =
  (deps: StravaQueueDeps) =>
  async (jobs: Job<StravaSyncJobData>[]): Promise<void> => {
    for (const job of jobs) {
      const { user, request_type } = job.data
      auditError(user, 'sync', `☠️ Strava job permanently failed: ${request_type} (exhausted retries)`)

      if (request_type === 'list_activities') {
        await deps.updateSyncState(user, 'activities', {
          error_message:
            'Pagination stopped — list_activities job exhausted retries. Trigger a new sync to resume.',
          status: 'error',
        })
      }
    }
  }

// ============================================================================
// Queue factory
// ============================================================================

export const createStravaQueue = async (boss: PgBoss, deps: StravaQueueDeps): Promise<StravaQueue> => {
  await boss.createQueue(QUEUE_NAME)
  await boss.createQueue(DEAD_LETTER_QUEUE)

  await boss.work(QUEUE_NAME, { batchSize: 1, pollingIntervalSeconds: 2 }, createJobHandler(deps, boss))
  await boss.work(
    DEAD_LETTER_QUEUE,
    { batchSize: 1, pollingIntervalSeconds: 5 },
    createDeadLetterHandler(deps),
  )
  console.info('🏃 Strava sync queue ready (with dead-letter handler)')

  return {
    enqueueActivityFetch: async (user: string, activityId: number, priority: number): Promise<void> => {
      await boss.send(
        QUEUE_NAME,
        { request_type: 'fetch_activity', strava_activity_id: activityId, user } satisfies StravaSyncJobData,
        fetchSendOptions(priority),
      )
    },

    enqueueSync: async (user: string, options: { fullResync?: boolean; after?: number }): Promise<void> => {
      const priority = options.fullResync ? PRIORITY_BACKFILL : PRIORITY_INCREMENTAL

      await boss.send(
        QUEUE_NAME,
        {
          list_params: options.fullResync ? undefined : { after: options.after },
          request_type: 'list_activities',
          user,
        } satisfies StravaSyncJobData,
        listSendOptions(priority),
      )

      auditInfo(user, 'sync', `🏃 Strava: enqueued ${options.fullResync ? 'full' : 'incremental'} sync`)
    },

    getStatus: async (): Promise<StravaQueueStatus> => {
      const info = await boss.getQueue(QUEUE_NAME)
      return {
        active_count: info?.activeCount ?? 0,
        queued_count: info?.queuedCount ?? 0,
      }
    },
  }
}
