/**
 * Screentime category schemas for user-defined app/activity categorization.
 *
 * Categories follow a hierarchical structure compatible with ActivityWatch:
 * - name is a path array, e.g. ["Work", "Programming"]
 * - rules use regex matching against activity name and window title
 * - deepest matching subcategory wins
 * - colors and scores inherit from parent if not set
 */

import { z } from 'zod'

import { baseResponseSchema, createDataArrayResponseSchema, createDataResponseSchema } from './common.ts'

/**
 * Rule type for screentime categories.
 */
export const screentimeRuleTypeSchema = z.enum(['regex', 'none']).meta({
  description: 'Rule type: regex for pattern matching, none for grouping-only categories',
  id: 'ScreentimeRuleType',
})

/**
 * Full screentime category record.
 */
export const screentimeCategorySchema = z
  .object({
    color: z
      .string()
      .optional()
      .meta({ description: 'Hex color (e.g. "#22c55e"). Inherited from parent if not set.' }),
    created_at: z.string().optional().meta({ description: 'Creation timestamp' }),
    exclude_from_screentime: z.boolean().optional().meta({
      description:
        'When true, records matching this category are excluded from screen time summaries and timelines. Useful for idle/background apps like plasmashell.',
    }),
    id: z.string().uuid().meta({ description: 'Category ID' }),
    ignore_case: z.boolean().meta({ description: 'Whether regex matching is case-insensitive' }),
    name: z
      .array(z.string())
      .min(1)
      .meta({
        description: 'Hierarchical category path, e.g. ["Work", "Programming"]',
        example: ['Work', 'Programming'],
      }),
    rule_regex: z.string().optional().meta({
      description: 'Regex pattern to match against activity name and window title',
      example: 'Visual Studio Code|vscode|GitHub',
    }),
    rule_type: screentimeRuleTypeSchema,
    score: z.number().int().optional().meta({
      description: 'Productivity score (-2 to 2). Inherited from parent if not set.',
    }),
    sort_order: z.number().int().meta({ description: 'Sort order for display' }),
    updated_at: z.string().optional().meta({ description: 'Last update timestamp' }),
  })
  .meta({ description: 'A screentime categorization rule', id: 'ScreentimeCategory' })

export type ScreentimeCategory = z.infer<typeof screentimeCategorySchema>

/**
 * Body for creating a screentime category.
 */
export const createScreentimeCategoryBodySchema = z
  .object({
    color: z.string().optional().meta({ description: 'Hex color (e.g. "#22c55e")' }),
    exclude_from_screentime: z
      .boolean()
      .optional()
      .meta({ description: 'Exclude from screen time summaries and timelines' }),
    ignore_case: z
      .boolean()
      .optional()
      .meta({ description: 'Case-insensitive regex matching (defaults to true)' }),
    name: z
      .array(z.string())
      .min(1)
      .meta({
        description: 'Hierarchical category path',
        example: ['Work', 'Programming'],
      }),
    rule_regex: z.string().optional().meta({ description: 'Regex pattern' }),
    rule_type: screentimeRuleTypeSchema.optional().meta({ description: 'Rule type (defaults to none)' }),
    score: z.number().int().optional().meta({ description: 'Productivity score (-2 to 2)' }),
    sort_order: z.number().int().optional().meta({ description: 'Sort order' }),
  })
  .meta({ description: 'Create a screentime category', id: 'CreateScreentimeCategoryBody' })

export type CreateScreentimeCategoryBody = z.infer<typeof createScreentimeCategoryBodySchema>

/**
 * Body for updating a screentime category.
 */
export const updateScreentimeCategoryBodySchema = z
  .object({
    color: z.string().optional().meta({ description: 'Hex color' }),
    exclude_from_screentime: z
      .boolean()
      .optional()
      .meta({ description: 'Exclude from screen time summaries and timelines' }),
    ignore_case: z.boolean().optional().meta({ description: 'Case-insensitive regex matching' }),
    name: z.array(z.string()).min(1).optional().meta({ description: 'Hierarchical category path' }),
    rule_regex: z.string().optional().meta({ description: 'Regex pattern' }),
    rule_type: screentimeRuleTypeSchema.optional(),
    score: z.number().int().optional().meta({ description: 'Productivity score (-2 to 2)' }),
    sort_order: z.number().int().optional().meta({ description: 'Sort order' }),
  })
  .meta({ description: 'Update a screentime category', id: 'UpdateScreentimeCategoryBody' })

export type UpdateScreentimeCategoryBody = z.infer<typeof updateScreentimeCategoryBodySchema>

/**
 * Response for a list of screentime categories.
 */
export const screentimeCategoryListResponseSchema = createDataArrayResponseSchema(
  screentimeCategorySchema,
).meta({ id: 'ScreentimeCategoryListResponse' })

export type ScreentimeCategoryListResponse = z.infer<typeof screentimeCategoryListResponseSchema>

/**
 * Response for a single screentime category.
 */
export const screentimeCategoryResponseSchema = createDataResponseSchema(screentimeCategorySchema).meta({
  id: 'ScreentimeCategoryResponse',
})

export type ScreentimeCategoryResponse = z.infer<typeof screentimeCategoryResponseSchema>

/**
 * ActivityWatch category format (for import).
 */
export const awCategorySchema = z.object({
  data: z
    .object({
      color: z.string().optional(),
      score: z.number().optional(),
    })
    .optional(),
  name: z.array(z.string()),
  rule: z.object({
    ignore_case: z.boolean().optional(),
    regex: z.string().optional(),
    type: z.enum(['regex', 'none']).nullable(),
  }),
})

