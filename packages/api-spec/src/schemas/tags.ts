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
} from './common.ts'
import { commentSchema } from './notes.ts'

/**
 * Tag schema.
 */
export const tagSchema = z
  .object({
    comments: z.array(commentSchema).optional().meta({ description: 'Attached comments' }),
    deleted_at: iso8601DateTimeSchema.optional().meta({ description: 'Soft-delete timestamp' }),
    end_time: iso8601DateTimeSchema.optional(),
    external_id: z.string().optional().meta({ description: 'External ID from source' }),
    id: z.string().uuid().optional().meta({ description: 'Tag ID' }),
    source: dataSourceSchema.optional(),
    start_time: iso8601DateTimeSchema,
    tag: tagTextSchema,
    tag_definition_id: z
      .string()
      .uuid()
      .optional()
      .meta({ description: 'Reference to the tag definition this tag belongs to' }),
    tag_key: z
      .string()
      .optional()
      .meta({ description: 'Original programmatic identifier (e.g. Oura tag_type_code)' }),
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
 * Update tag request body.
 */
export const updateTagBodySchema = z
  .object({
    end_time: iso8601DateTimeSchema.nullable().optional().meta({
      description: 'End time (null to clear, omit to keep unchanged)',
    }),
    start_time: iso8601DateTimeSchema.optional().meta({ description: 'Start time' }),
  })
  .meta({ id: 'UpdateTagBody', description: 'Body for updating a tag' })

export type UpdateTagBody = z.infer<typeof updateTagBodySchema>

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
 * Programmatic tag info - tags that can be configured in the tag mapper.
 * Includes programmatic tags (UUIDs, tag_* prefixes) that need human-readable names,
 * as well as all other tags so users can set icons on any tag.
 */
export const programmaticTagSchema = z
  .object({
    count: z.number().int().meta({ description: 'Number of occurrences' }),
    current_name: z.string().nullable().meta({ description: 'Current mapped name (null if unmapped)' }),
    is_programmatic: z
      .boolean()
      .meta({ description: 'Whether this tag needs a name mapping (true for UUIDs/tag_* prefixes)' }),
    latest_time: iso8601DateTimeSchema.meta({ description: 'Most recent occurrence' }),
    tag_key: z.string().meta({ description: 'The tag identifier (programmatic key or tag name)' }),
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
    icon: z.string().optional().meta({
      description:
        'Emoji character, unicode name, or URL (http/https) to an image (SVG/PNG) to use as tag icon',
    }),
    name: z.string().min(1).meta({ description: 'Display name for the tag' }),
    tag_key: z.string().min(1).meta({ description: 'The programmatic tag identifier to map' }),
  })
  .meta({ id: 'SetTagMappingBody' })

export type SetTagMappingBody = z.infer<typeof setTagMappingBodySchema>

/**
 * Tag mapping entry with name and optional icon.
 */
export const tagMappingEntrySchema = z
  .object({
    icon: z.string().optional().meta({ description: 'Emoji, unicode name, or URL for tag icon' }),
    name: z.string().meta({ description: 'Display name for the tag' }),
  })
  .meta({ id: 'TagMappingEntry' })

export type TagMappingEntry = z.infer<typeof tagMappingEntrySchema>

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
    icons: z
      .record(z.string(), z.string())
      .optional()
      .meta({ description: 'Tag icon mappings (tag key or name -> emoji/URL)' }),
    mappings: z
      .record(z.string(), z.string())
      .meta({ description: 'All tag mappings (tag key -> display name)' }),
  })
  .meta({ id: 'TagMappingsResponse' })

export type TagMappingsResponse = z.infer<typeof tagMappingsResponseSchema>

// ============================================================================
// Tag Definitions
// ============================================================================

/**
 * Tag definition — canonical tag identity with aliases for matching.
 */
export const tagDefinitionSchema = z
  .object({
    aliases: z.array(z.string()).meta({ description: 'Lowercase match strings for this tag' }),
    count: z.number().int().optional().meta({ description: 'Number of tag occurrences (when included)' }),
    created_at: iso8601DateTimeSchema.optional(),
    icon: z.string().nullable().optional().meta({ description: 'Emoji or URL icon' }),
    id: z.string().uuid().meta({ description: 'Tag definition ID' }),
    latest_time: iso8601DateTimeSchema.optional().meta({ description: 'Most recent tag occurrence' }),
    name: z.string().meta({ description: 'Display name' }),
    show_on_timeline: z.boolean().optional().meta({ description: 'Whether to show on the timeline' }),
    updated_at: iso8601DateTimeSchema.optional(),
  })
  .meta({ id: 'TagDefinition', description: 'Canonical tag identity with aliases' })

export type TagDefinition = z.infer<typeof tagDefinitionSchema>

/**
 * Create tag definition body.
 */
export const createTagDefinitionBodySchema = z
  .object({
    aliases: z
      .array(z.string())
      .optional()
      .meta({ description: 'Additional lowercase match strings (name is always included)' }),
    icon: z.string().optional().meta({ description: 'Emoji or URL icon' }),
    name: z.string().min(1).meta({ description: 'Display name for the tag definition' }),
  })
  .meta({ id: 'CreateTagDefinitionBody', description: 'Body for creating a tag definition' })

export type CreateTagDefinitionBody = z.infer<typeof createTagDefinitionBodySchema>

/**
 * Update tag definition body.
 */
export const updateTagDefinitionBodySchema = z
  .object({
    aliases: z
      .array(z.string())
      .optional()
      .meta({ description: 'Replace aliases (name is always included)' }),
    icon: z.string().nullable().optional().meta({ description: 'Emoji or URL icon (null to clear)' }),
    name: z.string().min(1).optional().meta({ description: 'New display name' }),
  })
  .meta({ id: 'UpdateTagDefinitionBody', description: 'Body for updating a tag definition' })

export type UpdateTagDefinitionBody = z.infer<typeof updateTagDefinitionBodySchema>

/**
 * Merge tag definitions body.
 */
export const mergeTagDefinitionsBodySchema = z
  .object({
    target_id: z.string().uuid().meta({ description: 'ID of the definition to merge INTO (kept)' }),
  })
  .meta({
    id: 'MergeTagDefinitionsBody',
    description: 'Merge this definition into the target. Moves all aliases and re-links all tags.',
  })

export type MergeTagDefinitionsBody = z.infer<typeof mergeTagDefinitionsBodySchema>

/**
 * Tag definitions response.
 */
export const tagDefinitionsResponseSchema = createDataArrayResponseSchema(tagDefinitionSchema).meta({
  id: 'TagDefinitionsResponse',
})

export type TagDefinitionsResponse = z.infer<typeof tagDefinitionsResponseSchema>
