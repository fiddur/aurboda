/**
 * Deduction rule evaluation queue using pg-boss.
 *
 * Two queues:
 * - `deduction-eval`: Batched evaluation triggered by activity modifications (~10s polling)
 * - `deduction-rule-crud`: One-shot evaluation for rule create/update (~2s polling)
 *
 * Jobs persist across server restarts via PostgreSQL.
 */

import type { DeductionRule } from '@aurboda/api-spec'

import type { DeductionEngineDeps, EvaluationWindow } from './deduction-engine.ts'
import type { Job, PgBoss } from './pg-boss.ts'

import { auditError, auditInfo } from './audit-log.ts'

// ============================================================================
// Types
// ============================================================================

export interface DeductionEvalJobData {
  user: string
  activity_type: string // '*' = evaluate all rules (e.g. sync completion)
  window_start: string // ISO string
  window_end: string // ISO string
  source_rule_id?: string
}

export interface RuleCrudJobData {
  user: string
  rule_ids: string[]
  mode: 'created' | 'updated' | 'evaluate_all'
  cleanup_rule_ids?: string[] // Rules whose activities to delete before evaluating
}

export interface DeductionQueue {
  enqueueEvaluation: (data: DeductionEvalJobData) => Promise<void>
  enqueueRuleCrud: (data: RuleCrudJobData) => Promise<void>
}

/**
 * Callback fired when an activity is created or modified.
 * Enqueues a deduction evaluation job.
 */
export type ActivityNotifier = (
  user: string,
  activityType: string,
  start: Date,
  end: Date,
  sourceRuleId?: string,
) => void

export interface DeductionQueueDeps {
  getEnabledRules: (user: string) => Promise<DeductionRule[]>
  getDeductionRules: (user: string, ids: string[]) => Promise<DeductionRule[]>
  evaluateAllRules: (
    user: string,
    rules: DeductionRule[],
    window: EvaluationWindow,
    deps: DeductionEngineDeps,
  ) => Promise<{ rules_evaluated: number; activities_created: number }>
  deleteRuleActivities: (user: string, ruleId: string) => Promise<number>
  buildFullWindow: (user: string) => Promise<EvaluationWindow>
  engineDeps: DeductionEngineDeps
}

// ============================================================================
// Configuration
// ============================================================================

const EVAL_QUEUE = 'deduction-eval'
const CRUD_QUEUE = 'deduction-rule-crud'
const WINDOW_BUFFER_MS = 60 * 60 * 1000 // 1 hour buffer on each side

// ============================================================================
// Batch processing helpers
// ============================================================================

interface MergedEvaluation {
  window: EvaluationWindow
  excludeRuleIds: Set<string>
}

/**
 * Group eval jobs by user and merge their windows + source rule IDs.
 */
export const groupEvalJobs = (jobs: Job<DeductionEvalJobData>[]): Map<string, MergedEvaluation> => {
  const byUser = new Map<string, MergedEvaluation>()

  for (const job of jobs) {
    const { user, window_start, window_end, source_rule_id } = job.data
    const start = new Date(window_start)
    const end = new Date(window_end)

    const existing = byUser.get(user)
    if (existing) {
      // Merge: widen window, collect source rule IDs
      if (start < existing.window.start) existing.window.start = start
      if (end > existing.window.end) existing.window.end = end
      if (source_rule_id) existing.excludeRuleIds.add(source_rule_id)
    } else {
      const excludeRuleIds = new Set<string>()
      if (source_rule_id) excludeRuleIds.add(source_rule_id)
      byUser.set(user, { excludeRuleIds, window: { end, start } })
    }
  }

  return byUser
}

/**
 * Expand a window by the buffer on each side.
 */
const expandWindow = (window: EvaluationWindow): EvaluationWindow => ({
  end: new Date(window.end.getTime() + WINDOW_BUFFER_MS),
  start: new Date(window.start.getTime() - WINDOW_BUFFER_MS),
})

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a deduction evaluation queue using a shared pg-boss instance.
 */
