/**
 * MCP meal management tools.
 *
 * Provides tools for adding, querying, and deleting meal/nutrition records.
 */
import {
  addMealBodySchema,
  frequentMealsQuerySchema,
  mealsQuerySchema,
  tzSchema,
  updateMealBodySchema,
} from '@aurboda/api-spec'
import { z } from 'zod'

import {
  addMeal,
  deleteMealById,
  getMeal,
  queryFrequentMeals,
  queryMeals,
  updateMealById,
} from '../services/meals.ts'
import { errorResponse, jsonResponse, type McpServer, tzJsonResponse } from './helpers.ts'

export const registerMealTools = (server: McpServer, user: string) => {
  // Tool: add_meal
  server.tool(
    'add_meal',
    'Add a meal record with optional nutrition details. Supports food items, macros (calories, protein, carbs, fat, fiber), and micronutrients.',
    { ...addMealBodySchema.shape, tz: tzSchema },
    async ({ tz, ...params }) => {
      const result = await addMeal(user, { ...params })
      return tzJsonResponse(result, tz)
    },
  )

  // Tool: query_meals
  server.tool(
    'query_meals',
    'Query meals for a date range, optionally filtered by meal type.',
    { ...mealsQuerySchema.shape, tz: tzSchema },
    async ({ tz, ...params }) => {
      const result = await queryMeals(user, {
        end: params.end,
        meal_type: params.meal_type,
        start: params.start,
      })
      return tzJsonResponse(result, tz)
    },
  )

  // Tool: delete_meal
  server.tool(
    'delete_meal',
    'Delete a meal record by its ID.',
    { id: z.string().uuid().describe('The meal ID to delete') },
    async ({ id }) => {
      const result = await deleteMealById(user, id)
      if (!result.success) {
        return errorResponse(result.error ?? 'Meal not found')
      }
      return jsonResponse(result)
    },
  )

  // Tool: update_meal
  server.tool(
    'update_meal',
    'Update an existing meal record. Only provided fields are changed.',
    { id: z.string().uuid().describe('The meal ID to update'), ...updateMealBodySchema.shape, tz: tzSchema },
    async ({ id, tz, ...params }) => {
      const result = await updateMealById(user, id, params)
      if (!result.success) {
        return errorResponse(result.error ?? 'Meal not found')
      }
      return tzJsonResponse(result, tz)
    },
  )

  // Tool: query_frequent_meals
  server.tool(
    'query_frequent_meals',
    'List the meal names a user logs most often within a meal_type (e.g. recurring breakfasts), with the food items from the most recent occurrence so they can be re-logged with one tap.',
    { ...frequentMealsQuerySchema.shape, tz: tzSchema },
    async ({ tz, ...params }) => {
      const result = await queryFrequentMeals(user, params)
      return tzJsonResponse(result, tz)
    },
  )

  // Tool: get_meal
  server.tool(
    'get_meal',
    'Get a single meal by its ID, including food items and nutrition data.',
    { id: z.string().uuid().describe('The meal ID'), tz: tzSchema },
    async ({ id, tz }) => {
      const result = await getMeal(user, id)
      if (!result.success) {
        return errorResponse(result.error ?? 'Meal not found')
      }
      return tzJsonResponse(result, tz)
    },
  )
}
