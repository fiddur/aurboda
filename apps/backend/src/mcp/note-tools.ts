import {
  addNoteBodySchema,
  DELETED_NOTE_RETENTION_DAYS,
  isKnownTimezone,
  notesQueryRangeSchema,
  notesQuerySchema,
  notesSearchQuerySchema,
  tzSchema,
  updateNoteBodySchema,
} from '@aurboda/api-spec'
import { z } from 'zod'

import {
  addNote,
  deleteNoteById,
  getNoteForUser,
  getNoteRevisionsById,
  getNotesForEntity,
  getNotesInRange,
  listDeletedNotes,
  restoreNoteById,
  searchNotesForUser,
  updateNote,
} from '../services/mutations.ts'
import { errorResponse, jsonResponse, type McpServer, tzJsonResponse } from './helpers.ts'

const noteIdSchema = (what: string) => z.string().uuid().describe(`The ID of the note to ${what}`)

export const registerNoteTools = (server: McpServer, user: string) => {
  server.tool(
    'add_note',
    'Add a comment or journal entry. Four shapes: (1) on an entity — entity_type "activity", "productivity", "report", "meal" or "metric" plus entity_id (for metrics entity_id is a composite key "<iso_time>|<metric>|<source>", e.g. "2024-01-15T10:30:00.000Z|heart_rate|oura"); (2) a reply — entity_type "note" with entity_id set to the comment being replied to (threads are one level deep, so replying to a reply re-anchors to its root); (3) a comment or journal entry about a moment — entity_type "time" with no entity_id, start_time required and end_time optional; (4) a journal entry for a whole day — entity_type "day" with no entity_id and no times, date (YYYY-MM-DD) required. start_time/end_time may only be given for "time" and date only for "day"; every other shape inherits its times from the entity. Optional title (not on a reply) and tags (lowercase words without "#"); #hashtags written in the content count as tags too. content may be empty only for "time" and "day" entries. A new journal entry ("time" or "day") answers with its pictures and recordings in `attachments`, empty until add_note_attachment adds one; a reply and a comment on an entity carry none.',
    { ...addNoteBodySchema.shape },
    async ({ entity_type, entity_id, content, start_time, end_time, date, title, tags }) => {
      const result = await addNote(user, {
        content,
        date,
        end_time,
        entity_id,
        entity_type,
        start_time,
        tags,
        title,
      })
      if (!result.success) {
        return errorResponse(result.error ?? 'Could not add note')
      }
      return jsonResponse(result)
    },
  )

  server.tool(
    'get_notes',
    'Get all comments on an entity (activity, tag, productivity record, meal, or metric data point). For metrics, use entity_type "metric" with entity_id as a composite key: "<iso_time>|<metric>|<source>". Each comment carries its thread in `replies` (oldest first); replies are never listed as top-level comments.',
    { ...notesQuerySchema.shape, tz: tzSchema },
    async ({ entity_type, entity_id, tz }) => {
      const notes = await getNotesForEntity(user, entity_type, entity_id)
      return tzJsonResponse({ data: notes, success: true }, tz)
    },
  )

  server.tool(
    'get_note',
    'Get one comment or journal entry by its ID: a thread root comes with its replies (oldest first) and, for a journal entry, its pictures and recordings; a reply comes on its own.',
    { id: noteIdSchema('get'), tz: tzSchema },
    async ({ id, tz }) => {
      if (!isKnownTimezone(tz)) return errorResponse(`Not an IANA timezone: ${tz}`)
      const result = await getNoteForUser(user, id)
      if (!result.success) return errorResponse(result.error ?? 'Note not found')
      return tzJsonResponse(result, tz)
    },
  )

  server.tool(
    'query_notes',
    'List every comment anchored in a time range (threads nested, replies not listed separately). Covers comments on entities, which inherit the entity\'s times, free-standing "time" comments about a moment, and "day" journal entries whose date is one of the range\'s local dates in tz. To search or page through the journal, use search_notes.',
    { ...notesQueryRangeSchema.shape, tz: tzSchema },
    async ({ from, to, tz, needs_text }) => {
      if (!isKnownTimezone(tz)) return errorResponse(`Not an IANA timezone: ${tz}`)
      const notes = await getNotesInRange(user, new Date(from), new Date(to), tz, { needs_text })
      return tzJsonResponse({ data: notes, success: true }, tz)
    },
  )

  server.tool(
    'search_notes',
    'Search and list journal entries and comments, newest first, with their replies nested. With no filter it lists the free-standing entries ("time" and "day" notes); entity_types adds comments on activities, meals and so on. q is a full-text search over title and content (a match in a reply returns its thread root); tags keeps entries carrying all the given tags; from/to are local dates; on_this_day lists entries from the same month and day in earlier years. Page with next_cursor.',
    { ...notesSearchQuerySchema.shape },
    async (params) => {
      const result = await searchNotesForUser(user, params)
      if (!result.success) return errorResponse(result.error)
      return params.tz ? tzJsonResponse(result, params.tz) : jsonResponse(result)
    },
  )

  server.tool(
    'update_note',
    'Update a comment or journal entry by its ID: content, title (null clears it; not on a reply) and tags (replaces the explicit tags; #hashtags in the content stay tags). start_time/end_time can only be changed on a "time" entry, and date on a "day" one; giving a "time" entry a date makes it a "day" entry, and giving a "day" entry a start_time makes it a "time" one. Moving an entry moves its whole thread. Pass expected_updated_at (the updated_at you read) to refuse the change when the entry was edited elsewhere since: the error then carries the current entry. The replaced text is kept: see list_note_revisions.',
    {
      id: noteIdSchema('update'),
      ...updateNoteBodySchema.shape,
    },
    async ({ id, ...fields }) => {
      const result = await updateNote(user, id, fields)
      if (result.errorCode === 'conflict' && result.data) {
        return errorResponse(`${result.error}. The current version:\n${JSON.stringify(result.data, null, 2)}`)
      }
      if (!result.success) {
        return errorResponse(result.error ?? 'Note not found')
      }
      return jsonResponse(result)
    },
  )

  server.tool(
    'delete_note',
    `Delete a comment or journal entry by its ID. Deleting a comment also deletes the replies in its thread. It can be restored with restore_note for ${DELETED_NOTE_RETENTION_DAYS} days (see list_deleted_notes); purge: true removes it for good at once.`,
    {
      id: noteIdSchema('delete'),
      purge: z
        .boolean()
        .optional()
        .describe('true removes the comment and its replies for good at once, deleted or not'),
    },
    async ({ id, purge }) => {
      const result = await deleteNoteById(user, id, { purge: purge === true })
      return jsonResponse(result)
    },
  )

  server.tool(
    'restore_note',
    'Restore a deleted comment or journal entry by its ID, with the replies that were deleted with it. A reply whose thread root is deleted cannot be restored until the root is.',
    { id: noteIdSchema('restore') },
    async ({ id }) => {
      const result = await restoreNoteById(user, id)
      if (!result.success) return errorResponse(result.error ?? 'Note not found')
      return jsonResponse(result)
    },
  )

  server.tool(
    'list_deleted_notes',
    `List the deleted comments and journal entries that can still be restored, newest deletion first, each with deleted_at and purge_at (when it is removed for good, ${DELETED_NOTE_RETENTION_DAYS} days after deletion).`,
    {},
    async () => jsonResponse({ data: await listDeletedNotes(user), success: true }),
  )

  server.tool(
    'list_note_revisions',
    "List a comment's earlier texts (content and title), newest first. Saves within a few minutes of each other keep one revision. To go back to one, update_note with its text.",
    { id: noteIdSchema('list the revisions of') },
    async ({ id }) => {
      const result = await getNoteRevisionsById(user, id)
      if (!result.success) return errorResponse(result.error)
      return jsonResponse(result)
    },
  )
}
