/**
 * Auto-share evaluation queue (#903), on pg-boss like the deduction/calorie
 * queues — with one twist: jobs are enqueued with `startAfter` so evaluation
 * runs only after a **stabilisation delay**. Synced activities are frequently
 * merged, enriched (HR zones, calories), or re-synced shortly after first
 * landing; delaying evaluation lets the created post's scalars and window
 * reflect the settled activity. Evaluation itself is idempotent (hard dedupe in
 * `evaluateAutoshareWindow`), so overlapping windows and repeat jobs are safe.
 *
 * No inline fallback on a failed enqueue (unlike the calorie queue): running
 * the evaluation instantly would defeat the stabilisation delay, and a missed
 * window is recovered by the next sync's overlapping notification.
 */

import type { Job, PgBoss } from './pg-boss.ts'

import { auditError } from './audit-log.ts'

export interface AutoshareJobData {
  user: string
  /** ISO window of the triggering mutation. */
  window_start: string
  window_end: string
}

export interface AutoshareQueueDeps {
  evaluateWindow: (user: string, start: Date, end: Date) => Promise<number>
}

export interface AutoshareQueue {
  enqueueEvaluation: (user: string, start: Date, end: Date) => Promise<void>
}

interface MergedWindow {
  start: Date
  end: Date
}

const QUEUE_NAME = 'autoshare-eval'

/** Stabilisation delay: evaluate no sooner than this after the triggering mutation. */
export const STABILISATION_SECONDS = 10 * 60

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

  await boss.work<AutoshareJobData>(
    QUEUE_NAME,
    { batchSize: 50, pollingIntervalSeconds: 10 },
    async (jobs) => {
      const grouped = groupAutoshareJobs(jobs)
      for (const [user, window] of grouped) {
        try {
          const created = await deps.evaluateWindow(user, window.start, window.end)
          if (created > 0) console.info(`📣 auto-shared ${created} post(s) for ${user}`)
        } catch (err) {
          auditError(user, 'data', 'Auto-share evaluation job failed', { error: String(err) })
        }
      }
    },
  )

  console.info('📣 Auto-share evaluation queue ready')

  return {
    enqueueEvaluation: async (user: string, start: Date, end: Date): Promise<void> => {
      try {
        await boss.send(
          QUEUE_NAME,
          { user, window_end: end.toISOString(), window_start: start.toISOString() },
          { retryLimit: 2, startAfter: STABILISATION_SECONDS },
        )
      } catch (err) {
        auditError(user, 'data', 'Failed to enqueue auto-share evaluation', { error: String(err) })
      }
    },
  }
}
/* v8 ignore stop */
