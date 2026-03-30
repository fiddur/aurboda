/**
 * MCP tag management tools.
 */
import {
  addTagBodySchema,
  createTagDefinitionBodySchema,
  deleteTagParamsSchema,
  mergeTagDefinitionsBodySchema,
  tzSchema,
  updateTagBodySchema,
  updateTagDefinitionBodySchema,
} from '@aurboda/api-spec'
import { z } from 'zod'

import {
  deleteTagDefinition,
  getTagDefinitionById,
  getTagDefinitions,
  insertTagDefinition,
  mergeTagDefinitions,
  updateTagDefinition,
} from '../db/index.ts'
import { addTag, deleteTag, restoreTag, updateTag } from '../services/mutations.ts'
import { errorResponse, jsonResponse, type McpServer, parseOptionalDate, tzJsonResponse } from './helpers.ts'

export const registerTagTools = (server: McpServer, user: string) => {
  // Tool: add_tag
  server.tool(
    'add_tag',
    'Add a manual tag/label to mark an activity or event. Tags can have a start time and optional end time.',
    { ...addTagBodySchema.shape, tz: tzSchema },
    async ({ end_time, merge_span, start_time, tag, tz }) => {
      const startDate = new Date(start_time)

      let endDate: Date | undefined
      if (end_time) {
        const parsed = parseOptionalDate(end_time)
        if (!parsed) {
          return errorResponse('Invalid end_time format. Use ISO 8601 format.')
        }
        endDate = parsed
      }

      const result = await addTag(user, {
        end_time: endDate,
        mergeSpan: merge_span,
        start_time: startDate,
        tag,
      })
      return tzJsonResponse(result, tz)
    },
  )

  // Tool: update_tag
  server.tool(
    'update_tag',
    "Update a tag's start and/or end time.",
    {
      id: z.string().uuid().describe('The ID of the tag to update'),
      ...updateTagBodySchema.shape,
      tz: tzSchema,
    },
    async ({ id, start_time, end_time, tz }) => {
      const result = await updateTag(user, id, {
        end_time: end_time === null ? null : end_time ? new Date(end_time) : undefined,
        start_time: start_time ? new Date(start_time) : undefined,
      })
      return tzJsonResponse(result, tz)
    },
  )

  // Tool: delete_tag
  server.tool(
    'delete_tag',
    'Delete a tag by its external ID. Returns success if the tag was found and deleted.',
    { ...deleteTagParamsSchema.shape },
    async ({ external_id }) => {
      const result = await deleteTag(user, external_id)
      return jsonResponse(result)
    },
  )

  // Tool: restore_tag
  server.tool(
    'restore_tag',
    'Restore a soft-deleted tag by its ID.',
    { id: z.string().uuid().describe('The ID of the tag to restore') },
    async ({ id }) => {
      const result = await restoreTag(user, id)
      return jsonResponse(result)
    },
  )

  // Tool: list_tag_definitions
  server.tool(
    'list_tag_definitions',
    'List all tag definitions with occurrence counts and aliases.',
    {},
    async () => {
      const definitions = await getTagDefinitions(user)
      return jsonResponse({ data: definitions, success: true })
    },
  )

  // Tool: create_tag_definition
  server.tool(
    'create_tag_definition',
    'Create a new tag definition with a name and optional aliases/icon.',
    { ...createTagDefinitionBodySchema.shape },
    async (params) => {
      const definition = await insertTagDefinition(user, params)
      return jsonResponse({ data: definition, success: true })
    },
  )

  // Tool: update_tag_definition
  server.tool(
    'update_tag_definition',
    'Update a tag definition name, aliases, or icon.',
    {
      id: z.string().uuid().describe('The tag definition ID'),
      ...updateTagDefinitionBodySchema.shape,
    },
    async ({ id, ...updates }) => {
      const result = await updateTagDefinition(user, id, updates)
      if (!result) return errorResponse('Tag definition not found')
      return jsonResponse({ data: result, success: true })
    },
  )

  // Tool: delete_tag_definition
  server.tool(
    'delete_tag_definition',
    'Delete a tag definition. Unlinks all tags from it.',
    { id: z.string().uuid().describe('The tag definition ID to delete') },
    async ({ id }) => {
      const deleted = await deleteTagDefinition(user, id)
      if (!deleted) return errorResponse('Tag definition not found')
      return jsonResponse({ success: true })
    },
  )

  // Tool: merge_tag_definitions
  server.tool(
    'merge_tag_definitions',
    'Merge one tag definition into another. Moves all aliases and re-links all tags from source to target, then deletes source.',
    {
      id: z.string().uuid().describe('The source tag definition ID (will be deleted)'),
      ...mergeTagDefinitionsBodySchema.shape,
    },
    async ({ id, target_id }) => {
      const result = await mergeTagDefinitions(user, id, target_id)
      if (!result) return errorResponse('Merge failed (definitions not found or same ID)')
      return jsonResponse({ data: result, success: true })
    },
  )
}
