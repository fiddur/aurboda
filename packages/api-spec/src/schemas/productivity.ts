/**
 * Productivity schemas.
 */

import { z } from 'zod'
import {
  createDataArrayResponseSchema,
  dataSourceSchema,
  iso8601DateTimeSchema,
  timeRangeQuerySchema,
} from './common.js'
import { commentSchema } from './notes.js'

/**
 * Productivity record schema.
 */
export const productivityRecordSchema = z
  .object({
    activity: z.string().meta({ description: 'Activity/application name' }),
    category: z.string().optional().meta({ description: 'Original category (from RescueTime)' }),
    comments: z.array(commentSchema).optional().meta({ description: 'Attached comments' }),
    deleted_at: iso8601DateTimeSchema.optional().meta({ description: 'Soft-delete timestamp' }),
    duration_sec: z.number().int().meta({ description: 'Duration in seconds' }),
    end_time: iso8601DateTimeSchema,
    id: z.string().uuid().optional().meta({ description: 'Productivity record ID' }),
    is_mobile: z.boolean().optional().meta({ description: 'Whether activity was on mobile' }),
    productivity: z.number().int().optional().meta({
      description: 'Productivity score (-2 to 2)',
      example: 2,
    }),
    resolved_category: z.array(z.string()).optional().meta({
      description: 'Resolved category path from screentime rules, e.g. ["Work", "Programming"]',
    }),
    source: dataSourceSchema.optional(),
    source_ids: z
      .array(z.string().uuid())
      .optional()
      .meta({ description: 'IDs of all constituent records when spans were merged' }),
    start_time: iso8601DateTimeSchema,
    title: z.string().optional().meta({ description: 'Window title (from ActivityWatch)' }),
  })
  .meta({ id: 'ProductivityRecord' })

export type ProductivityRecord = z.infer<typeof productivityRecordSchema>

/**
 * Productivity query schema.
 */
export const productivityQuerySchema = timeRangeQuerySchema.meta({ id: 'ProductivityQuery' })

export type ProductivityQuery = z.infer<typeof productivityQuerySchema>

/**
 * Productivity response schema.
 */
export const productivityResponseSchema = createDataArrayResponseSchema(productivityRecordSchema).meta({
  id: 'ProductivityResponse',
})

export type ProductivityResponse = z.infer<typeof productivityResponseSchema>
