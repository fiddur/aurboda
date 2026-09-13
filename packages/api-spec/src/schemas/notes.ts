/**
 * Notes schemas.
 */

import { z } from 'zod'

import {
  baseResponseSchema,
  createDataArrayResponseSchema,
  createDataResponseSchema,
  iso8601DateTimeSchema,
} from './common.ts'

/**
 * Valid entity types for notes and soft-delete references.
 *
 * Besides the real entities, two shapes are special:
 *  - `note` — the note is a reply; `entity_id` is the id of the comment it replies to.
 *  - `time` — the note is anchored to a moment rather than an entity; it has no
 *    `entity_id` and carries its own `start_time` (required) and `end_time` (optional).
 */
export const entityTypes = ['activity', 'productivity', 'metric', 'report', 'meal', 'note', 'time'] as const

export const entityTypeSchema = z.enum(entityTypes).meta({
  description:
    'Entity type for polymorphic references. `note` marks a reply — `entity_id` is the id of the comment it replies to. `time` marks a comment anchored to a moment — no `entity_id`, and `start_time`/`end_time` are supplied by the user.',
  example: 'activity',
  id: 'EntityType',
})

export type EntityType = z.infer<typeof entityTypeSchema>

/**
 * A reply inside a comment thread. Threads are exactly one level deep, so a
 * reply never carries replies of its own.
 */
export const noteReplySchema = z
  .object({
    content: z.string().meta({ description: 'Reply content (markdown)' }),
    created_at: iso8601DateTimeSchema.optional(),
    end_time: iso8601DateTimeSchema.optional().meta({
      description: 'End time inherited from the thread root (if any)',
    }),
    id: z.string().uuid().optional().meta({ description: 'Reply (note) ID' }),
    source: z.string().optional().meta({
      description:
        'Data source that authored this reply. Null/absent for user-typed replies; set for synced ones.',
    }),
    start_time: iso8601DateTimeSchema.optional().meta({
      description: 'Start time inherited from the thread root',
    }),
    updated_at: iso8601DateTimeSchema.optional(),
  })
  .meta({ description: 'A reply in a comment thread (threads are one level deep)', id: 'NoteReply' })

export type NoteReply = z.infer<typeof noteReplySchema>

/**
 * Note schema.
 */
export const noteSchema = z
  .object({
    content: z.string().meta({ description: 'Note content (markdown)' }),
    created_at: iso8601DateTimeSchema.optional(),
    end_time: iso8601DateTimeSchema.optional().meta({
      description: 'End time inherited from the parent entity (if any), or set by the user for a time note',
    }),
    entity_id: z.string().nullable().optional().meta({
      description:
        'ID of the referenced entity (UUID for most types, composite key for metrics, root note id for a reply). Null for a `time` note.',
    }),
    entity_type: entityTypeSchema,
    id: z.string().uuid().optional().meta({ description: 'Note ID' }),
    replies: z.array(noteReplySchema).optional().meta({
      description: "Replies in this comment's thread, oldest first",
    }),
    source: z.string().optional().meta({
      description:
        'Data source that authored this note. Null/absent for user-typed notes; set for synced ones (e.g. "health_connect", "oura"), which are not editable through this API.',
    }),
    start_time: iso8601DateTimeSchema.optional().meta({
      description: 'Start time inherited from the parent entity, or set by the user for a time note',
    }),
    updated_at: iso8601DateTimeSchema.optional(),
  })
  .meta({ id: 'Note' })

export type Note = z.infer<typeof noteSchema>

/**
 * Embedded comment schema (without entity_type/entity_id since those are implicit).
 */
export const commentSchema = z
  .object({
    content: z.string().meta({ description: 'Comment content (markdown)' }),
    created_at: iso8601DateTimeSchema.optional(),
    end_time: iso8601DateTimeSchema.optional().meta({
      description: 'End time inherited from the parent entity (if any)',
    }),
    id: z.string().uuid().optional().meta({ description: 'Comment/note ID' }),
    replies: z.array(noteReplySchema).optional().meta({
      description: "Replies in this comment's thread, oldest first",
    }),
    source: z.string().optional().meta({
      description:
        'Data source that authored this comment. Null/absent for user-typed comments; set for synced comments (e.g. "health_connect", "oura").',
    }),
    start_time: iso8601DateTimeSchema.optional().meta({
      description: 'Start time inherited from the parent entity',
    }),
    updated_at: iso8601DateTimeSchema.optional(),
  })
  .meta({ description: 'A comment attached to an entity', id: 'Comment' })

export type Comment = z.infer<typeof commentSchema>

/**
 * Add note request body.
 *
 * Three shapes are accepted:
 *  - a comment on an entity — `entity_type` + `entity_id`, no times;
 *  - a reply — `entity_type: 'note'` + the comment's id, no times;
 *  - a comment about a moment — `entity_type: 'time'`, no `entity_id`,
 *    `start_time` required and `end_time` optional.
 */
