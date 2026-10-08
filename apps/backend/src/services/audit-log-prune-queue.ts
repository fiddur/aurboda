/**
 * Daily audit_log pruning for every user. Login also prunes, but token-only
 * clients (Android app, MCP) never log in with a password, so without this
 * their audit logs grow without bound. The same pass prunes deduction rule
 * runs, which nothing reads back and every rule evaluation appends to.
 */
import type { PgBoss } from './pg-boss.ts'

const QUEUE_NAME = 'audit-log-prune'

export const AUDIT_LOG_PRUNE_CRON = '17 3 * * *'

export const DEDUCTION_RULE_RUN_RETENTION_DAYS = 30

export interface AuditLogPruneDeps {
  getRetentionDays: () => Promise<number>
  listUsers: () => Promise<string[]>
  prune: (user: string, retentionDays: number) => Promise<unknown>
  pruneDeductionRuleRuns: (user: string, retentionDays: number) => Promise<unknown>
}

/** Resolves to the number of users pruned successfully. */
export const pruneAllAuditLogs = async (deps: AuditLogPruneDeps): Promise<number> => {
  const retentionDays = await deps.getRetentionDays()
  const users = await deps.listUsers()
  let pruned = 0
  for (const user of users) {
    try {
      await deps.prune(user, retentionDays)
      await deps.pruneDeductionRuleRuns(user, DEDUCTION_RULE_RUN_RETENTION_DAYS)
      pruned++
    } catch (error) {
      console.error(`⚠️ Audit log prune failed for ${user}:`, error)
    }
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