/* v8 ignore start -- requires real pg-boss instance */
export const createDeductionQueue = async (
  boss: PgBoss,
  deps: DeductionQueueDeps,
): Promise<DeductionQueue> => {
  // Create both queues
  await boss.createQueue(EVAL_QUEUE)
  await boss.createQueue(CRUD_QUEUE)

  // --------------------------------------------------------------------------
  // Activity-triggered evaluation worker (batched, ~10s polling)
  // --------------------------------------------------------------------------
  await boss.work<DeductionEvalJobData>(
    EVAL_QUEUE,
    { batchSize: 100, pollingIntervalSeconds: 10 },
    async (jobs) => {
      const grouped = groupEvalJobs(jobs)

      for (const [user, { excludeRuleIds, window }] of grouped) {
        try {
          const allRules = await deps.getEnabledRules(user)
          const rules = excludeRuleIds.size > 0 ? allRules.filter((r) => !excludeRuleIds.has(r.id)) : allRules

          if (rules.length === 0) continue

          const expanded = expandWindow(window)
          const result = await deps.evaluateAllRules(user, rules, expanded, deps.engineDeps)

          auditInfo(user, 'deduction', '🔄 Auto-evaluation completed', {
            activities_created: result.activities_created,
            excluded_rules: [...excludeRuleIds],
            rules_evaluated: result.rules_evaluated,
            window_end: expanded.end.toISOString(),
            window_start: expanded.start.toISOString(),
          })
        } catch (err) {
          auditError(user, 'deduction', 'Auto-evaluation failed', { error: String(err) })
        }
      }
    },
  )

  // --------------------------------------------------------------------------
  // Rule CRUD evaluation worker (immediate, ~2s polling)
  // --------------------------------------------------------------------------
  await boss.work<RuleCrudJobData>(CRUD_QUEUE, { batchSize: 1, pollingIntervalSeconds: 2 }, async (jobs) => {
    for (const job of jobs) {
      const { user, rule_ids, mode, cleanup_rule_ids } = job.data

      try {
        // Clean up old activities if requested
        if (cleanup_rule_ids) {
          for (const ruleId of cleanup_rule_ids) {
            await deps.deleteRuleActivities(user, ruleId)
          }
        }

        // Get the rules to evaluate
        let rules: DeductionRule[]
        if (mode === 'evaluate_all') {
          rules = await deps.getEnabledRules(user)
        } else {
          rules = await deps.getDeductionRules(user, rule_ids)
          rules = rules.filter((r) => r.enabled)
        }

        if (rules.length === 0) continue

        const window = await deps.buildFullWindow(user)
        const result = await deps.evaluateAllRules(user, rules, window, deps.engineDeps)

        auditInfo(user, 'deduction', `📋 Rule ${mode} evaluation completed`, {
          activities_created: result.activities_created,
          mode,
          rule_ids,
          rules_evaluated: result.rules_evaluated,
        })
      } catch (err) {
        auditError(user, 'deduction', `Rule ${mode} evaluation failed`, {
          error: String(err),
          rule_ids,
        })
      }
    }
  })

  console.log('🧠 Deduction evaluation queue ready')

  return {
    enqueueEvaluation: async (data: DeductionEvalJobData): Promise<void> => {
      try {
        await boss.send(EVAL_QUEUE, data, {
          retryLimit: 2,
        })
      } catch (err) {
        auditError(data.user, 'deduction', 'Failed to enqueue evaluation', { error: String(err) })
      }
    },

    enqueueRuleCrud: async (data: RuleCrudJobData): Promise<void> => {
      try {
        await boss.send(CRUD_QUEUE, data, {
          retryLimit: 2,
        })
      } catch (err) {
        auditError(data.user, 'deduction', 'Failed to enqueue rule CRUD evaluation', { error: String(err) })
      }
    },
  }
}
/* v8 ignore stop */
