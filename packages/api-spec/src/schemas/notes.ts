/**
 * Notes schemas.
 */

import { z } from 'zod'
import {
  baseResponseSchema,
  createDataArrayResponseSchema,
  createDataResponseSchema,
  iso8601DateTimeSchema,
} from './common.js'

/**
 * Valid entity types for notes and soft-delete references.
 */
export const entityTypes = ['activity', 'tag', 'productivity', 'metric'] as const

export const entityTypeSchema = z.enum(entityTypes).meta({
  description: 'Entity type for polymorphic references',
  example: 'activity',
  id: 'EntityType',
})

export type EntityType = z.infer<typeof entityTypeSchema>

/**
 * Note schema.
 */
export const noteSchema = z
  .object({
    content: z.string().meta({ description: 'Note content (markdown)' }),
    created_at: iso8601DateTimeSchema.optional(),
    end_time: iso8601DateTimeSchema.optional().meta({
      description: 'End time inherited from the parent entity (if any)',
    }),
    entity_id: z
      .string()
      .meta({ description: 'ID of the referenced entity (UUID for most types, composite key for metrics)' }),
    entity_type: entityTypeSchema,
    id: z.string().uuid().optional().meta({ description: 'Note ID' }),
    start_time: iso8601DateTimeSchema.optional().meta({
      description: 'Start time inherited from the parent entity',
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
    start_time: iso8601DateTimeSchema.optional().meta({
      description: 'Start time inherited from the parent entity',
    }),
    updated_at: iso8601DateTimeSchema.optional(),
  })
  .meta({ description: 'A comment attached to an entity', id: 'Comment' })

export type Comment = z.infer<typeof commentSchema>

/**
 * Add note request body.
 */
export const addNoteBodySchema = z
  .object({
    content: z.string().min(1).meta({ description: 'Note content (markdown)' }),
    entity_id: z
      .string()
      .min(1)
      .meta({ description: 'ID of the referenced entity (UUID for most types, composite key for metrics)' }),
    entity_type: entityTypeSchema,
  })
  .meta({ id: 'AddNoteBody' })

export type AddNoteBody = z.infer<typeof addNoteBodySchema>

/**
 * Update note request body.
 */
export const updateNoteBodySchema = z
  .object({
    content: z.string().min(1).meta({ description: 'Updated note content (markdown)' }),
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
