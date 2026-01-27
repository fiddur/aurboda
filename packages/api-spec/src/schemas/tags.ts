/**
 * Tags schemas.
 */

import { z } from 'zod'
import {
  baseResponseSchema,
  createDataArrayResponseSchema,
  dataSourceSchema,
  iso8601DateTimeSchema,
  timeRangeQuerySchema,
} from './common.js'

// Shared tag text field
const tagTextSchema = z.string().meta({ description: 'Tag/label text', example: 'coffee' })

/**
 * Tag schema.
 */
export const tagSchema = z
  .object({
    endTime: iso8601DateTimeSchema.optional(),
    externalId: z.string().optional().meta({ description: 'External ID from source' }),
    id: z.string().uuid().optional().meta({ description: 'Tag ID' }),
    source: dataSourceSchema.optional(),
    startTime: iso8601DateTimeSchema,
    tag: tagTextSchema,
  })
  .meta({ id: 'Tag' })

export type Tag = z.infer<typeof tagSchema>

/**
 * Tags query schema.
 */
export const tagsQuerySchema = timeRangeQuerySchema.meta({ id: 'TagsQuery' })

export type TagsQuery = z.infer<typeof tagsQuerySchema>

/**
 * Tags response schema.
 */
export const tagsResponseSchema = createDataArrayResponseSchema(tagSchema).meta({ id: 'TagsResponse' })

export type TagsResponse = z.infer<typeof tagsResponseSchema>

/**
 * Add tag request body.
 */
export const addTagBodySchema = z
  .object({
    end_time: iso8601DateTimeSchema.optional().meta({
      description: 'End time (omit for point-in-time tags)',
    }),
    start_time: iso8601DateTimeSchema.meta({ description: 'Start time of the tag' }),
    tag: tagTextSchema.min(1),
  })
  .meta({ id: 'AddTagBody' })

export type AddTagBody = z.infer<typeof addTagBodySchema>

/**
 * Added tag data schema.
 */
const addedTagSchema = z.object({
  endTime: iso8601DateTimeSchema.optional(),
  id: z.string().uuid(),
  startTime: iso8601DateTimeSchema,
  tag: z.string(),
})

/**
 * Add tag response.
 */
export const addTagResponseSchema = baseResponseSchema
  .extend({
    data: addedTagSchema.optional(),
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
export const deleteTagResponseSchema = baseResponseSchema.meta({ id: 'DeleteTagResponse' })

export type DeleteTagResponse = z.infer<typeof deleteTagResponseSchema>
