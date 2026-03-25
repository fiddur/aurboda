/**
 * Meals route group.
 *
 * Handles: /meals/*
 */
import {
  addMealBodySchema,
  type DeleteMealResponse,
  type MealResponse,
  type MealsQuery,
  mealsQuerySchema,
  type MealsResponse,
  type UpdateMealBody,
  updateMealBodySchema,
} from '@aurboda/api-spec'
import { type RequestHandler, Router } from 'express'

import { getMealLogCompleted, setMealLogCompleted, unsetMealLogCompleted } from '../db/index.ts'
import { addMeal, deleteMealById, getMeal, queryMeals, updateMealById } from '../services/meals.ts'
import { validateBody, validateQuery } from '../validation.ts'

/** Check if a date is marked as logging-complete. Returns undefined if no date provided. */
const checkLogCompleted = async (user: string, start?: string): Promise<boolean | undefined> => {
  if (!start) return undefined
  const dateStr = start.slice(0, 10)
  const completed = await getMealLogCompleted(user, [dateStr])
  return completed.includes(dateStr)
}

const handleQueryMeals: RequestHandler = async (req, res) => {
  const { meal_type, start, end } = req.query as MealsQuery
  const user = req.user!
  const result = await queryMeals(user, { end, meal_type, start })
  const log_completed = await checkLogCompleted(user, start)
  res.json({ data: result.data, log_completed, success: true })
}

const handleGetMeal: RequestHandler = async (req, res) => {
  const { id } = req.params
  const user = req.user!
  const result = await getMeal(user, id)
  if (!result.success) return res.status(404).json({ error: result.error, success: false })
  res.json({ data: result.data, success: true })
}

const handleUpsertMeal: RequestHandler = async (req, res) => {
  const user = req.user!
  const result = await addMeal(user, { ...req.body })
  if (!result.success) return res.status(400).json({ error: result.error, success: false })
  res.json({ data: result.data, success: true })
}

export const createMealsRouter = (authMiddleware: RequestHandler): Router => {
  const router = Router()

  router.get('/', authMiddleware, validateQuery(mealsQuerySchema), handleQueryMeals)

  // Log completion (before /:id to avoid route conflict)
  router.put<{ date: string }>('/log-completed/:date', authMiddleware, async (req, res) => {
    await setMealLogCompleted(req.user!, req.params.date)
    res.json({ success: true })
  })
  router.delete<{ date: string }>('/log-completed/:date', authMiddleware, async (req, res) => {
    await unsetMealLogCompleted(req.user!, req.params.date)
    res.json({ success: true })
  })

  router.get('/:id', authMiddleware, handleGetMeal)

  const upsertMiddleware = [authMiddleware, validateBody(addMealBodySchema), handleUpsertMeal]
  router.put('/', ...upsertMiddleware)
  router.post('/', ...upsertMiddleware)

  // PATCH /meals/:id - Update a meal
  router.patch<{ id: string }, MealResponse, UpdateMealBody>(
    '/:id',
    authMiddleware,
    validateBody(updateMealBodySchema),
    async (req, res) => {
      const { id } = req.params
      const user = req.user!

      const result = await updateMealById(user, id, req.body)

      if (!result.success) {
        return res.status(404).json({ error: result.error, success: false })
      }

      res.json({ data: result.data, success: true })
    },
  )

  // DELETE /meals/:id - Delete a meal
  router.delete<{ id: string }, DeleteMealResponse>('/:id', authMiddleware, async (req, res) => {
    const { id } = req.params
    const user = req.user!

    const result = await deleteMealById(user, id)

    if (!result.success) {
      return res.status(404).json({ error: result.error, success: false })
    }

    res.json({ success: true })
  })

  return router
}
