/**
 * MCP activity type definition management tools.
 */
import {
  addActivityTypeDefinitionBodySchema,
  updateActivityTypeDefinitionBodySchema,
} from '@aurboda/api-spec'
import { z } from 'zod'

import {
  addActivityTypeDefinition,
  deleteActivityTypeDefinition,
  listActivityTypeDefinitions,
  updateActivityTypeDefinition,
} from '../services/activity-type-definitions.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

export const registerActivityTypeTools = (server: McpServer, user: string) => {
  server.tool(
    'list_activity_types',
    'List all activity type definitions (built-in and custom). Returns display metadata including name, display_name, display_category, color, and icon.',
    {},
    async () => {
      const definitions = await listActivityTypeDefinitions(user)
      return jsonResponse(definitions)
    },
  )

  server.tool(
    'add_activity_type',
    'Create a custom activity type definition. The name must be snake_case (e.g. "sauna", "driving", "hot_bath"). Built-in types (sleep, exercise, meditation, nap, rest) cannot be recreated.',
    { ...addActivityTypeDefinitionBodySchema.shape },
    async (params) => {
      const result = await addActivityTypeDefinition(user, params)
      if (!result.success) return errorResponse(result.error ?? 'Failed to create activity type')
      return jsonResponse(result.data)
    },
  )

  server.tool(
    'update_activity_type',
    'Update an activity type definition. Can modify display_name, display_category, color, and icon for both built-in and custom types.',
    {
      name: z.string().describe('Name of the activity type to update'),
      ...updateActivityTypeDefinitionBodySchema.shape,
    },
    async ({ name, ...updates }) => {
      const result = await updateActivityTypeDefinition(user, name, updates)
      if (!result.success) return errorResponse(result.error ?? 'Failed to update activity type')
      return jsonResponse(result.data)
    },
  )

  server.tool(
    'delete_activity_type',
    'Delete a custom activity type definition. Built-in types (sleep, exercise, meditation, nap, rest) cannot be deleted.',
    { name: z.string().describe('Name of the activity type to delete') },
    async ({ name }) => {
      const result = await deleteActivityTypeDefinition(user, name)
      if (!result.success) return errorResponse(result.error ?? 'Failed to delete activity type')
      return jsonResponse({ deleted: true, name })
    },
  )
}
