import type { ActivityFeatureCondition, AddDeductionRuleBody } from '@aurboda/api-spec'

import type { Queryable } from '../db/pool.ts'

import { withUserTransaction } from '../db/connection.ts'
import { claimSettingsFlagIn, expandActivityTypes, insertDeductionRule } from '../db/index.ts'
import { auditError } from './audit-log.ts'

const feature = (
  name: ActivityFeatureCondition['feature'],
  operator: ActivityFeatureCondition['operator'],
  value: number,
): ActivityFeatureCondition => ({
  activity_type: 'running',
  feature: name,
  kind: 'activity_feature',
  operator,
  value,
})

const categoryRule = (
  name: string,
  category: string,
  conditions: ActivityFeatureCondition[],
): AddDeductionRuleBody => ({
  conditions,
  enabled: true,
  mode: 'enrich',
  name,
  output_activity_type: 'running',
  output_category: category,
  priority: 0,
})

/** "≤ 5 % in zones ≥ 4" has no single feature: zone 4 and zone 5 are capped separately, 3 % + 2 %. */
export const defaultRunCategoryRules: AddDeductionRuleBody[] = [
  categoryRule('Low-HR run', 'low_hr', [
    feature('low_hr_fraction', 'gte', 0.85),
    feature('zone4_fraction', 'lte', 0.03),
    feature('zone5_fraction', 'lte', 0.02),
  ]),
  categoryRule('Interval run', 'intervals', [
    feature('interval_count', 'gte', 3),
    feature('work_block_cv', 'lt', 0.4),
    feature('work_rest_pace_ratio', 'gte', 1.12),
  ]),
  categoryRule('Long run', 'long', [feature('moving_s', 'gte', 5400)]),
  categoryRule('Long run (vs usual)', 'long', [feature('duration_vs_median_90d', 'gte', 1.5)]),
  categoryRule('Tempo run', 'tempo', [
    feature('zone4_fraction', 'gte', 0.5),
    feature('pace_cv', 'lte', 0.15),
  ]),
  categoryRule('Hard run', 'hard', [feature('zone5_fraction', 'gte', 0.4)]),
]

export interface RunCategoryRuleDeps {
  isRunningType: (user: string, activityType: string) => Promise<boolean>
  withTransaction: <T>(user: string, fn: (tx: Queryable) => Promise<T>) => Promise<T>
  /** True only for the one transaction that set the flag. */
  claimSeeding: (tx: Queryable) => Promise<boolean>
  insertDeductionRule: (tx: Queryable, rule: AddDeductionRuleBody) => Promise<unknown>
  reportFailure: (user: string, error: unknown) => void
}

export const defaultRunCategoryRuleDeps: RunCategoryRuleDeps = {
  claimSeeding: (tx) => claimSettingsFlagIn(tx, 'run_category_rules_seeded'),
  insertDeductionRule: (tx, rule) => insertDeductionRule(tx, rule),
  isRunningType: async (user, activityType) =>
    (await expandActivityTypes(user, ['running'])).includes(activityType),
  reportFailure: (user, error) => {
    auditError(user, 'deduction', 'Could not create the default run-category rules', {
      error: error instanceof Error ? error.message : String(error),
    })
  },
  withTransaction: (user, fn) => withUserTransaction(user, fn),
}

/**
 * Creates the default run-category rules once per user, when an activity of `activityType` (a
 * run or a descendant of running) got features; without a type it seeds unconditionally. The
 * settings flag is claimed and the rules inserted in one transaction: concurrent callers cannot
 * both seed, a failed insert gives the claim back, and a user who deletes a seeded rule never
 * gets it back.
 */
export const ensureDefaultRunCategoryRules = async (
  user: string,
  activityType?: string,
  deps: RunCategoryRuleDeps = defaultRunCategoryRuleDeps,
): Promise<{ seeded: number }> => {
  if (activityType !== undefined && !(await deps.isRunningType(user, activityType))) return { seeded: 0 }
  try {
    const seeded = await deps.withTransaction(user, async (tx) => {
      if (!(await deps.claimSeeding(tx))) return 0
      for (const rule of defaultRunCategoryRules) await deps.insertDeductionRule(tx, rule)
      return defaultRunCategoryRules.length
    })
    return { seeded }
  } catch (error) {
    deps.reportFailure(user, error)
    return { seeded: 0 }
  }
}
