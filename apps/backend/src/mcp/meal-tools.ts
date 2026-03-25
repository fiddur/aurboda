/**
 * MCP meal management tools.
 *
 * Provides tools for adding, querying, and deleting meal/nutrition records.
 */
import { addMealBodySchema, mealsQuerySchema } from '@aurboda/api-spec'
import { z } from 'zod'

import { addMeal, deleteMealById, getMeal, queryMeals } from '../services/meals.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

export const registerMealTools = (server: McpServer, user: string) => {
  // Tool: add_meal
  server.tool(
    'add_meal',
    'Add a meal record with optional nutrition details. Supports food items, macros (calories, protein, carbs, fat, fiber), and micronutrients.',
    { ...addMealBodySchema.shape },
    async (params) => {
      const result = await addMeal(user, {
        calories: params.calories,
        carbs: params.carbs,
        fat: params.fat,
        fiber: params.fiber,
        food_items: params.food_items,
        meal_type: params.meal_type,
        micros: params.micros,
        name: params.name,
        notes: params.notes,
        protein: params.protein,
        sensitivities: params.sensitivities,
        source: params.source,
        time: params.time,
      })
      return jsonResponse(result)
    },
  )

  // Tool: query_meals
  server.tool(
    'query_meals',
    'Query meals for a date range, optionally filtered by meal type.',
    { ...mealsQuerySchema.shape },
    async (params) => {
      const result = await queryMeals(user, {
        end: params.end,
        meal_type: params.meal_type,
        start: params.start,
      })
      return jsonResponse(result)
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

  // Tool: get_meal
  server.tool(
    'get_meal',
    'Get a single meal by its ID, including food items and nutrition data.',
    { id: z.string().uuid().describe('The meal ID') },
    async ({ id }) => {
      const result = await getMeal(user, id)
      if (!result.success) {
        return errorResponse(result.error ?? 'Meal not found')
      }
      return jsonResponse(result)
    },
  )
}
