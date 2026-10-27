import type { ActivityFeatureCondition, AddDeductionRuleBody } from '@aurboda/api-spec'

import { claimSettingsFlag, insertDeductionRule } from '../db/index.ts'
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

/** "≤ 5 % in zones ≥ 4" has no single feature, so zone 4 and zone 5 are capped separately. */
export const defaultRunCategoryRules: AddDeductionRuleBody[] = [
  categoryRule('Low-HR run', 'low_hr', [
    feature('low_hr_fraction', 'gte', 0.85),
    feature('zone4_fraction', 'lte', 0.05),
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
  /** True only for the one caller that set the flag. */
  claimSeeding: (user: string) => Promise<boolean>
  insertDeductionRule: (user: string, rule: AddDeductionRuleBody) => Promise<unknown>
  reportFailure: (user: string, error: unknown) => void
}

export const defaultRunCategoryRuleDeps: RunCategoryRuleDeps = {
  claimSeeding: (user) => claimSettingsFlag(user, 'run_category_rules_seeded'),
  insertDeductionRule,
  reportFailure: (user, error) => {
    auditError(user, 'deduction', 'Could not create the default run-category rules', {
      error: error instanceof Error ? error.message : String(error),
    })
  },
}

/**
 * Creates the default run-category rules once per user. The settings flag is claimed first, so
 * concurrent callers cannot both seed, and a user who deletes a seeded rule never gets it back.
 * A failed insert is reported and not retried: the flag is already set.
 */
export const ensureDefaultRunCategoryRules = async (
  user: string,
  deps: RunCategoryRuleDeps = defaultRunCategoryRuleDeps,
): Promise<{ seeded: number }> => {
  if (!(await deps.claimSeeding(user))) return { seeded: 0 }
  let seeded = 0
  try {
    for (const rule of defaultRunCategoryRules) {
      await deps.insertDeductionRule(user, rule)
      seeded++
    }
  } catch (error) {
    deps.reportFailure(user, error)
  }
  return { seeded }
}
