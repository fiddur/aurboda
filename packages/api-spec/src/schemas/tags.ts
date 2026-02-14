/**
 * Tags schemas.
 */

import { z } from 'zod'
import {
  baseResponseSchema,
  createDataArrayResponseSchema,
  dataSourceSchema,
  iso8601DateTimeSchema,
  tagTextSchema,
  timeRangeQuerySchema,
} from './common.js'

/**
 * Tag schema.
 */
export const tagSchema = z
  .object({
    end_time: iso8601DateTimeSchema.optional(),
    external_id: z.string().optional().meta({ description: 'External ID from source' }),
    id: z.string().uuid().optional().meta({ description: 'Tag ID' }),
    source: dataSourceSchema.optional(),
    start_time: iso8601DateTimeSchema,
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
    merge_span: z.number().int().positive().max(3600).optional().meta({
      description:
        'If provided, merge with existing tag of same name if its end_time (or start_time for point-in-time tags) is within this many seconds of new start_time. Max 3600.',
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
  end_time: iso8601DateTimeSchema.optional(),
  id: z.string().uuid(),
  start_time: iso8601DateTimeSchema,
  tag: z.string(),
})

/**
 * Add tag response.
 */
export const addTagResponseSchema = baseResponseSchema
  .extend({
    data: addedTagSchema.optional(),
    extended_by_seconds: z.number().int().optional().meta({
      description: 'Number of seconds the tag was extended by (only present if merged)',
    }),
    merged: z.boolean().optional().meta({
      description:
        'Whether the tag was merged with an existing tag (only present if merge_span was specified)',
    }),
  })
  .meta({ id: 'AddTagResponse' })

export type AddTagResponse = z.infer<typeof addTagResponseSchema>

/**
 * Delete tag params.
 */
export const deleteTagParamsSchema = z
  .object({
    external_id: z.string().meta({ description: 'External ID of the tag to delete' }),
  })
  .meta({ id: 'DeleteTagParams' })

export type DeleteTagParams = z.infer<typeof deleteTagParamsSchema>

/**
 * Delete tag response.
 */
export const deleteTagResponseSchema = baseResponseSchema.meta({ id: 'DeleteTagResponse' })

export type DeleteTagResponse = z.infer<typeof deleteTagResponseSchema>

/**
 * Unique tags response schema.
 */
export const uniqueTagsResponseSchema = baseResponseSchema
  .extend({
    data: z.array(z.string()).meta({ description: 'List of unique tag names' }),
  })
  .meta({ id: 'UniqueTagsResponse' })

export type UniqueTagsResponse = z.infer<typeof uniqueTagsResponseSchema>

/**
 * Programmatic tag info - tags that look like they need human-readable names.
 * Includes UUIDs (Oura custom tags), tag_* prefixes (Oura presets), etc.
 */
export const programmaticTagSchema = z
  .object({
    count: z.number().int().meta({ description: 'Number of occurrences' }),
    current_name: z.string().nullable().meta({ description: 'Current mapped name (null if unmapped)' }),
    latest_time: iso8601DateTimeSchema.meta({ description: 'Most recent occurrence' }),
    tag_key: z.string().meta({ description: 'The programmatic tag identifier (UUID, tag_* prefix, etc.)' }),
  })
  .meta({ id: 'ProgrammaticTag' })

export type ProgrammaticTag = z.infer<typeof programmaticTagSchema>

/**
 * Programmatic tags response schema.
 */
export const programmaticTagsResponseSchema = baseResponseSchema
  .extend({
    data: z
      .array(programmaticTagSchema)
      .meta({ description: 'List of programmatic tags that can be mapped' }),
  })
  .meta({ id: 'ProgrammaticTagsResponse' })

export type ProgrammaticTagsResponse = z.infer<typeof programmaticTagsResponseSchema>

/**
 * Set tag mapping body schema.
 */
export const setTagMappingBodySchema = z
  .object({
    name: z.string().min(1).meta({ description: 'Display name for the tag' }),
    tag_key: z.string().min(1).meta({ description: 'The programmatic tag identifier to map' }),
  })
  .meta({ id: 'SetTagMappingBody' })

export type SetTagMappingBody = z.infer<typeof setTagMappingBodySchema>

/**
 * Set tag mapping response schema.
 */
export const setTagMappingResponseSchema = baseResponseSchema
  .extend({
    mapping: z.record(z.string(), z.string()).meta({ description: 'Updated tag mappings' }),
  })
  .meta({ id: 'SetTagMappingResponse' })

export type SetTagMappingResponse = z.infer<typeof setTagMappingResponseSchema>

/**
 * Get tag mappings response schema.
 */
export const tagMappingsResponseSchema = baseResponseSchema
  .extend({
    mappings: z
      .record(z.string(), z.string())
      .meta({ description: 'All tag mappings (tag key -> display name)' }),
  })
  .meta({ id: 'TagMappingsResponse' })

export type TagMappingsResponse = z.infer<typeof tagMappingsResponseSchema>
