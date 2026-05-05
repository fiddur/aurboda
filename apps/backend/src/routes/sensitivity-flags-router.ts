/**
 * REST routes for managing user-defined sensitivity flags
 * (dairy / gluten / alcohol / …). The food-item ↔ flag junction lives on
 * the food-items router (set/clear assignments per food item).
 */
import {
  type AddSensitivityFlagBody,
  addSensitivityFlagBodySchema,
  type DeleteSensitivityFlagResponse,
  type SensitivityFlagResponse,
  type SensitivityFlagsResponse,
  type UpdateSensitivityFlagBody,
  updateSensitivityFlagBodySchema,
} from '@aurboda/api-spec'

import {
  deleteSensitivityFlag,
  insertSensitivityFlag,
  listSensitivityFlags,
  type SensitivityFlag,
  updateSensitivityFlag,
} from '../db/index.ts'
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody } from '../validation.ts'

/** PG error code 23505 = unique_violation. The DB driver surfaces it on `err.code`. */
const isUniqueViolation = (err: unknown): boolean =>
  err instanceof Error && (err as Error & { code?: string }).code === '23505'

const serializeFlag = (f: SensitivityFlag) => ({
  id: f.id,
  name: f.name,
  color: f.color ?? null,
  icon: f.icon ?? null,
  sort_order: f.sort_order,
  created_at: f.created_at.toISOString(),
  updated_at: f.updated_at.toISOString(),
})

export const createSensitivityFlagsRouter = (authMiddleware: AnyMiddleware): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, SensitivityFlagsResponse>('/', authMiddleware, async (req, res) => {
    const flags = await listSensitivityFlags(req.user!)
    res.json({ data: flags.map(serializeFlag), success: true })
  })

  router.post<Record<string, never>, SensitivityFlagResponse, AddSensitivityFlagBody>(
    '/',
    authMiddleware,
    validateBody(addSensitivityFlagBodySchema),
    async (req, res) => {
      try {
        const flag = await insertSensitivityFlag(req.user!, req.body)
        res.status(201).json({ data: serializeFlag(flag), success: true })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Insert failed'
        res.status(isUniqueViolation(err) ? 409 : 500).json({ error: message, success: false })
      }
    },
  )

  router.patch<{ id: string }, SensitivityFlagResponse, UpdateSensitivityFlagBody>(
    '/:id',
    authMiddleware,
    validateBody(updateSensitivityFlagBodySchema),
    async (req, res) => {
      try {
        const flag = await updateSensitivityFlag(req.user!, req.params.id, req.body)
        if (!flag) return res.status(404).json({ error: 'Sensitivity flag not found', success: false })
        res.json({ data: serializeFlag(flag), success: true })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Update failed'
        res.status(isUniqueViolation(err) ? 409 : 500).json({ error: message, success: false })
      }
    },
  )

  router.delete<{ id: string }, DeleteSensitivityFlagResponse>('/:id', authMiddleware, async (req, res) => {
    const deleted = await deleteSensitivityFlag(req.user!, req.params.id)
    if (!deleted) return res.status(404).json({ error: 'Sensitivity flag not found', success: false })
    res.json({ success: true })
  })

  return router
}
