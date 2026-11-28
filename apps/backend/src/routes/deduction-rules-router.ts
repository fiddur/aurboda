import type { RequestHandler } from 'express'

import {
  type AddDeductionRuleBody,
  addDeductionRuleBodySchema,
  type DeductionRuleResponse,
  type DeductionRulesResponse,
  type EvaluateDeductionRulesResponse,
  type PreviewDeductionRuleBody,
  previewDeductionRuleBodySchema,
  type PreviewDeductionRuleResponse,
  type UpdateDeductionRuleBody,
  updateDeductionRuleBodySchema,
} from '@aurboda/api-spec'

import type { DeductionEngineDeps } from '../services/deduction-engine.ts'
import type { DeductionQueue } from '../services/deduction-queue.ts'

import {
  deleteDeductionRule,
  ensureActivityType,
  getDeductionRule,
  getDeductionRules,
  getEnabledDeductionRules,
  insertDeductionRule,
  updateDeductionRule,
} from '../db/index.ts'
import { activityPeopleError } from '../services/activity-people.ts'
import { removeCategoriesOfNonCategorisingRule } from '../services/deduction-category.ts'
import { removeRuleActivities } from '../services/deduction-rule-activities.ts'
import { previewDeductionRule } from '../services/deduction-rule-preview.ts'
import { mergeRuleUpdate, validateRuleShape } from '../services/media-plays.ts'
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
        output_category,
        output_data,
        output_media_field,
        output_people,
        output_title_field,
      } = req.body

      if (!(await ensureActivityType(user, output_activity_type))) {
        return res
          .status(400)
          .json({ error: `Unknown activity type: "${output_activity_type}"`, success: false })
      }

      const ruleShapeError = validateRuleShape(req.body)
      if (ruleShapeError) return res.status(400).json({ error: ruleShapeError, success: false })
      const peopleError = await activityPeopleError(user, output_people)
      if (peopleError) return res.status(400).json({ error: peopleError, success: false })

      const rule = await insertDeductionRule(user, {
        conditions,
        enabled,
        merge_gap_seconds,
        mode,
        name,
        output_activity_type,
        output_category,
        output_data: output_data as Record<string, unknown> | undefined,
        output_media_field,
        output_people,
        output_title,
        output_title_field,
        priority,
      })

      // Queue async retroactive evaluation over full history
      if (deductionQueue) {
        deductionQueue.enqueueRuleCrud({ user, rule_ids: [rule.id], mode: 'created' })
      }

      res.status(201).json({ data: rule, success: true })
    },
  )

  router.post<Record<string, never>, PreviewDeductionRuleResponse, PreviewDeductionRuleBody>(
    '/preview',
    authMiddleware,
    validateBody(previewDeductionRuleBodySchema),
    async (req, res) => {
      const preview = await previewDeductionRule(req.user!, req.body, engineDeps)
      if (preview.status !== 'ok') {
        return res
          .status(preview.status === 'not_found' ? 404 : 400)
          .json({ error: preview.error, sample_days: 0, success: false, would_affect: 0 })
      }
      res.json({ sample_days: preview.sample_days, success: true, would_affect: preview.would_affect })
    },
  )

  router.patch<{ id: string }, DeductionRuleResponse, UpdateDeductionRuleBody>(
    '/:id',
    authMiddleware,
    validateBody(updateDeductionRuleBodySchema),
    async (req, res) => {
      const { id } = req.params
      const user = req.user!

      if (req.body.output_activity_type && !(await ensureActivityType(user, req.body.output_activity_type))) {
        return res
          .status(400)
          .json({ error: `Unknown activity type: "${req.body.output_activity_type}"`, success: false })
      }

      const existing = await getDeductionRule(user, id)
      if (!existing) {
        return res.status(404).json({ error: 'Deduction rule not found', success: false })
      }
      const ruleShapeError = validateRuleShape(mergeRuleUpdate(existing, req.body))
      if (ruleShapeError) return res.status(400).json({ error: ruleShapeError, success: false })
      const peopleError = await activityPeopleError(user, req.body.output_people ?? undefined)
      if (peopleError) return res.status(400).json({ error: peopleError, success: false })

      const updated = await updateDeductionRule(user, id, req.body)
      if (!updated) {
        return res.status(404).json({ error: 'Deduction rule not found', success: false })
      }
      await removeCategoriesOfNonCategorisingRule(user, updated)

      // Queue async re-evaluation over full history
      if (updated.enabled && deductionQueue) {
        deductionQueue.enqueueRuleCrud({
          user,
          rule_ids: [updated.id],
          mode: 'updated',
          cleanup_rule_ids: [id],
        })
      } else if (!updated.enabled) {
        await removeRuleActivities(user, id)
      }

      res.json({ data: updated, success: true })
    },
  )

  router.delete<{ id: string }, DeductionRuleResponse>('/:id', authMiddleware, async (req, res) => {
    const { id } = req.params
    const user = req.user!

    await removeRuleActivities(user, id)

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
