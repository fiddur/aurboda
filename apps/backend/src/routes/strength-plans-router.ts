import {
  type BaseResponse,
  type CreateStrengthPlanBody,
  createStrengthPlanBodySchema,
  type StrengthPlanResponse,
  type StrengthPlansQuery,
  strengthPlansQuerySchema,
  type StrengthPlansResponse,
  type UpdateStrengthPlanBody,
  updateStrengthPlanBodySchema,
} from '@aurboda/api-spec'

import { createStrengthPlansService, type StrengthPlansService } from '../services/strength-plans.ts'
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody, validateQuery } from '../validation.ts'

export const createStrengthPlansRouter = (
  authMiddleware: AnyMiddleware,
  service: StrengthPlansService = createStrengthPlansService(),
): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, StrengthPlansResponse, unknown, StrengthPlansQuery>(
    '/',
    authMiddleware,
    validateQuery(strengthPlansQuerySchema),
    async (req, res) => {
      res.json({ data: await service.list(req.user!, req.query.status), success: true })
    },
  )

  router.post<Record<string, never>, StrengthPlanResponse, CreateStrengthPlanBody>(
    '/',
    authMiddleware,
    validateBody(createStrengthPlanBodySchema),
    async (req, res) => {
      const result = await service.create(req.user!, req.body)
      if (!result.success) return res.status(result.status).json({ error: result.error, success: false })
      res.status(201).json({ data: result.data, success: true })
    },
  )

  router.get<{ id: string }, StrengthPlanResponse>('/:id', authMiddleware, async (req, res) => {
    const result = await service.get(req.user!, req.params.id)
    if (!result.success) return res.status(result.status).json({ error: result.error, success: false })
    res.json({ data: result.data, success: true })
  })

  router.patch<{ id: string }, StrengthPlanResponse, UpdateStrengthPlanBody>(
    '/:id',
    authMiddleware,
    validateBody(updateStrengthPlanBodySchema),
    async (req, res) => {
      const result = await service.update(req.user!, req.params.id, req.body)
      if (!result.success) return res.status(result.status).json({ error: result.error, success: false })
      res.json({ data: result.data, success: true })
    },
  )

  router.delete<{ id: string }, BaseResponse>('/:id', authMiddleware, async (req, res) => {
    const result = await service.remove(req.user!, req.params.id)
    if (!result.success) return res.status(result.status).json({ error: result.error, success: false })
    res.json({ success: true })
  })

  return router
}
