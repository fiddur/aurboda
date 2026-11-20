import type { PgBoss } from './pg-boss.ts'

import { auditError } from './audit-log.ts'

const QUEUE_NAME = 'reminder-scheduler'

/** Its own queue rather than the sync tick, which runs every user's provider syncs and can take minutes. */
export const REMINDER_SCHEDULER_CRON = '*/5 * * * *'

export interface ReminderSchedulerDeps {
  listUsers: () => Promise<string[]>
  raiseDue: (user: string) => Promise<unknown>
  raiseDueCheckIns?: (user: string) => Promise<unknown>
  onUserError?: (user: string, error: unknown, step: string) => unknown
}

const auditUserError = (user: string, error: unknown, step: string) =>
  auditError(user, 'system', `${step} tick failed for user`, { error: String(error) })

/**
 * One tick over every user; one user's failure in a step is audited and stops neither that user's
 * other steps nor the other users. Resolves to the users visited.
 */
export const runDueReminders = async (deps: ReminderSchedulerDeps): Promise<number> => {
  const onUserError = deps.onUserError ?? auditUserError
  const steps: [string, (user: string) => Promise<unknown>][] = [['Reminder', deps.raiseDue]]
  if (deps.raiseDueCheckIns) steps.push(['Check-in', deps.raiseDueCheckIns])
  const users = await deps.listUsers()
  for (const user of users) {
    for (const [step, run] of steps) {
      try {
        await run(user)
      } catch (error) {
        await onUserError(user, error, step)
      }
    }
  }
  return users.length
}

/* v8 ignore start -- requires real pg-boss instance */
export const createReminderScheduler = async (boss: PgBoss, deps: ReminderSchedulerDeps): Promise<void> => {
  await boss.createQueue(QUEUE_NAME)
  await boss.schedule(QUEUE_NAME, REMINDER_SCHEDULER_CRON)
  await boss.work(QUEUE_NAME, { batchSize: 1, pollingIntervalSeconds: 30 }, async () => {
    await runDueReminders(deps)
  })
  console.info(`⏰ Reminder scheduler running (${REMINDER_SCHEDULER_CRON})`)
}
/* v8 ignore stop */
