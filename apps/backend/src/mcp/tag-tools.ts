/**
 * MCP tag management tools.
 */
import { addTagBodySchema, deleteTagParamsSchema } from '@aurboda/api-spec'
import { addTag, deleteTag } from '../services/mutations'
import { errorResponse, jsonResponse, type McpServer, parseOptionalDate } from './helpers'

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
}
