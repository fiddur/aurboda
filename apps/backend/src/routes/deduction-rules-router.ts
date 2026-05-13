import type { RequestHandler } from 'express'

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
  type PreviewDeductionRuleResponse,
  type UpdateDeductionRuleBody,
  updateDeductionRuleBodySchema,
} from '@aurboda/api-spec'

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
import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody } from '../validation.ts'

export const createDeductionRulesRouter = (
  authMiddleware: RequestHandler,
  engineDeps: DeductionEngineDeps,
  deductionQueue?: DeductionQueue,
): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, DeductionRulesResponse>('/', authMiddleware, async (req, res) => {
    const user = req.user!
    const rules = await getDeductionRules(user)
    res.json({ data: rules, success: true })
  })

  router.post<Record<string, never>, DeductionRuleResponse, AddDeductionRuleBody>(
    '/',
    authMiddleware,
    validateBody(addDeductionRuleBodySchema),
    async (req, res) => {
      const user = req.user!
      const {
        name,
        conditions,
        output_activity_type,
        output_title,
        merge_gap_seconds,
        priority,
        enabled,
        mode,
        output_data,
      } = req.body

      if (!(await activityTypeExists(user, output_activity_type))) {
        return res
          .status(400)
          .json({ error: `Unknown activity type: "${output_activity_type}"`, success: false })
      }

      const rule = await insertDeductionRule(user, {
        conditions,
        enabled,
        merge_gap_seconds,
        mode,
        name,
        output_activity_type,
        output_data: output_data as Record<string, unknown> | undefined,
        output_title,
        priority,
      })

      // Queue async retroactive evaluation over full history
      if (deductionQueue) {
        deductionQueue.enqueueRuleCrud({ user, rule_ids: [rule.id], mode: 'created' })
      }

      res.status(201).json({ data: rule, success: true })
    },
  )

  router.post<Record<string, never>, PreviewDeductionRuleResponse, AddDeductionRuleBody>(
    '/preview',
    authMiddleware,
    validateBody(addDeductionRuleBodySchema),
    async (req, res) => {
      const user = req.user!
      const { output_activity_type } = req.body

      if (!(await activityTypeExists(user, output_activity_type))) {
        return res.status(400).json({
          error: `Unknown activity type: "${output_activity_type}"`,
          sample_days: 0,
          success: false,
          would_affect: 0,
        })
      }

      const tempRule = {
        conditions: req.body.conditions,
        enabled: true,
        id: 'preview',
        merge_gap_seconds: req.body.merge_gap_seconds,
        mode: req.body.mode,
        name: req.body.name,
        output_activity_type,
        output_data: req.body.output_data as Record<string, unknown> | undefined,
        output_title: req.body.output_title,
        priority: req.body.priority ?? 0,
      }

      const window = { end: new Date(), start: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }
      const result = await evaluateAllRules(user, [tempRule], window, engineDeps, true)

      res.json({ sample_days: 90, success: true, would_affect: result.activities_created })
    },
  )

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

      // Queue async re-evaluation over full history
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

      res.json({ data: updated, success: true })
    },
  )

  router.delete<{ id: string }, DeductionRuleResponse>('/:id', authMiddleware, async (req, res) => {
    const { id } = req.params
    const user = req.user!

    await deleteRuleActivities(user, id)

    const deleted = await deleteDeductionRule(user, id)
    if (!deleted) {
      return res.status(404).json({ error: 'Deduction rule not found', success: false })
    }

    res.json({ success: true })
  })

  router.post<Record<string, never>, EvaluateDeductionRulesResponse>(
    '/evaluate',
    authMiddleware,
    async (req, res) => {
      const user = req.user!
      const rules = await getEnabledDeductionRules(user)

      if (deductionQueue) {
        deductionQueue.enqueueRuleCrud({
          cleanup_rule_ids: rules.map((r) => r.id),
          mode: 'evaluate_all',
          rule_ids: rules.map((r) => r.id),
          user,
        })
      }

      res.json({ rules_evaluated: rules.length, success: true })
    },
  )

  return router
}
