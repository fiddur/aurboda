/**
 * Activities schemas.
 */

import { z } from 'zod'
import { activityTypeSchema, dataSourceSchema, iso8601DateTimeSchema } from './common.js'
import { hrZoneSecsSchema } from './settings.js'

/**
 * Activity schema.
 */
export const activitySchema = z
  .object({
    id: z.string().uuid().optional().meta({ description: 'Activity ID' }),
    source: dataSourceSchema,
    activityType: activityTypeSchema,
    startTime: iso8601DateTimeSchema,
    endTime: iso8601DateTimeSchema.optional(),
    duration: z.number().optional().meta({ description: 'Duration in minutes' }),
    title: z.string().optional().meta({ description: 'Activity title' }),
    notes: z.string().optional().meta({ description: 'Activity notes' }),
    data: z.record(z.string(), z.unknown()).optional(),
    hrZoneSecs: hrZoneSecsSchema.optional().meta({
      description: 'Time spent in each HR zone (for exercise)',
    }),
  })
  .meta({ id: 'Activity' })

export type Activity = z.infer<typeof activitySchema>

/**
 * Activities query schema.
 */
export const activitiesQuerySchema = z
  .object({
    start: iso8601DateTimeSchema.meta({ description: 'Start date/time' }),
    end: iso8601DateTimeSchema.meta({ description: 'End date/time' }),
    types: z.string().optional().meta({
      description: 'Comma-separated activity types',
      example: 'sleep,exercise',
    }),
  })
  .meta({ id: 'ActivitiesQuery' })

export type ActivitiesQuery = z.infer<typeof activitiesQuerySchema>

/**
 * Activities response schema.
 */
export const activitiesResponseSchema = z
  .object({
    success: z.boolean(),
    data: z.array(activitySchema).optional(),
    error: z.string().optional(),
  })
  .meta({ id: 'ActivitiesResponse' })

export type ActivitiesResponse = z.infer<typeof activitiesResponseSchema>
