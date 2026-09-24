/**
 * Background poll scheduler for pull-based providers (#1042).
 *
 * Until now pull syncs ran only on demand: a query that needed fresh data
 * asked the sync provider to top up anything older than 30 minutes. That
 * leaves data stale on a quiet day and gives no knob to tune. This cron tick
 * walks every user and asks the same `…IfNeeded` functions to sync whatever
 * is past its interval — so `user_settings.sync_intervals` (per provider,
 * `default` as fallback) decides cadence in one place for both paths.
 *
 * The tick itself is cheap: each check is one sync-state read, and providers
 * the user hasn't connected return immediately. Only one instance runs a tick
 * (pg-boss cron), and a tick runs users sequentially to keep upstream API use
 * flat.
 */
import type { PgBoss } from './pg-boss.ts'
import type { SyncProvider } from './queries/types.ts'

import { auditError } from './audit-log.ts'

const QUEUE_NAME = 'sync-scheduler'

/** Every 5 minutes — the smallest interval a user can configure. */
export const SYNC_SCHEDULER_CRON = '*/5 * * * *'

export interface SyncSchedulerDeps {
  listUsers: () => Promise<string[]>
  sync: SyncProvider
  /** Garmin data types to consider (each keeps its own sync state). */
  garminDataTypes: readonly string[]
}

/**
 * Run one tick over every user. Each provider check catches and audits its
 * own failures, so one broken provider never blocks the rest of a user, and
 * one broken user never blocks the rest of the tick. Resolves to the number
 * of users visited.
 */
export const runScheduledSyncs = async (deps: SyncSchedulerDeps): Promise<number> => {
  const users = await deps.listUsers()
  for (const user of users) {
    try {
      await deps.sync.syncOuraIfNeeded(user, 'tags')
      await deps.sync.syncOuraIfNeeded(user, 'sessions')
      for (const dataType of deps.garminDataTypes) {
        await deps.sync.syncGarminIfNeeded(user, dataType)
      }
      await deps.sync.syncGravlIfNeeded(user)
      await deps.sync.syncRescueTimeIfNeeded(user)
      await deps.sync.syncLastFmIfNeeded(user)
      await deps.sync.syncCalendarsIfNeeded(user)
    } catch (err) {
      auditError(user, 'sync', 'Scheduled sync tick failed for user', { error: String(err) })
    }
  }
  return users.length
}

/* v8 ignore start -- requires real pg-boss instance */
export const createSyncScheduler = async (boss: PgBoss, deps: SyncSchedulerDeps): Promise<void> => {
  await boss.createQueue(QUEUE_NAME)
  await boss.schedule(QUEUE_NAME, SYNC_SCHEDULER_CRON)
  await boss.work(QUEUE_NAME, { batchSize: 1, pollingIntervalSeconds: 30 }, async () => {
    await runScheduledSyncs(deps)
  })
  console.info(`⏱️ Background sync scheduler running (${SYNC_SCHEDULER_CRON})`)
}
/* v8 ignore stop */
