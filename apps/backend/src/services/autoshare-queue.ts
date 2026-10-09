/**
 * Auto-share evaluation queue (#903), on pg-boss like the deduction/calorie
 * queues — with one twist: jobs are enqueued with `startAfter` so evaluation
 * runs only after a **stabilisation delay**. Synced activities are frequently
 * merged, enriched (HR zones, calories), or re-synced shortly after first
 * landing; delaying evaluation lets the created post's scalars and window
 * reflect the settled activity. The evaluator re-queues a window (`startAfter`
 * at a Date) when a group in it is not settled yet. Evaluation itself is
 * idempotent (hard dedupe in `evaluateAutoshareWindow`), so overlapping
 * windows and repeat jobs are safe.
 *
 * No inline fallback on a failed enqueue (unlike the calorie queue): running
 * the evaluation instantly would defeat the stabilisation delay, and a missed
 * window is recovered by the next sync's overlapping notification.
 */

import type { AutoshareDeps } from './autoshare.ts'
import type { Job, PgBoss } from './pg-boss.ts'

import { auditError } from './audit-log.ts'
import { STABILISATION_SECONDS } from './autoshare.ts'

export interface AutoshareJobData {
  user: string
  /** ISO window of the triggering mutation. */
  window_start: string
  window_end: string
}

export type AutoshareRequeue = NonNullable<AutoshareDeps['requeue']>

export interface AutoshareQueueDeps {
  evaluateWindow: (user: string, start: Date, end: Date, requeue: AutoshareRequeue) => Promise<number>
}

export interface AutoshareQueue {
  enqueueEvaluation: (user: string, start: Date, end: Date) => Promise<void>
}

interface MergedWindow {
  start: Date
  end: Date
}

const QUEUE_NAME = 'autoshare-eval'

/** Group jobs by user and merge their windows (same batching as the sibling queues). */
export const groupAutoshareJobs = (jobs: Job<AutoshareJobData>[]): Map<string, MergedWindow> => {
  const byUser = new Map<string, MergedWindow>()
  for (const job of jobs) {
    const start = new Date(job.data.window_start)
    const end = new Date(job.data.window_end)
    const existing = byUser.get(job.data.user)
    if (existing) {
      if (start < existing.start) existing.start = start
      if (end > existing.end) existing.end = end
    } else {
      byUser.set(job.data.user, { end, start })
    }
  }
  return byUser
}

/* v8 ignore start -- requires real pg-boss instance */
export const createAutoshareQueue = async (
  boss: PgBoss,
  deps: AutoshareQueueDeps,
): Promise<AutoshareQueue> => {
  await boss.createQueue(QUEUE_NAME)

  const send = async (user: string, start: Date, end: Date, startAfter: Date | number): Promise<void> => {
    try {
      await boss.send(
        QUEUE_NAME,
        { user, window_end: end.toISOString(), window_start: start.toISOString() },
        { retryLimit: 2, startAfter },
      )
    } catch (err) {
      auditError(user, 'data', 'Failed to enqueue auto-share evaluation', { error: String(err) })
    }
  }
  const requeue: AutoshareRequeue = (user, start, end, notBefore) => send(user, start, end, notBefore)

  await boss.work<AutoshareJobData>(
    QUEUE_NAME,
    { batchSize: 50, pollingIntervalSeconds: 10 },
    async (jobs) => {
      const grouped = groupAutoshareJobs(jobs)
      for (const [user, window] of grouped) {
        try {
          const created = await deps.evaluateWindow(user, window.start, window.end, requeue)
          if (created > 0) console.info(`📣 auto-shared ${created} post(s) for ${user}`)
        } catch (err) {
          auditError(user, 'data', 'Auto-share evaluation job failed', { error: String(err) })
        }
      }
    },
  )

  console.info('📣 Auto-share evaluation queue ready')

  return {
    enqueueEvaluation: (user: string, start: Date, end: Date): Promise<void> =>
      send(user, start, end, STABILISATION_SECONDS),
  }
}
/* v8 ignore stop */
