import type { Job, PgBoss } from '../pg-boss.ts'

import { auditError } from '../audit-log.ts'

const REFRESH_QUEUE = 'strength-score-refresh'
const SWEEP_QUEUE = 'strength-score-sweep'

export const STRENGTH_SCORE_SWEEP_CRON = '*/5 * * * *'
const REFRESH_DELAY_SECONDS = 5

export interface StrengthScoreRefreshJobData {
  user: string
}

export interface StrengthScoreQueueDeps {
  isReadOnly: (user: string) => Promise<boolean>
  listUsers: () => Promise<string[]>
  refresh: (user: string) => Promise<unknown>
}

export interface StrengthScoreQueue {
  enqueueRefresh: (user: string) => Promise<void>
}

export const usersOfJobs = (jobs: Job<StrengthScoreRefreshJobData>[]): string[] => [
  ...new Set(jobs.map((job) => job.data.user)),
]

/** Refreshes each user once, skipping read-only accounts; a failure is audited and the next user goes on. */
export const refreshUsers = async (users: readonly string[], deps: StrengthScoreQueueDeps): Promise<void> => {
  for (const user of users) {
    try {
      if (await deps.isReadOnly(user)) continue
      await deps.refresh(user)
    } catch (err) {
      auditError(user, 'data', 'Strength score metrics refresh failed', { error: String(err) })
    }
  }
}

/** One sweep over every user. Resolves to the number of users listed. */
export const runStrengthScoreSweep = async (deps: StrengthScoreQueueDeps): Promise<number> => {
  const users = await deps.listUsers()
  await refreshUsers(users, deps)
  return users.length
}

/* v8 ignore start -- requires real pg-boss instance */
export const createStrengthScoreQueue = async (
  boss: PgBoss,
  deps: StrengthScoreQueueDeps,
): Promise<StrengthScoreQueue> => {
  await boss.createQueue(REFRESH_QUEUE)
  await boss.work<StrengthScoreRefreshJobData>(
    REFRESH_QUEUE,
    { batchSize: 50, pollingIntervalSeconds: 10 },
    async (jobs) => {
      await refreshUsers(usersOfJobs(jobs), deps)
    },
  )

  await boss.createQueue(SWEEP_QUEUE)
  await boss.schedule(SWEEP_QUEUE, STRENGTH_SCORE_SWEEP_CRON)
  await boss.work(SWEEP_QUEUE, { batchSize: 1, pollingIntervalSeconds: 30 }, async () => {
    await runStrengthScoreSweep(deps)
  })

  console.info(`💪 Strength score metrics queue ready (sweep ${STRENGTH_SCORE_SWEEP_CRON})`)

  return {
    enqueueRefresh: async (user: string): Promise<void> => {
      try {
        await boss.send(REFRESH_QUEUE, { user }, { retryLimit: 1, startAfter: REFRESH_DELAY_SECONDS })
      } catch (err) {
        auditError(user, 'data', 'Failed to enqueue strength score metrics refresh', { error: String(err) })
      }
    },
  }
}
/* v8 ignore stop */
