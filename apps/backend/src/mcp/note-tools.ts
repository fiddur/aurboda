/**
 * MCP note management tools.
 */
import { addNoteBodySchema, notesQuerySchema, updateNoteBodySchema } from '@aurboda/api-spec'
import { z } from 'zod'
import { addNote, deleteNoteById, getNotesForEntity, updateNoteContent } from '../services/mutations'
import { errorResponse, jsonResponse, type McpServer } from './helpers'

export const registerNoteTools = (server: McpServer, user: string) => {
  // Tool: add_note
  server.tool(
    'add_note',
    'Add a note/comment to an entity (activity, tag, or productivity record).',
    { ...addNoteBodySchema.shape },
    async ({ entity_type, entity_id, content }) => {
      const result = await addNote(user, { content, entity_id, entity_type })
      return jsonResponse(result)
    },
  )

  // Tool: get_notes
  server.tool(
    'get_notes',
    'Get all notes for an entity (activity, tag, or productivity record).',
    { ...notesQuerySchema.shape },
    async ({ entity_type, entity_id }) => {
      const notes = await getNotesForEntity(user, entity_type, entity_id)
      return jsonResponse({ data: notes, success: true })
    },
  )

  // Tool: update_note
  server.tool(
    'update_note',
    'Update a note by its ID.',
    {
      id: z.string().uuid().describe('The ID of the note to update'),
      ...updateNoteBodySchema.shape,
    },
    async ({ id, content }) => {
      const result = await updateNoteContent(user, id, content)
      if (!result.success) {
        return errorResponse(result.error ?? 'Note not found')
      }
      return jsonResponse(result)
    },
  )

  // Tool: delete_note
  server.tool(
    'delete_note',
    'Delete a note by its ID.',
    { id: z.string().uuid().describe('The ID of the note to delete') },
    async ({ id }) => {
      const result = await deleteNoteById(user, id)
      return jsonResponse(result)
    },
  )
}
