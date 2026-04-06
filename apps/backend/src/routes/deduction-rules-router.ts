import type { RequestHandler, Router } from 'express'

/**
 * Deduction rules route group.
 *
 * Handles: /deduction-rules/*
 */
import {
  type AddDeductionRuleBody,
  addDeductionRuleBodySchema,
  type DeductionRuleResponse,
  type DeductionRulesResponse,
  type EvaluateDeductionRulesResponse,
  type UpdateDeductionRuleBody,
  updateDeductionRuleBodySchema,
} from '@aurboda/api-spec'

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
import { typedRouter } from '../typed-router.ts'
import { validateBody } from '../validation.ts'

export const createDeductionRulesRouter = (
  authMiddleware: RequestHandler,
  engineDeps: DeductionEngineDeps,
): Router => {
  const router = typedRouter()

  // GET / - List all deduction rules
  router.get<Record<string, string>, DeductionRulesResponse>('/', authMiddleware, async (req, res) => {
    const user = req.user!
    const rules = await getDeductionRules(user)
    res.json({ data: rules, success: true })
  })

  // POST / - Create a deduction rule
  router.post<Record<string, string>, DeductionRuleResponse, AddDeductionRuleBody>(
    '/',
    authMiddleware,
    validateBody(addDeductionRuleBodySchema),
    async (req, res) => {
      const user = req.user!
      const { name, conditions, output_activity_type, output_title, merge_gap_seconds, priority, enabled } =
        req.body

      // Validate output activity type exists
      if (!(await activityTypeExists(user, output_activity_type))) {
        return res
          .status(400)
          .json({ error: `Unknown activity type: "${output_activity_type}"`, success: false })
      }

      const rule = await insertDeductionRule(user, {
        conditions,
        enabled,
        merge_gap_seconds,
        name,
        output_activity_type,
        output_title,
        priority,
      })

      // Retroactive evaluation: apply rule to last 90 days
      const window = {
        end: new Date(),
        start: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      }
      await evaluateAllRules(user, [rule], window, engineDeps)

      res.status(201).json({ data: rule, success: true })
    },
  )

  // PATCH /:id - Update a deduction rule
  router.patch<{ id: string }, DeductionRuleResponse, UpdateDeductionRuleBody>(
    '/:id',
    authMiddleware,
    validateBody(updateDeductionRuleBodySchema),
    async (req, res) => {
      const { id } = req.params
      const user = req.user!

      if (req.body.output_activity_type && !(await activityTypeExists(user, req.body.output_activity_type))) {
        return res
          .status(400)
          .json({ error: `Unknown activity type: "${req.body.output_activity_type}"`, success: false })
      }

      const updated = await updateDeductionRule(user, id, req.body)
      if (!updated) {
        return res.status(404).json({ error: 'Deduction rule not found', success: false })
      }

      // Re-evaluate retroactively
      await deleteRuleActivities(user, id)
      if (updated.enabled) {
        const window = {
          end: new Date(),
          start: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        }
        await evaluateAllRules(user, [updated], window, engineDeps)
      }

      res.json({ data: updated, success: true })
    },
  )

  // DELETE /:id - Delete a deduction rule
  router.delete<{ id: string }, DeductionRuleResponse>('/:id', authMiddleware, async (req, res) => {
    const { id } = req.params
    const user = req.user!

    // Delete activities produced by this rule first
    await deleteRuleActivities(user, id)

    const deleted = await deleteDeductionRule(user, id)
    if (!deleted) {
      return res.status(404).json({ error: 'Deduction rule not found', success: false })
    }

    res.json({ success: true })
  })

  // POST /evaluate - Manually trigger rule evaluation
  router.post<Record<string, string>, EvaluateDeductionRulesResponse>(
    '/evaluate',
    authMiddleware,
    async (req, res) => {
      const user = req.user!
      const rules = await getEnabledDeductionRules(user)

      const window = {
        end: new Date(),
        start: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      }

      // Delete all rule-generated activities and re-evaluate fresh
      for (const rule of rules) {
        await deleteRuleActivities(user, rule.id)
      }

      const result = await evaluateAllRules(user, rules, window, engineDeps)
      res.json({ ...result, success: true })
    },
  )

  return router as unknown as Router
}
