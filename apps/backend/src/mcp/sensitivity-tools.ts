/**
 * MCP tools for managing user-defined sensitivity flags + assigning them
 * to food items.
 *
 * The set/clear assignment tool is the user-visible answer to issue #704:
 * works for per-user food items AND central library entries (a user can
 * tag the LSV "Hushållsost" as `dairy`), via the soft-pointer junction.
 */
import {
  addSensitivityFlagBodySchema,
  setFoodItemSensitivitiesBodySchema,
  updateSensitivityFlagBodySchema,
} from '@aurboda/api-spec'
import { z } from 'zod'

import type { CentralDb } from '../services/central-db.ts'

import {
  deleteSensitivityFlag,
  getFoodItemById as getUserFoodItemById,
  insertSensitivityFlag,
  listSensitivityFlags,
  setFoodItemSensitivities,
  updateSensitivityFlag,
} from '../db/index.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

export const registerSensitivityTools = (server: McpServer, user: string, centralDb: CentralDb) => {
  server.tool(
    'list_sensitivity_flags',
    'List the user-defined sensitivity flags (dairy, gluten, alcohol, …) used to tag food items. Each flag has an id, name, optional color/icon, and a sort order.',
    {},
    async () => {
      const flags = await listSensitivityFlags(user)
      return jsonResponse({ data: flags, success: true })
    },
  )

  server.tool(
    'add_sensitivity_flag',
    'Create a new sensitivity flag. Names must be unique within the user.',
    { ...addSensitivityFlagBodySchema.shape },
    async (params) => {
      try {
        const flag = await insertSensitivityFlag(user, params)
        return jsonResponse({ data: flag, success: true })
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : 'Insert failed')
      }
    },
  )

  server.tool(
    'update_sensitivity_flag',
    'Update a sensitivity flag (rename, recolor, reorder).',
    { id: z.string().uuid().describe('Flag ID'), ...updateSensitivityFlagBodySchema.shape },
    async ({ id, ...rest }) => {
      try {
        const flag = await updateSensitivityFlag(user, id, rest)
        if (!flag) return errorResponse('Sensitivity flag not found')
        return jsonResponse({ data: flag, success: true })
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : 'Update failed')
      }
    },
  )

  server.tool(
    'delete_sensitivity_flag',
    'Delete a sensitivity flag. All food-item assignments referring to it are removed (CASCADE).',
    { id: z.string().uuid().describe('Flag ID') },
    async ({ id }) => {
      const deleted = await deleteSensitivityFlag(user, id)
      if (!deleted) return errorResponse('Sensitivity flag not found')
      return jsonResponse({ success: true })
    },
  )

  server.tool(
    'set_food_item_sensitivities',
    [
      'Replace the sensitivity flags assigned to a food item — pass the full list of flag IDs (or `[]` to clear).',
      'Works on both per-user food items AND central shared-library items (e.g. an LSV entry like "Arla, Hushallsost"). The junction is per-user, so flags set on a central row only affect this user.',
    ].join(' '),
    {
      id: z.string().uuid().describe('Food item ID (per-user OR central)'),
      ...setFoodItemSensitivitiesBodySchema.shape,
    },
    async ({ id, sensitivity_flag_ids }) => {
      const exists =
        (await getUserFoodItemById(user, id)) !== null || (await centralDb.getSharedFoodItemById(id)) !== null
      if (!exists) return errorResponse('Food item not found')
      try {
        await setFoodItemSensitivities(user, id, sensitivity_flag_ids)
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : 'Failed to set sensitivities')
      }
      return jsonResponse({ data: { food_item_id: id, sensitivity_flag_ids }, success: true })
    },
  )
}
