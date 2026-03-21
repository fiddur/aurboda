/**
 * MCP tag management tools.
 */
import { addTagBodySchema, deleteTagParamsSchema, updateTagBodySchema } from '@aurboda/api-spec'
import { z } from 'zod'

import { addTag, deleteTag, restoreTag, updateTag } from '../services/mutations.ts'
import { errorResponse, jsonResponse, type McpServer, parseOptionalDate } from './helpers.ts'

export const registerTagTools = (server: McpServer, user: string) => {
  // Tool: add_tag
  server.tool(
    'add_tag',
    'Add a manual tag/label to mark an activity or event. Tags can have a start time and optional end time.',
    { ...addTagBodySchema.shape },
    async ({ end_time, merge_span, start_time, tag }) => {
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
      return jsonResponse(result)
    },
  )

  // Tool: update_tag
  server.tool(
    'update_tag',
    "Update a tag's start and/or end time.",
    { id: z.string().uuid().describe('The ID of the tag to update'), ...updateTagBodySchema.shape },
    async ({ id, start_time, end_time }) => {
      const result = await updateTag(user, id, {
        end_time: end_time === null ? null : end_time ? new Date(end_time) : undefined,
        start_time: start_time ? new Date(start_time) : undefined,
      })
      return jsonResponse(result)
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
}
