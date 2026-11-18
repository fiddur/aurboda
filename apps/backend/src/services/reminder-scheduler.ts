import type { PgBoss } from './pg-boss.ts'

import { auditError } from './audit-log.ts'

const QUEUE_NAME = 'reminder-scheduler'

/** Its own queue rather than the sync tick, which runs every user's provider syncs and can take minutes. */
export const REMINDER_SCHEDULER_CRON = '*/5 * * * *'

export interface ReminderSchedulerDeps {
  listUsers: () => Promise<string[]>
  raiseDue: (user: string) => Promise<unknown>
  onUserError?: (user: string, error: unknown) => unknown
}

const auditUserError = (user: string, error: unknown) =>
  auditError(user, 'system', 'Reminder tick failed for user', { error: String(error) })

/** One tick over every user; one user's failure is audited and never stops the rest. Resolves to the users visited. */
export const runDueReminders = async (deps: ReminderSchedulerDeps): Promise<number> => {
  const onUserError = deps.onUserError ?? auditUserError
  const users = await deps.listUsers()
  for (const user of users) {
    try {
      await deps.raiseDue(user)
    } catch (error) {
      await onUserError(user, error)
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
