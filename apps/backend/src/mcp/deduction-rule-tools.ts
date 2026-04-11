/**
 * MCP deduction rule management tools.
 */
import { addDeductionRuleBodySchema, updateDeductionRuleBodySchema } from '@aurboda/api-spec'
import { z } from 'zod'

import type { DeductionEngineDeps } from '../services/deduction-engine.ts'
import type { DeductionQueue } from '../services/deduction-queue.ts'

import {
  activityTypeExists,
  deleteDeductionRule,
  deleteRuleActivities,
  getDeductionRules,
  getEnabledDeductionRules,
  insertDeductionRule,
  updateDeductionRule,
} from '../db/index.ts'
import { evaluateAllRules } from '../services/deduction-engine.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

export const registerDeductionRuleTools = (
  server: McpServer,
  user: string,
  engineDeps: DeductionEngineDeps,
  deductionQueue?: DeductionQueue,
) => {
  server.tool(
    'list_deduction_rules',
    'List all deduction rules. Rules automatically create or enrich activities when data conditions are met.',
    {},
    async () => {
      const rules = await getDeductionRules(user)
      return jsonResponse(rules)
    },
  )

  server.tool(
    'add_deduction_rule',
    `Create a deduction rule that automatically creates or enriches activities from data conditions.

Condition kinds:
- "activity": matches when an activity of the given type exists
- "tag": matches when a tag with the given name exists
- "screentime_category": matches productivity records in a category path
- "activity_data": matches when an activity has a specific data field value (operators: eq, neq, exists, not_exists)
- "location": matches when the user is at a named location

Modes:
- "create" (default): creates new activities of output_activity_type
- "enrich": patches output_data onto existing activities of output_activity_type (only fills missing fields)

Use output_data to set custom data fields on created/enriched activities.
Multiple conditions use AND logic — all must overlap in time. The rule is applied retroactively to all historical data.`,
    { ...addDeductionRuleBodySchema.shape },
    async (params) => {
      if (!(await activityTypeExists(user, params.output_activity_type))) {
        return errorResponse(
          `Unknown activity type: "${params.output_activity_type}". Create it first with add_activity_type.`,
        )
      }

      const rule = await insertDeductionRule(user, params)

      // Queue async retroactive evaluation
      if (deductionQueue) {
        deductionQueue.enqueueRuleCrud({ user, rule_ids: [rule.id], mode: 'created' })
      }

      return jsonResponse({
        ...rule,
        evaluation_status: deductionQueue ? 'queued' : 'unavailable',
      })
    },
  )

  server.tool(
    'update_deduction_rule',
    'Update a deduction rule. Automatically re-evaluates retroactively after update.',
    {
      id: z.string().uuid().describe('ID of the rule to update'),
      ...updateDeductionRuleBodySchema.shape,
    },
    async ({ id, ...updates }) => {
      if (updates.output_activity_type && !(await activityTypeExists(user, updates.output_activity_type))) {
        return errorResponse(`Unknown activity type: "${updates.output_activity_type}"`)
      }

      const updated = await updateDeductionRule(user, id, updates)
      if (!updated) return errorResponse('Deduction rule not found')

      // Queue async re-evaluation
      if (updated.enabled && deductionQueue) {
        deductionQueue.enqueueRuleCrud({
          user,
          rule_ids: [updated.id],
          mode: 'updated',
          cleanup_rule_ids: [id],
        })
      } else if (!updated.enabled) {
        await deleteRuleActivities(user, id)
      }

      return jsonResponse(updated)
    },
  )

  server.tool(
    'delete_deduction_rule',
    'Delete a deduction rule and all activities it created.',
    { id: z.string().uuid().describe('ID of the rule to delete') },
    async ({ id }) => {
      await deleteRuleActivities(user, id)
      const deleted = await deleteDeductionRule(user, id)
      if (!deleted) return errorResponse('Deduction rule not found')
      return jsonResponse({ deleted: true, id })
    },
  )

  server.tool(
    'evaluate_deduction_rules',
    'Manually trigger evaluation of all enabled deduction rules over all historical data. Cleans up stale activities and re-evaluates from scratch.',
    {},
    async () => {
      const rules = await getEnabledDeductionRules(user)

      if (deductionQueue) {
        deductionQueue.enqueueRuleCrud({
          cleanup_rule_ids: rules.map((r) => r.id),
          mode: 'evaluate_all',
          rule_ids: rules.map((r) => r.id),
          user,
        })
      }

      return jsonResponse({
        evaluation_status: deductionQueue ? 'queued' : 'unavailable',
        rules_queued: rules.length,
      })
    },
  )

  server.tool(
    'preview_deduction_rule',
    'Dry-run a rule definition to see how many activities would be affected without creating or modifying anything. Samples the last 90 days.',
    { ...addDeductionRuleBodySchema.shape },
    async (params) => {
      if (!(await activityTypeExists(user, params.output_activity_type))) {
        return errorResponse(`Unknown activity type: "${params.output_activity_type}"`)
      }

      // Create a temporary rule object for evaluation (no DB insert)
      const tempRule = {
        conditions: params.conditions,
        enabled: true,
        id: 'preview',
        merge_gap_seconds: params.merge_gap_seconds,
        mode: params.mode,
        name: params.name,
        output_activity_type: params.output_activity_type,
        output_data: params.output_data as Record<string, unknown> | undefined,
        output_title: params.output_title,
        priority: params.priority ?? 0,
      }

      const window = { end: new Date(), start: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }
      const result = await evaluateAllRules(user, [tempRule], window, engineDeps, true)

      return jsonResponse({ sample_days: 90, success: true, would_affect: result.activities_created })
    },
  )
}
