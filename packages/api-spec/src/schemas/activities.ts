/**
 * Activities schemas.
 */

import { z } from 'zod'
import {
  createDataArrayResponseSchema,
  durationMinutesSchema,
  iso8601DateTimeSchema,
  timeRangeQuerySchema,
} from './common.js'
import { hrZoneSecsSchema } from './settings.js'

/**
 * Activity schema.
 */
export const activitySchema = z
  .object({
    activityType: z.string().meta({ description: 'Activity type' }),
    data: z.record(z.string(), z.unknown()).optional(),
    duration: durationMinutesSchema.optional(),
    endTime: iso8601DateTimeSchema.optional(),
    hrZoneSecs: hrZoneSecsSchema.optional().meta({
      description: 'Time spent in each HR zone (for exercise)',
    }),
    id: z.string().uuid().optional().meta({ description: 'Activity ID' }),
    notes: z.string().optional().meta({ description: 'Activity notes' }),
    source: z.string().optional().meta({ description: 'Data source' }),
    startTime: iso8601DateTimeSchema,
    title: z.string().optional().meta({ description: 'Activity title' }),
  })
  .meta({ id: 'Activity' })

export type Activity = z.infer<typeof activitySchema>

/**
 * Activities query schema.
 */
export const activitiesQuerySchema = timeRangeQuerySchema
  .extend({
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
export const activitiesResponseSchema = createDataArrayResponseSchema(activitySchema).meta({
  id: 'ActivitiesResponse',
})

export type ActivitiesResponse = z.infer<typeof activitiesResponseSchema>
