/**
 * Meals route group.
 *
 * Handles: /meals/*
 */
import {
  type AddMealBody,
  addMealBodySchema,
  type DeleteMealResponse,
  type MealResponse,
  type MealsQuery,
  mealsQuerySchema,
  type MealsResponse,
} from '@aurboda/api-spec'
import { RequestHandler, Router } from 'express'
import { addMeal, deleteMealById, getMeal, queryMeals } from '../services/meals'
import { validateBody, validateQuery } from '../validation'

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
      res.json({ data: result.data, success: true })
    },
  )

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

  // POST /meals - Create a new meal
  router.post<Record<string, never>, MealResponse, AddMealBody>(
    '/',
    authMiddleware,
    validateBody(addMealBodySchema),
    async (req, res) => {
      const user = req.user!

      const result = await addMeal(user, {
        calories: req.body.calories,
        carbs: req.body.carbs,
        fat: req.body.fat,
        fiber: req.body.fiber,
        food_items: req.body.food_items,
        meal_type: req.body.meal_type,
        micros: req.body.micros,
        name: req.body.name,
        notes: req.body.notes,
        protein: req.body.protein,
        source: req.body.source,
        time: req.body.time,
      })

      if (!result.success) {
        return res.status(400).json({ error: result.error, success: false })
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
