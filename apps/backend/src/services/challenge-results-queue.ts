/**
 * Scheduled sweep that announces finished challenges (see
 * `challenge-results.ts`), on pg-boss like the other queues — but driven by a
 * cron schedule rather than enqueued events, because a challenge ends by the
 * clock, not by a request. Each tick runs one full sweep; a tick that finds
 * nothing is free (one indexed query per user).
 */
import type { PgBoss } from './pg-boss.ts'

const QUEUE_NAME = 'challenge-results'

/** Every 10 minutes — the grace period is hours, so finer than this buys nothing. */
export const CHALLENGE_RESULTS_CRON = '*/10 * * * *'

export interface ChallengeResultsQueueDeps {
  /** Run one sweep; resolves to the number of results published. */
  sweep: () => Promise<number>
}

/* v8 ignore start -- requires real pg-boss instance */
export const createChallengeResultsQueue = async (
  boss: PgBoss,
  deps: ChallengeResultsQueueDeps,
): Promise<void> => {
  await boss.createQueue(QUEUE_NAME)
  await boss.schedule(QUEUE_NAME, CHALLENGE_RESULTS_CRON)
  await boss.work(QUEUE_NAME, { batchSize: 1, pollingIntervalSeconds: 30 }, async () => {
    const published = await deps.sweep()
    if (published > 0) console.info(`🏆 Announced ${published} finished challenge(s)`)
  })
  console.info(`🏆 Challenge result sweep scheduled (${CHALLENGE_RESULTS_CRON})`)
}
/* v8 ignore stop */
