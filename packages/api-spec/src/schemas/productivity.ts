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

/**
 * Productivity record schema.
 */
export const productivityRecordSchema = z
  .object({
    activity: z.string().meta({ description: 'Activity/application name' }),
    category: z.string().optional().meta({ description: 'Activity category' }),
    deleted_at: iso8601DateTimeSchema.optional().meta({ description: 'Soft-delete timestamp' }),
    duration_sec: z.number().int().meta({ description: 'Duration in seconds' }),
    end_time: iso8601DateTimeSchema,
    id: z.string().uuid().optional().meta({ description: 'Productivity record ID' }),
    is_mobile: z.boolean().optional().meta({ description: 'Whether activity was on mobile' }),
    productivity: z.number().int().optional().meta({
      description: 'Productivity score (-2 to 2)',
      example: 2,
    }),
    source: dataSourceSchema.optional(),
    start_time: iso8601DateTimeSchema,
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
