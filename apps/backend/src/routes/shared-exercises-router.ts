import type { RequestHandler } from 'express'

import {
  type CreateSharedExerciseBody,
  createSharedExerciseBodySchema,
  type SharedExerciseResponse,
  type SharedExercisesResponse,
  type UpdateSharedExerciseBody,
  updateSharedExerciseBodySchema,
} from '@aurboda/api-spec'

import {
  createSharedExercise,
  deleteSharedExercise,
  getSharedExerciseById,
  isDuplicateSharedExercise,
  isUnknownSharedExerciseType,
  listSharedExercises,
  updateSharedExercise,
} from '../db/index.ts'
import { serializeSharedExercise } from '../services/shared-exercises.ts'
import { visibilityToIsPublic } from '../services/visibility.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody } from '../validation.ts'

const NOT_FOUND = 'Shared exercise not found'

export const createSharedExercisesRouter = (authMiddleware: RequestHandler, webHost: string): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, SharedExercisesResponse>('/', authMiddleware, async (req, res) => {
    const user = req.user!
    const records = await listSharedExercises(user)
    res.json({ exercises: records.map((r) => serializeSharedExercise(r, webHost, user)), success: true })
  })

  router.post<Record<string, never>, SharedExerciseResponse, CreateSharedExerciseBody>(
    '/',
    authMiddleware,
    validateBody(createSharedExerciseBodySchema),
    async (req, res) => {
      const user = req.user!
      try {
        const record = await createSharedExercise(user, {
          activity_type: req.body.activity_type,
          field: req.body.field,
          is_public: visibilityToIsPublic(req.body.visibility),
          name: req.body.name ?? req.body.value,
          value: req.body.value,
        })
        res.json({ exercise: serializeSharedExercise(record, webHost, user), success: true })
      } catch (error) {
        if (isDuplicateSharedExercise(error)) {
          return res.status(409).json({ error: 'This exercise is already shared', success: false })
        }
        if (isUnknownSharedExerciseType(error)) {
          return res.status(404).json({ error: 'Activity type not found', success: false })
        }
        throw error
      }
    },
  )

  router.get<{ id: string }, SharedExerciseResponse>('/:id', authMiddleware, async (req, res) => {
    const user = req.user!
    const record = await getSharedExerciseById(user, req.params.id)
    if (!record) return res.status(404).json({ error: NOT_FOUND, success: false })
    res.json({ exercise: serializeSharedExercise(record, webHost, user), success: true })
  })

  router.put<{ id: string }, SharedExerciseResponse, UpdateSharedExerciseBody>(
    '/:id',
    authMiddleware,
    validateBody(updateSharedExerciseBodySchema),
    async (req, res) => {
      const user = req.user!
      const record = await updateSharedExercise(user, req.params.id, {
        is_public: req.body.visibility === undefined ? undefined : visibilityToIsPublic(req.body.visibility),
        name: req.body.name,
      })
      if (!record) return res.status(404).json({ error: NOT_FOUND, success: false })
      res.json({ exercise: serializeSharedExercise(record, webHost, user), success: true })
    },
  )

  router.delete<{ id: string }, SharedExerciseResponse>('/:id', authMiddleware, async (req, res) => {
    const user = req.user!
    const deleted = await deleteSharedExercise(user, req.params.id)
    if (!deleted) return res.status(404).json({ error: NOT_FOUND, success: false })
    res.json({ success: true })
  })

  return router
}
