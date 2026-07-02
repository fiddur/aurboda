import type { RequestHandler } from 'express'

import {
  type AddMealBody,
  addMealBodySchema,
  type DeleteMealResponse,
  type FrequentFoodItemsQuery,
  type FrequentFoodItemsResponse,
  type FrequentMealsQuery,
  type FrequentMealsResponse,
  frequentFoodItemsQuerySchema,
  frequentMealsQuerySchema,
  type MealResponse,
  type MealsQuery,
  type MealsResponse,
  mealsQuerySchema,
  type NutrientPeriodSummaryQuery,
  type NutrientPeriodSummaryResponse,
  nutrientPeriodSummaryQuerySchema,
  type UpdateMealBody,
  updateMealBodySchema,
} from '@aurboda/api-spec'

/**
 * Meals route group.
 *
 * Handles: /meals/*
 */
import { getMealLogCompleted, setMealLogCompleted, unsetMealLogCompleted } from '../db/index.ts'
import {
  addMeal,
  deleteMealById,
  getMeal,
  queryFrequentFoodItems,
  queryFrequentMeals,
  queryMeals,
  updateMealById,
} from '../services/meals.ts'
import { getMealPeriodSummary } from '../services/queries/meal-period-summary.ts'
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody, validateQuery } from '../validation.ts'

/** Check if a date is marked as logging-complete. Returns undefined if no date provided. */
const checkLogCompleted = async (user: string, start?: string): Promise<boolean | undefined> => {
  if (!start) return undefined
  const dateStr = start.slice(0, 10)
  const completed = await getMealLogCompleted(user, [dateStr])
  return completed.includes(dateStr)
}

export const createMealsRouter = (authMiddleware: AnyMiddleware): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, MealsResponse, unknown, MealsQuery>(
    '/',
    authMiddleware,
    validateQuery(mealsQuerySchema),
    async (req, res) => {
      const { meal_type, start, end, date } = req.query
      const user = req.user!
      const result = await queryMeals(user, { end, meal_type, start })
      // Use explicit `date` param (local date from frontend) for log_completed check,
      // not `start` which is UTC and may be a different calendar date due to timezone offset
      const log_completed = await checkLogCompleted(user, date)
      res.json({ data: result.data, log_completed, success: true })
    },
  )

  router.get<Record<string, never>, FrequentMealsResponse, unknown, FrequentMealsQuery>(
    '/frequent',
    authMiddleware,
    validateQuery(frequentMealsQuerySchema),
    async (req, res) => {
      const result = await queryFrequentMeals(req.user!, req.query)
      res.json({ data: result.data, success: true })
    },
  )

  router.get<Record<string, never>, FrequentFoodItemsResponse, unknown, FrequentFoodItemsQuery>(
    '/frequent-food-items',
    authMiddleware,
    validateQuery(frequentFoodItemsQuerySchema),
    async (req, res) => {
      const result = await queryFrequentFoodItems(req.user!, req.query)
      res.json({ data: result.data, success: true })
    },
  )

  router.get<Record<string, never>, NutrientPeriodSummaryResponse, unknown, NutrientPeriodSummaryQuery>(
    '/period-summary',
    authMiddleware,
    validateQuery(nutrientPeriodSummaryQuerySchema),
    async (req, res) => {
      const data = await getMealPeriodSummary(req.user!, {
        count_only_completed: req.query.count_only_completed,
        end: req.query.end,
        start: req.query.start,
        tz: req.query.tz,
      })
      res.json({ data, success: true })
    },
  )

  router.put<{ date: string }, DeleteMealResponse>(
    '/log-completed/:date',
    authMiddleware,
    async (req, res) => {
      await setMealLogCompleted(req.user!, req.params.date)
      res.json({ success: true })
    },
  )

  router.delete<{ date: string }, DeleteMealResponse>(
    '/log-completed/:date',
    authMiddleware,
    async (req, res) => {
      await unsetMealLogCompleted(req.user!, req.params.date)
      res.json({ success: true })
    },
  )

  router.get<{ id: string }, MealResponse>('/:id', authMiddleware, async (req, res) => {
    const result = await getMeal(req.user!, req.params.id)
    if (!result.success) return res.status(404).json({ error: result.error, success: false })
    res.json({ data: result.data, success: true })
  })

  const handleUpsert: RequestHandler<Record<string, never>, MealResponse, AddMealBody> = async (req, res) => {
    const user = req.user!
    const result = await addMeal(user, { ...req.body })
    if (!result.success) return res.status(400).json({ error: result.error, success: false })
    res.json({ data: result.data, success: true })
  }

  router.put<Record<string, never>, MealResponse, AddMealBody>(
    '/',
    authMiddleware,
    validateBody(addMealBodySchema),
    handleUpsert,
  )
  router.post<Record<string, never>, MealResponse, AddMealBody>(
    '/',
    authMiddleware,
    validateBody(addMealBodySchema),
    handleUpsert,
  )

  router.patch<{ id: string }, MealResponse, UpdateMealBody>(
    '/:id',
    authMiddleware,
    validateBody(updateMealBodySchema),
    async (req, res) => {
      const result = await updateMealById(req.user!, req.params.id, req.body)
      if (!result.success) {
        // updateMealById can fail two ways now: the meal id doesn't resolve
        // (404) or a portion id in the body is invalid (400). Pick by the
        // errorCode the service set; unknown codes are treated as 500.
        const status = result.errorCode === 'invalid' ? 400 : result.errorCode === 'not_found' ? 404 : 500
        return res.status(status).json({ error: result.error, success: false })
      }
      res.json({ data: result.data, success: true })
    },
  )

  router.delete<{ id: string }, DeleteMealResponse>('/:id', authMiddleware, async (req, res) => {
    const result = await deleteMealById(req.user!, req.params.id)
    if (!result.success) return res.status(404).json({ error: result.error, success: false })
    res.json({ success: true })
  })

  return router
}
