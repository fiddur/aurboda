/**
 * Tags schemas.
 */

import { z } from 'zod'
import { dataSourceSchema, iso8601DateTimeSchema } from './common.js'

/**
 * Tag schema.
 */
export const tagSchema = z
  .object({
    id: z.string().uuid().optional().meta({ description: 'Tag ID' }),
    source: dataSourceSchema,
    externalId: z.string().optional().meta({ description: 'External ID from source' }),
    tag: z.string().meta({ description: 'Tag/label text', example: 'coffee' }),
    startTime: iso8601DateTimeSchema,
    endTime: iso8601DateTimeSchema.optional(),
  })
  .meta({ id: 'Tag' })

export type Tag = z.infer<typeof tagSchema>

/**
 * Tags query schema.
 */
export const tagsQuerySchema = z
  .object({
    start: iso8601DateTimeSchema.meta({ description: 'Start date/time' }),
    end: iso8601DateTimeSchema.meta({ description: 'End date/time' }),
  })
  .meta({ id: 'TagsQuery' })

export type TagsQuery = z.infer<typeof tagsQuerySchema>

/**
 * Tags response schema.
 */
export const tagsResponseSchema = z
  .object({
    success: z.boolean(),
    data: z.array(tagSchema).optional(),
    error: z.string().optional(),
  })
  .meta({ id: 'TagsResponse' })

export type TagsResponse = z.infer<typeof tagsResponseSchema>

/**
 * Add tag request body.
 */
export const addTagBodySchema = z
  .object({
    tag: z.string().min(1).meta({ description: 'Tag/label text', example: 'coffee' }),
    start_time: iso8601DateTimeSchema.meta({ description: 'Start time of the tag' }),
    end_time: iso8601DateTimeSchema.optional().meta({
      description: 'End time (omit for point-in-time tags)',
    }),
  })
  .meta({ id: 'AddTagBody' })

export type AddTagBody = z.infer<typeof addTagBodySchema>

/**
 * Add tag response.
 */
export const addTagResponseSchema = z
  .object({
    success: z.boolean(),
    data: z
      .object({
        id: z.string().uuid(),
        tag: z.string(),
        startTime: iso8601DateTimeSchema,
        endTime: iso8601DateTimeSchema.optional(),
      })
      .optional(),
    error: z.string().optional(),
  })
  .meta({ id: 'AddTagResponse' })

export type AddTagResponse = z.infer<typeof addTagResponseSchema>

/**
 * Delete tag params.
 */
export const deleteTagParamsSchema = z
  .object({
    externalId: z.string().meta({ description: 'External ID of the tag to delete' }),
  })
  .meta({ id: 'DeleteTagParams' })

export type DeleteTagParams = z.infer<typeof deleteTagParamsSchema>

/**
 * Delete tag response.
 */
export const deleteTagResponseSchema = z
  .object({
    success: z.boolean(),
    error: z.string().optional(),
  })
  .meta({ id: 'DeleteTagResponse' })

export type DeleteTagResponse = z.infer<typeof deleteTagResponseSchema>
