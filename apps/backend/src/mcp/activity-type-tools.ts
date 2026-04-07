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
  mergeActivityType,
  renameActivityTypeDefinition,
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

  server.tool(
    'rename_activity_type',
    "Rename a custom activity type's snake_case identifier. Updates all activities and deduction rules that reference the old name. Built-in types cannot be renamed.",
    {
      name: z.string().describe('Current name of the activity type to rename'),
      new_name: z
        .string()
        .regex(/^[a-z][a-z0-9_]*$/)
        .describe('New snake_case name'),
    },
    async ({ name, new_name }) => {
      const result = await renameActivityTypeDefinition(user, name, new_name)
      if (!result.success) return errorResponse(result.error ?? 'Failed to rename activity type')
      return jsonResponse(result)
    },
  )

  server.tool(
    'merge_activity_type',
    'Merge a custom activity type into another activity type (built-in or custom). All activities are reassigned, aliases are merged, deduction rules are updated, and the source custom type definition is deleted. Built-in types cannot be used as the source.',
    {
      source: z.string().describe('Name of the custom activity type to merge away'),
      target: z.string().describe('Name of the target activity type to merge into'),
    },
    async ({ source, target }) => {
      const result = await mergeActivityType(user, source, target)
      if (!result.success) return errorResponse(result.error ?? 'Failed to merge activity type')
      return jsonResponse(result)
    },
  )
}
