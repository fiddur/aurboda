/**
 * Productivity schemas.
 */

import { z } from 'zod'
import { dataSourceSchema, iso8601DateTimeSchema } from './common.js'

/**
 * Productivity record schema.
 */
export const productivityRecordSchema = z
  .object({
    activity: z.string().meta({ description: 'Activity/application name' }),
    category: z.string().optional().meta({ description: 'Activity category' }),
    durationSec: z.number().int().meta({ description: 'Duration in seconds' }),
    endTime: iso8601DateTimeSchema,
    isMobile: z.boolean().optional().meta({ description: 'Whether activity was on mobile' }),
    productivity: z.number().int().optional().meta({
      description: 'Productivity score (-2 to 2)',
      example: 2,
    }),
    source: dataSourceSchema.optional(),
    startTime: iso8601DateTimeSchema,
  })
  .meta({ id: 'ProductivityRecord' })

export type ProductivityRecord = z.infer<typeof productivityRecordSchema>

/**
 * Productivity query schema.
 */
export const productivityQuerySchema = z
  .object({
    end: iso8601DateTimeSchema.meta({ description: 'End date/time' }),
    start: iso8601DateTimeSchema.meta({ description: 'Start date/time' }),
  })
  .meta({ id: 'ProductivityQuery' })

export type ProductivityQuery = z.infer<typeof productivityQuerySchema>

/**
 * Productivity response schema.
 */
export const productivityResponseSchema = z
  .object({
    data: z.array(productivityRecordSchema).optional(),
    error: z.string().optional(),
    success: z.boolean(),
  })
  .meta({ id: 'ProductivityResponse' })

export type ProductivityResponse = z.infer<typeof productivityResponseSchema>
