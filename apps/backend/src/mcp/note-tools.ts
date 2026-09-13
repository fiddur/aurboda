/**
 * MCP note management tools.
 */
import {
  addNoteBodySchema,
  notesQueryRangeSchema,
  notesQuerySchema,
  tzSchema,
  updateNoteBodySchema,
} from '@aurboda/api-spec'
import { z } from 'zod'

import {
  addNote,
  deleteNoteById,
  getNotesForEntity,
  getNotesInRange,
  updateNote,
} from '../services/mutations.ts'
import { errorResponse, jsonResponse, type McpServer, tzJsonResponse } from './helpers.ts'

export const registerNoteTools = (server: McpServer, user: string) => {
  // Tool: add_note
  server.tool(
    'add_note',
    'Add a comment. Three shapes: (1) on an entity — entity_type "activity", "productivity", "report", "meal" or "metric" plus entity_id (for metrics entity_id is a composite key "<iso_time>|<metric>|<source>", e.g. "2024-01-15T10:30:00.000Z|heart_rate|oura"); (2) a reply — entity_type "note" with entity_id set to the comment being replied to (threads are one level deep, so replying to a reply re-anchors to its root); (3) a comment about a moment — entity_type "time" with no entity_id, start_time required and end_time optional. start_time/end_time may only be given for entity_type "time"; every other shape inherits its times from the entity.',
    { ...addNoteBodySchema.shape },
    async ({ entity_type, entity_id, content, start_time, end_time }) => {
      const result = await addNote(user, { content, end_time, entity_id, entity_type, start_time })
      if (!result.success) {
        return errorResponse(result.error ?? 'Could not add note')
      }
      return jsonResponse(result)
    },
  )

  // Tool: get_notes
  server.tool(
    'get_notes',
    'Get all comments on an entity (activity, tag, productivity record, meal, or metric data point). For metrics, use entity_type "metric" with entity_id as a composite key: "<iso_time>|<metric>|<source>". Each comment carries its thread in `replies` (oldest first); replies are never listed as top-level comments.',
    { ...notesQuerySchema.shape, tz: tzSchema },
    async ({ entity_type, entity_id, tz }) => {
      const notes = await getNotesForEntity(user, entity_type, entity_id)
      return tzJsonResponse({ data: notes, success: true }, tz)
    },
  )

  // Tool: query_notes
  server.tool(
    'query_notes',
    'List every comment anchored in a time range (threads nested, replies not listed separately). Covers comments on entities, which inherit the entity\'s times, and free-standing "time" comments about a moment.',
    { ...notesQueryRangeSchema.shape, tz: tzSchema },
    async ({ from, to, tz }) => {
      const notes = await getNotesInRange(user, new Date(from), new Date(to))
      return tzJsonResponse({ data: notes, success: true }, tz)
    },
  )

  // Tool: update_note
  server.tool(
    'update_note',
    'Update a comment by its ID. start_time/end_time can only be changed on a comment with entity_type "time"; moving one moves its whole thread.',
    {
      id: z.string().uuid().describe('The ID of the note to update'),
      ...updateNoteBodySchema.shape,
    },
    async ({ id, content, start_time, end_time }) => {
      const result = await updateNote(user, id, { content, end_time, start_time })
      if (!result.success) {
        return errorResponse(result.error ?? 'Note not found')
      }
      return jsonResponse(result)
    },
  )

  // Tool: delete_note
  server.tool(
    'delete_note',
    'Delete a comment by its ID. Deleting a comment also deletes the replies in its thread.',
    { id: z.string().uuid().describe('The ID of the note to delete') },
    async ({ id }) => {
      const result = await deleteNoteById(user, id)
      return jsonResponse(result)
    },
  )
}
