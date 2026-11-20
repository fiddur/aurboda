/**
 * Daily audit_log pruning for every user. Login also prunes, but token-only
 * clients (Android app, MCP) never log in with a password, so without this
 * their audit logs grow without bound. The same pass prunes deduction rule
 * runs, which nothing reads back and every rule evaluation appends to, and
 * outbound sync rows the phone has already written to Health Connect, and
 * comments, check-in forms and check-ins deleted longer ago than they can be
 * restored. It also prunes the server-wide per-user usage counters.
 */
import { DELETED_NOTE_RETENTION_DAYS } from '@aurboda/api-spec'

import type { PgBoss } from './pg-boss.ts'

import { USAGE_RETENTION_DAYS } from './central-user-usage.ts'

const QUEUE_NAME = 'audit-log-prune'

export const AUDIT_LOG_PRUNE_CRON = '17 3 * * *'

export const DEDUCTION_RULE_RUN_RETENTION_DAYS = 30

export const SYNCED_OUTBOUND_SYNC_RETENTION_DAYS = 14

export const DELETED_CHECK_IN_RETENTION_DAYS = 30

export interface AuditLogPruneDeps {
  getRetentionDays: () => Promise<number>
  listUsers: () => Promise<string[]>
  prune: (user: string, retentionDays: number) => Promise<unknown>
  pruneDeductionRuleRuns: (user: string, retentionDays: number) => Promise<unknown>
  pruneDeletedCheckIns: (user: string, retentionDays: number) => Promise<unknown>
  pruneSyncedOutboundSync: (user: string, retentionDays: number) => Promise<unknown>
  pruneDeletedNotes: (user: string, retentionDays: number) => Promise<unknown>
  pruneUsageBefore: (day: Date) => Promise<unknown>
  now?: () => Date
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Resolves to the number of users whose every prune step succeeded. */
export const pruneAllAuditLogs = async (deps: AuditLogPruneDeps): Promise<number> => {
  const now = deps.now?.() ?? new Date()
  try {
    await deps.pruneUsageBefore(new Date(now.getTime() - USAGE_RETENTION_DAYS * DAY_MS))
  } catch (error) {
    console.error('⚠️ Usage counter prune failed:', error)
  }

  const retentionDays = await deps.getRetentionDays()
  const users = await deps.listUsers()
  const steps: [string, (user: string) => Promise<unknown>][] = [
    ['Audit log', (user) => deps.prune(user, retentionDays)],
    ['Deduction rule run', (user) => deps.pruneDeductionRuleRuns(user, DEDUCTION_RULE_RUN_RETENTION_DAYS)],
    ['Outbound sync', (user) => deps.pruneSyncedOutboundSync(user, SYNCED_OUTBOUND_SYNC_RETENTION_DAYS)],
    ['Deleted note', (user) => deps.pruneDeletedNotes(user, DELETED_NOTE_RETENTION_DAYS)],
    ['Deleted check-in', (user) => deps.pruneDeletedCheckIns(user, DELETED_CHECK_IN_RETENTION_DAYS)],
  ]
  let pruned = 0
  for (const user of users) {
    let ok = true
    for (const [label, step] of steps) {
      try {
        await step(user)
      } catch (error) {
        ok = false
        console.error(`⚠️ ${label} prune failed for ${user}:`, error)
      }
    }
    if (ok) pruned++
  }
  return pruned
}

/* v8 ignore start -- requires real pg-boss instance */
export const createAuditLogPruneQueue = async (boss: PgBoss, deps: AuditLogPruneDeps): Promise<void> => {
  await boss.createQueue(QUEUE_NAME)
  await boss.schedule(QUEUE_NAME, AUDIT_LOG_PRUNE_CRON)
  await boss.work(QUEUE_NAME, { batchSize: 1, pollingIntervalSeconds: 60 }, async () => {
    const pruned = await pruneAllAuditLogs(deps)
    console.info(`🧹 Pruned audit log for ${pruned} user(s)`)
  })
  console.info(`🧹 Audit log prune scheduled (${AUDIT_LOG_PRUNE_CRON})`)
}
/* v8 ignore stop */
