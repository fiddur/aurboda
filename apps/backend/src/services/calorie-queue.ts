/**
 * Calorie computation job queue using pg-boss.
 *
 * Heart-rate ingestion (`POST /sync/HeartRateRecord`) used to call
 * `triggerCalorieComputation` synchronously inside the request handler.
 * For an initial Android sync that uploads weeks of HR data in 50-sample
 * chunks, that meant dozens of full computations (HR fetch, weight/VO2
 * lookup, per-minute formula, per-point outbound-sync enqueue, gap-fill
 * across days) blocking the response.
 *
 * This queue moves that work off the request path: ingestion enqueues a
 * job describing the affected window, the worker batches incoming jobs
 * by user with merged windows, and runs the computation once per merged
 * window. Pattern matches `deduction-queue.ts` and `geocode-queue.ts`.
 */

import type { Job, PgBoss } from './pg-boss.ts'

import { auditError } from './audit-log.ts'

// ============================================================================
// Types
// ============================================================================

export interface CalorieJobData {
  user: string
  /** ISO timestamp of the earliest HR sample in the trigger batch. */
  start: string
  /** ISO timestamp of the latest HR sample in the trigger batch. */
  end: string
}

export interface CalorieQueueDeps {
  triggerCalorieComputation: (user: string, start: Date, end: Date) => Promise<void>
}

export interface CalorieQueue {
  enqueueComputation: (user: string, start: Date, end: Date) => Promise<void>
}

interface MergedWindow {
  start: Date
  end: Date
}

// ============================================================================
// Configuration
// ============================================================================

const QUEUE_NAME = 'calorie-compute'

// ============================================================================
// Batch helper (exported for unit testing)
// ============================================================================

/**
 * Group jobs by user and merge their time windows. When 20 HR-batch requests
 * arrive in a 5-second polling interval, the worker runs `triggerCalorieComputation`
 * once per user across the union window instead of 20 separate times.
 */
export const groupCalorieJobs = (jobs: Job<CalorieJobData>[]): Map<string, MergedWindow> => {
  const byUser = new Map<string, MergedWindow>()
  for (const job of jobs) {
    const start = new Date(job.data.start)
    const end = new Date(job.data.end)
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

// ============================================================================
// Factory
// ============================================================================

/* v8 ignore start -- requires real pg-boss instance */
export const createCalorieQueue = async (boss: PgBoss, deps: CalorieQueueDeps): Promise<CalorieQueue> => {
  await boss.createQueue(QUEUE_NAME)

  await boss.work<CalorieJobData>(QUEUE_NAME, { batchSize: 50, pollingIntervalSeconds: 5 }, async (jobs) => {
    const grouped = groupCalorieJobs(jobs)
    for (const [user, window] of grouped) {
      try {
        await deps.triggerCalorieComputation(user, window.start, window.end)
      } catch (err) {
        // triggerCalorieComputation already swallows errors internally,
        // but defend against future refactors that might let one escape.
        auditError(user, 'data', 'Calorie computation job failed', { error: String(err) })
      }
    }
  })

  console.info('🔥 Calorie computation queue ready')

  return {
    enqueueComputation: async (user: string, start: Date, end: Date): Promise<void> => {
      try {
        await boss.send(
          QUEUE_NAME,
          { end: end.toISOString(), start: start.toISOString(), user },
          { retryLimit: 2 },
        )
      } catch (err) {
        auditError(user, 'data', 'Failed to enqueue calorie computation', { error: String(err) })
      }
    },
  }
}
/* v8 ignore stop */
