/**
 * Activity-track queues (#1231).
 *
 * `track-analyse` gets one job per written track and runs route matching (run
 * features and segment matching hang there later); it starts after the same kind
 * of stabilisation delay auto-share uses, since a track is often rewritten by a
 * re-sync shortly after it lands. `track-backfill` builds tracks for history
 * from stored raw records and matches routes for them, one job per user.
 */
import type { PgBoss } from './pg-boss.ts'
import type { TrackBackfillJobDeps, TrackBackfillResult } from './track-backfill.ts'

import { auditError, auditInfo } from './audit-log.ts'
import { backfillUserTracks } from './track-backfill.ts'

/** `stately`: a re-sync while a job waits collapses into it. The policy is fixed at creation. */
export const TRACK_ANALYSE_QUEUE = 'track-analyse'
export const TRACK_BACKFILL_QUEUE = 'track-backfill'

export const ANALYSE_DELAY_SECONDS = 600

export interface TrackAnalyseJobData {
  user: string
  activity_id: string
}

export interface TrackBackfillJobData {
  user: string
}

export interface TrackAnalyseDeps {
  analyse: (user: string, activityId: string) => Promise<void>
}

export interface TrackAnalyseQueue {
  enqueue: (user: string, activityId: string) => void
}

export interface TrackBackfillQueue {
  enqueue: (user: string, startAfterSeconds?: number) => Promise<void>
}

export const runTrackBackfillJob = async (
  job: TrackBackfillJobData,
  deps: TrackBackfillJobDeps,
): Promise<TrackBackfillResult & { routes: { matched: number; created: number } }> => {
  const result = await backfillUserTracks(job.user, deps)
  if (result.garmin + result.strava + result.skipped > 0) {
    auditInfo(job.user, 'data', '🛤️ Activity track backfill done', { ...result })
  }
  const routes = await deps.matchRoutes(job.user)
  if (routes.matched + routes.created > 0) {
    auditInfo(job.user, 'data', '🗺️ Route matching done', { ...routes })
  }
  return { ...result, routes }
}

/* v8 ignore start -- requires real pg-boss instance */
export const createTrackAnalyseQueue = async (
  boss: PgBoss,
  deps: TrackAnalyseDeps,
): Promise<TrackAnalyseQueue> => {
  await boss.createQueue(TRACK_ANALYSE_QUEUE, { policy: 'stately' })

  await boss.work<TrackAnalyseJobData>(
    TRACK_ANALYSE_QUEUE,
    { batchSize: 1, pollingIntervalSeconds: 10 },
    async ([job]) => {
      if (!job) return
      await deps.analyse(job.data.user, job.data.activity_id)
    },
  )

  console.info('🛤️ Track analyse queue ready')

  return {
    enqueue: (user, activityId) => {
      const data: TrackAnalyseJobData = { activity_id: activityId, user }
      boss
        .send(TRACK_ANALYSE_QUEUE, data, {
          retryLimit: 2,
          singletonKey: `${user}:${activityId}`,
          startAfter: ANALYSE_DELAY_SECONDS,
        })
        .catch((err: unknown) =>
          auditError(user, 'data', 'Failed to enqueue track analysis', {
            activity_id: activityId,
            error: String(err),
          }),
        )
    },
  }
}

export const createTrackBackfillQueue = async (
  boss: PgBoss,
  deps: TrackBackfillJobDeps,
): Promise<TrackBackfillQueue> => {
  await boss.createQueue(TRACK_BACKFILL_QUEUE, { policy: 'stately' })

  await boss.work<TrackBackfillJobData>(
    TRACK_BACKFILL_QUEUE,
    { batchSize: 1, pollingIntervalSeconds: 30 },
    async ([job]) => {
      if (!job) return
      const result = await runTrackBackfillJob(job.data, deps)
      console.info(
        `🛤️ track backfill for ${job.data.user}: ${result.garmin} garmin, ${result.strava} strava, ${result.skipped} skipped; routes: ${result.routes.matched} matched, ${result.routes.created} created`,
      )
    },
  )

  console.info('🛤️ Track backfill queue ready')

  return {
    enqueue: async (user, startAfterSeconds = 0) => {
      try {
        await boss.send(TRACK_BACKFILL_QUEUE, { user }, { singletonKey: user, startAfter: startAfterSeconds })
      } catch (err) {
        auditError(user, 'data', 'Failed to enqueue track backfill', { error: String(err) })
      }
    },
  }
}
/* v8 ignore stop */
