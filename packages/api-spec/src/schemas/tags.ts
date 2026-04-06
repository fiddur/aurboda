/**
 * Legacy tag schemas — kept for backward compatibility.
 *
 * Tags have been absorbed into activities. Tag definitions have been replaced
 * by activity type definitions. Only schemas still referenced by existing code
 * are retained here.
 */

import { z } from 'zod'

import { createDataArrayResponseSchema, iso8601DateTimeSchema } from './common.ts'

// ============================================================================
// Tag Mappings (still used by MCP settings tools)
// ============================================================================

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

// ============================================================================
// Tag Definitions (legacy — delegates to activity type definitions)
// ============================================================================

/**
 * Tag definition — legacy type kept for frontend compatibility.
 * Maps to ActivityTypeDefinition under the hood.
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
 * Tag definitions response.
 */
export const tagDefinitionsResponseSchema = createDataArrayResponseSchema(tagDefinitionSchema).meta({
  id: 'TagDefinitionsResponse',
})

export type TagDefinitionsResponse = z.infer<typeof tagDefinitionsResponseSchema>
