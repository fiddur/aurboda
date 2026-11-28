import type { PreviewDeductionRuleBody } from '@aurboda/api-spec'

import type { DeductionEngineDeps } from './deduction-engine.ts'

import { activityTypeExists, getDeductionRule } from '../db/index.ts'
import { activityPeopleError } from './activity-people.ts'
import { getCatalogActivityType, loadActivityTypeCatalog } from './activity-type-catalog.ts'
import { evaluateAllRules } from './deduction-engine.ts'
import { validateRuleShape } from './media-plays.ts'

const SAMPLE_DAYS = 90

export type DeductionRulePreview =
  | { status: 'not_found'; error: string }
  | { status: 'invalid'; error: string }
  | { status: 'ok'; sample_days: number; would_affect: number }

/**
 * Dry-runs `body` over the last 90 days. An edit (`rule_id`) runs under the saved rule's id, so it
 * reads what that rule already decided; a new rule runs under the id `preview`.
 */
export const previewDeductionRule = async (
  user: string,
  body: PreviewDeductionRuleBody,
  engineDeps: DeductionEngineDeps,
): Promise<DeductionRulePreview> => {
  if (body.rule_id && !(await getDeductionRule(user, body.rule_id))) {
    return { error: 'Deduction rule not found', status: 'not_found' }
  }
  if (
    !(await activityTypeExists(user, body.output_activity_type)) &&
    !getCatalogActivityType(loadActivityTypeCatalog(), body.output_activity_type)
  ) {
    return { error: `Unknown activity type: "${body.output_activity_type}"`, status: 'invalid' }
  }
  const ruleShapeError = validateRuleShape(body)
  if (ruleShapeError) return { error: ruleShapeError, status: 'invalid' }
  const peopleError = await activityPeopleError(user, body.output_people)
  if (peopleError) return { error: peopleError, status: 'invalid' }

  const tempRule = {
    conditions: body.conditions,
    enabled: true,
    id: body.rule_id ?? 'preview',
    merge_gap_seconds: body.merge_gap_seconds,
    mode: body.mode,
    name: body.name,
    output_activity_type: body.output_activity_type,
    output_category: body.output_category,
    output_data: body.output_data as Record<string, unknown> | undefined,
    output_media_field: body.output_media_field,
    output_people: body.output_people,
    output_title: body.output_title,
    output_title_field: body.output_title_field,
    priority: body.priority ?? 0,
  }
  const window = { end: new Date(), start: new Date(Date.now() - SAMPLE_DAYS * 24 * 60 * 60 * 1000) }
  const result = await evaluateAllRules(user, [tempRule], window, engineDeps, true)
  return { sample_days: SAMPLE_DAYS, status: 'ok', would_affect: result.activities_created }
}
