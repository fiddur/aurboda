/**
 * MCP tag management tools.
 */
import { startDateTimeQuerySchema } from '@aurboda/api-spec'
import { z } from 'zod'
import { addTag, deleteTag } from '../services/mutations'
import { errorResponse, jsonResponse, type McpServer, parseOptionalDate } from './helpers'

export const registerTagTools = (server: McpServer, user: string) => {
  // Tool: add_tag
  server.tool(
    'add_tag',
    'Add a manual tag/label to mark an activity or event. Tags can have a start time and optional end time.',
    {
      end_time: z
        .string()
        .optional()
        .describe('Optional end time in ISO 8601 format. Omit for point-in-time tags.'),
      merge_span: z
        .number()
        .int()
        .positive()
        .max(3600)
        .optional()
        .describe(
          'If provided, merge with existing tag of same name if its end_time (or start_time for point-in-time tags) is within this many seconds of new start_time. Max 3600.',
        ),
      start_time: startDateTimeQuerySchema.describe(
        'Start time in ISO 8601 format (e.g., 2024-01-15T14:30:00Z)',
      ),
      tag: z.string().describe('The tag/label text (e.g., "coffee", "meditation", "headache")'),
    },
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
        endTime: endDate,
        mergeSpan: merge_span,
        startTime: startDate,
        tag,
      })
      return jsonResponse(result)
    },
  )

  // Tool: delete_tag
  server.tool(
    'delete_tag',
    'Delete a tag by its external ID. Returns success if the tag was found and deleted.',
    {
      external_id: z.string().describe('The external ID of the tag to delete'),
    },
    async ({ external_id }) => {
      const result = await deleteTag(user, external_id)
      return jsonResponse(result)
    },
  )
}
