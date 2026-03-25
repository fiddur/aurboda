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

export const createMealsRouter = (authMiddleware: RequestHandler): Router => {
  const router = Router()

  // GET /meals - Query meals with optional filters
  router.get<Record<string, never>, MealsResponse, unknown, MealsQuery>(
    '/',
    authMiddleware,
    validateQuery(mealsQuerySchema),
    async (req, res) => {
      const { meal_type, start, end } = req.query
      const user = req.user!

      const result = await queryMeals(user, { end, meal_type, start })

      // Include log_completed when querying a single day (start date provided)
      let log_completed: boolean | undefined
      if (start) {
        const dateStr = start.slice(0, 10)
        const completed = await getMealLogCompleted(user, [dateStr])
        log_completed = completed.includes(dateStr)
      }

      res.json({ data: result.data, log_completed, success: true })
    },
  )

  // --- Log completion endpoints (before /:id to avoid route conflict) ---

  // PUT /meals/log-completed/:date
  router.put<{ date: string }>('/log-completed/:date', authMiddleware, async (req, res) => {
    const user = req.user!
    await setMealLogCompleted(user, req.params.date)
    res.json({ success: true })
  })

  // DELETE /meals/log-completed/:date
  router.delete<{ date: string }>('/log-completed/:date', authMiddleware, async (req, res) => {
    const user = req.user!
    await unsetMealLogCompleted(user, req.params.date)
    res.json({ success: true })
  })

  // GET /meals/:id - Get a single meal
  router.get<{ id: string }, MealResponse>('/:id', authMiddleware, async (req, res) => {
    const { id } = req.params
    const user = req.user!

    const result = await getMeal(user, id)

    if (!result.success) {
      return res.status(404).json({ error: result.error, success: false })
    }

    res.json({ data: result.data, success: true })
  })

  // PUT /meals - Upsert a meal (idempotent — client provides ID)
  // POST /meals - Create a meal (backwards-compatible, server generates ID)
  const handleUpsertMeal: RequestHandler = async (req, res) => {
    const user = req.user!
    const result = await addMeal(user, { ...req.body })

    if (!result.success) {
      return res.status(400).json({ error: result.error, success: false })
    }

    res.json({ data: result.data, success: true })
  }

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
