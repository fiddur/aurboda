/** Reusable starting texts for journal entries. */
import { z } from 'zod'

import {
  baseResponseSchema,
  createDataArrayResponseSchema,
  createDataResponseSchema,
  iso8601DateTimeSchema,
  queryBooleanSchema,
} from './common.ts'

export const NOTE_TEMPLATE_NAME_MAX_LENGTH = 120

export const NOTE_TEMPLATE_CONTENT_MAX_LENGTH = 20_000

export const noteTemplateSchema = z
  .object({
    content: z.string().meta({ description: 'The text a new entry starts from (markdown)' }),
    created_at: iso8601DateTimeSchema,
    deleted_at: iso8601DateTimeSchema.optional().meta({
      description: 'When it was deleted. Only in the list of deleted templates and the restore answer.',
    }),
    id: z.string().uuid().meta({ description: 'Template ID' }),
    name: z.string().meta({ description: 'Template name' }),
    purge_at: iso8601DateTimeSchema.optional().meta({
      description: 'When a deleted template is removed for good. Only in the list of deleted templates.',
    }),
    updated_at: iso8601DateTimeSchema,
  })
  .meta({ description: 'A starting text for journal entries', id: 'NoteTemplate' })

export type NoteTemplate = z.infer<typeof noteTemplateSchema>

const templateNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(NOTE_TEMPLATE_NAME_MAX_LENGTH)
  .meta({ description: `Template name (1 to ${NOTE_TEMPLATE_NAME_MAX_LENGTH} characters, trimmed)` })

const templateContentSchema = z
  .string()
  .min(1)
  .max(NOTE_TEMPLATE_CONTENT_MAX_LENGTH)
  .meta({ description: `Template text, markdown (1 to ${NOTE_TEMPLATE_CONTENT_MAX_LENGTH} characters)` })

export const addNoteTemplateBodySchema = z
  .object({ content: templateContentSchema, name: templateNameSchema })
  .meta({ id: 'AddNoteTemplateBody' })

export type AddNoteTemplateBody = z.infer<typeof addNoteTemplateBodySchema>

export const updateNoteTemplateBodySchema = z
  .object({ content: templateContentSchema.optional(), name: templateNameSchema.optional() })
  .check((ctx) => {
    if (ctx.value.content === undefined && ctx.value.name === undefined) {
      ctx.issues.push({
        code: 'custom',
        input: ctx.value,
        message: 'At least one of name or content must be provided',
        path: ['name'],
      })
    }
  })
  .meta({ id: 'UpdateNoteTemplateBody' })

export type UpdateNoteTemplateBody = z.infer<typeof updateNoteTemplateBodySchema>

export const noteTemplatesQuerySchema = z
  .object({
    deleted: queryBooleanSchema.optional().meta({
      description:
        'true lists the deleted templates that can still be restored, with deleted_at and purge_at',
    }),
  })
  .meta({ id: 'NoteTemplatesQuery' })

export type NoteTemplatesQuery = z.infer<typeof noteTemplatesQuerySchema>

export const deleteNoteTemplateQuerySchema = z
  .object({
    purge: queryBooleanSchema.optional().meta({
      description: 'true removes the template for good at once. Without it a delete can be undone.',
    }),
  })
  .meta({ id: 'DeleteNoteTemplateQuery' })

export type DeleteNoteTemplateQuery = z.infer<typeof deleteNoteTemplateQuerySchema>

export const noteTemplateResponseSchema = createDataResponseSchema(noteTemplateSchema).meta({
  id: 'NoteTemplateResponse',
})

export type NoteTemplateResponse = z.infer<typeof noteTemplateResponseSchema>

export const noteTemplatesResponseSchema = createDataArrayResponseSchema(noteTemplateSchema).meta({
  id: 'NoteTemplatesResponse',
})

export type NoteTemplatesResponse = z.infer<typeof noteTemplatesResponseSchema>

export const deleteNoteTemplateResponseSchema = baseResponseSchema.meta({ id: 'DeleteNoteTemplateResponse' })

export type DeleteNoteTemplateResponse = z.infer<typeof deleteNoteTemplateResponseSchema>
