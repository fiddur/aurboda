/**
 * Productivity schemas.
 */

import { z } from 'zod'

import {
  baseResponseSchema,
  createDataArrayResponseSchema,
  dataSourceSchema,
  iso8601DateTimeSchema,
  timeRangeQuerySchema,
} from './common.ts'
import { bucketSizeSchema } from './metrics.ts'
import { commentSchema } from './notes.ts'

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

/**
 * Category duration within a screentime bucket.
 */
export const screentimeBucketCategorySchema = z
  .object({
    path: z.array(z.string()).meta({ description: 'Category path, e.g. ["Work", "Programming"]' }),
    total_sec: z.number().int().meta({ description: 'Total duration in seconds for this category' }),
  })
  .meta({ id: 'ScreentimeBucketCategory' })

/**
 * A single time bucket with aggregated screentime by category.
 */
export const screentimeBucketSchema = z
  .object({
    categories: z.array(screentimeBucketCategorySchema).meta({
      description: 'Duration per resolved category within this bucket',
    }),
    end: iso8601DateTimeSchema.meta({ description: 'Bucket end time' }),
    start: iso8601DateTimeSchema.meta({ description: 'Bucket start time' }),
    total_sec: z.number().int().meta({ description: 'Total screentime duration in seconds' }),
  })
  .meta({ id: 'ScreentimeBucket' })

export type ScreentimeBucket = z.infer<typeof screentimeBucketSchema>

/**
 * Query bucketed screentime request.
 */
export const screentimeBucketedQuerySchema = timeRangeQuerySchema
  .extend({
    bucket: bucketSizeSchema,
    tz: z.string().optional().meta({
      description: 'IANA timezone for bucket alignment (e.g. "Europe/Stockholm"). Defaults to UTC.',
      example: 'Europe/Stockholm',
    }),
  })
  .meta({ id: 'ScreentimeBucketedQuery' })

export type ScreentimeBucketedQuery = z.infer<typeof screentimeBucketedQuerySchema>

/**
 * Bucketed screentime response.
 */
export const screentimeBucketedResponseSchema = baseResponseSchema
  .extend({
    bucket: bucketSizeSchema.optional(),
    buckets: z.array(screentimeBucketSchema).optional(),
    end: iso8601DateTimeSchema.optional(),
    start: iso8601DateTimeSchema.optional(),
  })
  .meta({ id: 'ScreentimeBucketedResponse' })

export type ScreentimeBucketedResponse = z.infer<typeof screentimeBucketedResponseSchema>
