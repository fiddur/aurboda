/**
 * MCP food item tools.
 *
 * Search, create, update, delete canonical food items.
 */

import { addFoodItemBodySchema, foodItemsQuerySchema, updateFoodItemBodySchema } from '@aurboda/api-spec'
import { z } from 'zod'

import {
  deleteFoodItem,
  getFoodItemById,
  listFoodItems,
  searchFoodItems,
  updateFoodItem,
  upsertFoodItem,
} from '../db/index.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

export const registerFoodItemTools = (server: McpServer, user: string) => {
  server.tool(
    'search_food_items',
    'Search canonical food items by name. Returns matching items with their default nutritional data.',
    { ...foodItemsQuerySchema.shape },
    async (params) => {
      const maxResults = params.limit ? parseInt(params.limit, 10) : 20
      const items = params.q
        ? await searchFoodItems(user, params.q, maxResults)
        : await listFoodItems(user, maxResults)
      return jsonResponse({ data: items, success: true })
    },
  )

  server.tool(
    'add_food_item',
    'Create or update a canonical food item with default nutritional data.',
    { ...addFoodItemBodySchema.shape },
    async (params) => {
      const item = await upsertFoodItem(user, { ...params })
      return jsonResponse({ data: item, success: true })
    },
  )

  server.tool(
    'update_food_item',
    'Update a food item by ID.',
    { id: z.string().uuid().describe('Food item ID'), ...updateFoodItemBodySchema.shape },
    async ({ id, ...params }) => {
      const item = await updateFoodItem(user, id, params)
      if (!item) return errorResponse('Food item not found')
      return jsonResponse({ data: item, success: true })
    },
  )

  server.tool(
    'delete_food_item',
    'Delete a food item by ID.',
    { id: z.string().uuid().describe('Food item ID') },
    async ({ id }) => {
      const deleted = await deleteFoodItem(user, id)
      if (!deleted) return errorResponse('Food item not found')
      return jsonResponse({ success: true })
    },
  )

  server.tool(
    'get_food_item',
    'Get a food item by ID.',
    { id: z.string().uuid().describe('Food item ID') },
    async ({ id }) => {
      const item = await getFoodItemById(user, id)
      if (!item) return errorResponse('Food item not found')
      return jsonResponse({ data: item, success: true })
    },
  )
}