export const addNoteBodySchema = z
  .object({
    content: z.string().min(1).meta({ description: 'Note content (markdown)' }),
    end_time: iso8601DateTimeSchema.optional().meta({
      description: "Only for `entity_type: 'time'` — when the comment is about (end of the span)",
    }),
    entity_id: z.string().min(1).nullable().optional().meta({
      description:
        'ID of the referenced entity (UUID for most types, composite key for metrics, the comment id for a reply). Omit for `entity_type: "time"`.',
    }),
    entity_type: entityTypeSchema,
    start_time: iso8601DateTimeSchema.optional().meta({
      description: "Only for `entity_type: 'time'` — when the comment is about (required)",
    }),
  })
  .check((ctx) => {
    const body = ctx.value
    if (body.entity_type === 'time') {
      if (body.entity_id !== undefined && body.entity_id !== null) {
        ctx.issues.push({
          code: 'custom',
          input: body.entity_id,
          message: "entity_id must be omitted when entity_type is 'time'",
          path: ['entity_id'],
        })
      }
      if (body.start_time === undefined) {
        ctx.issues.push({
          code: 'custom',
          input: body.start_time,
          message: "start_time is required when entity_type is 'time'",
          path: ['start_time'],
        })
      }
      return
    }
    if (body.entity_id === undefined || body.entity_id === null) {
      ctx.issues.push({
        code: 'custom',
        input: body.entity_id,
        message: "entity_id is required unless entity_type is 'time'",
        path: ['entity_id'],
      })
    }
    if (body.start_time !== undefined) {
      ctx.issues.push({
        code: 'custom',
        input: body.start_time,
        message: "start_time can only be set when entity_type is 'time'",
        path: ['start_time'],
      })
    }
    if (body.end_time !== undefined) {
      ctx.issues.push({
        code: 'custom',
        input: body.end_time,
        message: "end_time can only be set when entity_type is 'time'",
        path: ['end_time'],
      })
    }
  })
  .meta({ id: 'AddNoteBody' })

export type AddNoteBody = z.infer<typeof addNoteBodySchema>

/**
 * Update note request body. At least one field must be present. Times can only
 * be changed on a `time` note — on every other shape they mirror the parent entity.
 */
export const updateNoteBodySchema = z
  .object({
    content: z.string().min(1).optional().meta({ description: 'Updated note content (markdown)' }),
    end_time: iso8601DateTimeSchema.nullable().optional().meta({
      description:
        "New end time, or null to clear it and make the comment a point in time. Only for a comment with `entity_type: 'time'`.",
    }),
    start_time: iso8601DateTimeSchema.optional().meta({
      description: "New start time. Only for a comment with `entity_type: 'time'`.",
    }),
  })
  .check((ctx) => {
    const body = ctx.value
    if (body.content === undefined && body.start_time === undefined && body.end_time === undefined) {
      ctx.issues.push({
        code: 'custom',
        input: body,
        message: 'At least one of content, start_time or end_time must be provided',
        path: ['content'],
      })
    }
  })
  .meta({ id: 'UpdateNoteBody' })

export type UpdateNoteBody = z.infer<typeof updateNoteBodySchema>

/**
 * Notes query schema (by entity).
 */
export const notesQuerySchema = z
  .object({
    entity_id: z
      .string()
      .min(1)
      .meta({ description: 'ID of the referenced entity (UUID for most types, composite key for metrics)' }),
    entity_type: entityTypeSchema,
  })
  .meta({ id: 'NotesQuery' })

export type NotesQuery = z.infer<typeof notesQuerySchema>

/**
 * Notes query schema (by time range). Returns thread roots anchored in the
 * window, each with its replies nested.
 */
export const notesQueryRangeSchema = z
  .object({
    from: iso8601DateTimeSchema.meta({ description: 'Start of the window (inclusive)' }),
    to: iso8601DateTimeSchema.meta({ description: 'End of the window (inclusive)' }),
  })
  .meta({ id: 'NotesRangeQuery' })

export type NotesRangeQuery = z.infer<typeof notesQueryRangeSchema>

/**
 * Note params (for single note operations).
 */
export const noteParamsSchema = z
  .object({
    id: z.string().uuid().meta({ description: 'Note ID' }),
  })
  .meta({ id: 'NoteParams' })

export type NoteParams = z.infer<typeof noteParamsSchema>

/**
 * Notes response schema.
 */
export const notesResponseSchema = createDataArrayResponseSchema(noteSchema).meta({
  id: 'NotesResponse',
})

export type NotesResponse = z.infer<typeof notesResponseSchema>

/**
 * Single note response schema.
 */
export const noteResponseSchema = createDataResponseSchema(noteSchema).meta({
  id: 'NoteResponse',
})

export type NoteResponse = z.infer<typeof noteResponseSchema>

/**
 * Delete note response.
 */
export const deleteNoteResponseSchema = baseResponseSchema.meta({ id: 'DeleteNoteResponse' })

export type DeleteNoteResponse = z.infer<typeof deleteNoteResponseSchema>