export type AwCategory = z.infer<typeof awCategorySchema>

/**
 * Body for importing categories from ActivityWatch.
 */
export const importAwCategoriesBodySchema = z
  .object({
    categories: z.array(awCategorySchema).optional().meta({
      description:
        'Categories to import directly. If not provided, fetches from the ActivityWatch server URL.',
    }),
    replace: z.boolean().optional().default(false).meta({
      description: 'If true, replace all existing categories. If false, merge/append.',
    }),
    url: z.string().optional().default('http://localhost:5600').meta({
      description: 'ActivityWatch server URL to import from',
    }),
  })
  .meta({ description: 'Import categories from ActivityWatch', id: 'ImportAwCategoriesBody' })

export type ImportAwCategoriesBody = z.infer<typeof importAwCategoriesBodySchema>

/**
 * Move category body schema.
 */
export const moveScreentimeCategoryBodySchema = z
  .object({
    new_parent_id: z
      .string()
      .uuid()
      .nullable()
      .meta({ description: 'New parent category ID, or null for root' }),
  })
  .meta({ description: 'Move a category to a new parent', id: 'MoveScreentimeCategoryBody' })

export type MoveScreentimeCategoryBody = z.infer<typeof moveScreentimeCategoryBodySchema>

/**
 * Delete screentime category response.
 */
export const deleteScreentimeCategoryResponseSchema = baseResponseSchema
  .extend({
    deleted: z.number().int().optional().meta({ description: 'Number of categories deleted' }),
  })
  .meta({ id: 'DeleteScreentimeCategoryResponse' })

export type DeleteScreentimeCategoryResponse = z.infer<typeof deleteScreentimeCategoryResponseSchema>

/**
 * Move screentime category response.
 */
export const moveScreentimeCategoryResponseSchema = baseResponseSchema
  .extend({
    updated: z.number().int().meta({ description: 'Number of categories updated' }),
  })
  .meta({ id: 'MoveScreentimeCategoryResponse' })

export type MoveScreentimeCategoryResponse = z.infer<typeof moveScreentimeCategoryResponseSchema>

/**
 * Recategorize screentime response.
 */
export const recategorizeScreentimeResponseSchema = baseResponseSchema
  .extend({
    records_updated: z.number().int().optional().meta({ description: 'Number of records recategorized' }),
  })
  .meta({ id: 'RecategorizeScreentimeResponse' })

export type RecategorizeScreentimeResponse = z.infer<typeof recategorizeScreentimeResponseSchema>

/**
 * Default screentime categories response.
 */
export const screentimeCategoryDefaultsResponseSchema = createDataArrayResponseSchema(
  createScreentimeCategoryBodySchema,
).meta({ id: 'ScreentimeCategoryDefaultsResponse' })

export type ScreentimeCategoryDefaultsResponse = z.infer<typeof screentimeCategoryDefaultsResponseSchema>

/**
 * Default categories (matching ActivityWatch defaults) that can be suggested to users.
 */
export const defaultScreentimeCategories: CreateScreentimeCategoryBody[] = [
  {
    color: '#22c55e',
    name: ['Work'],
    rule_regex: 'Google Docs|libreoffice|ReText',
    rule_type: 'regex',
    score: 2,
  },
  {
    name: ['Work', 'Programming'],
    rule_regex: 'GitHub|Stack Overflow|BitBucket|Gitlab|vim|Spyder|kate|Ghidra',
    rule_type: 'regex',
  },
  {
    name: ['Work', 'Programming', 'ActivityWatch'],
    rule_regex: 'ActivityWatch|aw-',
    rule_type: 'regex',
  },
  { name: ['Work', 'Image'], rule_regex: 'GIMP|Inkscape', rule_type: 'regex' },
  { name: ['Work', 'Video'], rule_regex: 'Kdenlive', rule_type: 'regex' },
  { name: ['Work', 'Audio'], rule_regex: 'Audacity', rule_type: 'regex' },
  { name: ['Work', '3D'], rule_regex: 'Blender', rule_type: 'regex' },
  { color: '#ef4444', name: ['Media'], rule_type: 'none', score: -1 },
  {
    color: '#f97316',
    name: ['Media', 'Games'],
    rule_regex: 'Minecraft|Steam|RimWorld',
    rule_type: 'regex',
  },
  {
    color: '#ef4444',
    name: ['Media', 'Video'],
    rule_regex: 'YouTube|Plex|VLC|Netflix',
    rule_type: 'regex',
  },
  {
    color: '#eab308',
    name: ['Media', 'Social Media'],
    rule_regex: 'reddit|Facebook|Twitter|Instagram|TikTok',
    rule_type: 'regex',
  },
  {
    color: '#a3e635',
    name: ['Media', 'Music'],
    rule_regex: 'Spotify|Deezer|Tidal',
    rule_type: 'regex',
  },
  { color: '#06b6d4', name: ['Comms'], rule_type: 'none', score: 0 },
  {
    name: ['Comms', 'IM'],
    rule_regex: 'Messenger|Telegram|Signal|WhatsApp|Slack|Discord|Element|Mattermost',
    rule_type: 'regex',
  },
  {
    name: ['Comms', 'Email'],
    rule_regex: 'Gmail|Thunderbird|mutt|alpine',
    rule_type: 'regex',
  },
]
