/**
 * MCP deduction rule management tools.
 */
import { addDeductionRuleBodySchema, updateDeductionRuleBodySchema } from '@aurboda/api-spec'
import { z } from 'zod'

import type { DeductionEngineDeps } from '../services/deduction-engine.ts'

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
) => {
  server.tool(
    'list_deduction_rules',
    'List all deduction rules. Rules automatically create activities when data conditions are met.',
    {},
    async () => {
      const rules = await getDeductionRules(user)
      return jsonResponse(rules)
    },
  )

  server.tool(
    'add_deduction_rule',
    `Create a deduction rule that automatically creates activities from data conditions.

Condition kinds:
- "activity": matches when an activity of the given type exists (e.g. {kind: "activity", activity_type: "meditation"})
- "tag": matches when a tag with the given name exists (e.g. {kind: "tag", tag_name: "sauna"})
- "screentime_category": matches productivity records in a category (e.g. {kind: "screentime_category", category: ["Work", "Programming"]})

Multiple conditions use AND logic — all must overlap in time. The rule is applied retroactively to the last 90 days.`,
    { ...addDeductionRuleBodySchema.shape },
    async (params) => {
      if (!(await activityTypeExists(user, params.output_activity_type))) {
        return errorResponse(
          `Unknown activity type: "${params.output_activity_type}". Create it first with add_activity_type.`,
        )
      }

      const rule = await insertDeductionRule(user, params)

      // Retroactive evaluation
      const window = { end: new Date(), start: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }
      const result = await evaluateAllRules(user, [rule], window, engineDeps)

      return jsonResponse({ ...rule, retroactive_activities_created: result.activities_created })
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

      // Re-evaluate retroactively
      await deleteRuleActivities(user, id)
      if (updated.enabled) {
        const window = { end: new Date(), start: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }
        await evaluateAllRules(user, [updated], window, engineDeps)
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
    'Manually trigger evaluation of all enabled deduction rules over the last 90 days. Cleans up stale activities and re-evaluates from scratch.',
    {},
    async () => {
      const rules = await getEnabledDeductionRules(user)
      const window = { end: new Date(), start: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }

      for (const rule of rules) {
        await deleteRuleActivities(user, rule.id)
      }

      const result = await evaluateAllRules(user, rules, window, engineDeps)
      return jsonResponse(result)
    },
  )
}
