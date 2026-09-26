import { z } from 'zod'

import { activityTypeSchema, createDataResponseSchema, iso8601DateTimeSchema } from './common.ts'
import { hrZoneSecsSchema } from './settings.ts'

const dataFieldNameSchema = z.string().regex(/^[a-z][a-z0-9_]*$/)

export const valueDistributionSchema = z
  .object({
    max: z.number(),
    median: z.number(),
    min: z.number(),
    q1: z.number().meta({ description: '25th percentile' }),
    q3: z.number().meta({ description: '75th percentile' }),
    sample_count: z.number().int().meta({ description: 'Number of samples the summary is built from' }),
  })
  .meta({
    description: 'Five-number summary (min, quartiles, max) of time-series samples, for box plots',
    id: 'ValueDistribution',
  })

export type ValueDistribution = z.infer<typeof valueDistributionSchema>

export const activitySessionSchema = z
  .object({
    activity_type: z.string().meta({ description: 'Activity type' }),
    avg_hr: z.number().optional().meta({ description: 'Average heart rate (bpm)' }),
    calories: z.number().optional().meta({ description: 'Calories burned (kcal)' }),
    distance: z.number().optional().meta({ description: 'Distance (m)' }),
    duration: z.number().optional().meta({ description: 'Duration in minutes' }),
    end_time: iso8601DateTimeSchema.optional(),
    fields: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .meta({ description: "Values of the activity type's data_schema fields present on this session" }),
    hr: valueDistributionSchema.optional().meta({ description: 'Distribution of heart rate samples (bpm)' }),
    hr_zone_secs: hrZoneSecsSchema.optional().meta({ description: 'Time spent in each HR zone' }),
    id: z.string().meta({
      description: 'Activity ID, prefixed "merged:" when the session is merged from several sources',
    }),
    max_hr: z.number().optional().meta({ description: 'Maximum heart rate (bpm)' }),
    start_time: iso8601DateTimeSchema,
    title: z.string().optional(),
  })
  .meta({
    description: 'One session of an activity type with its heart-rate summary',
    id: 'ActivitySession',
  })

export type ActivitySession = z.infer<typeof activitySessionSchema>

export const activitySessionGroupSchema = z
  .object({
    avg_hr_median: z
      .number()
      .optional()
      .meta({ description: 'Median of the average heart rates of the sessions' }),
    count: z.number().int().meta({ description: 'Number of sessions in the group' }),
    duration_max: z.number().optional().meta({ description: 'Longest session (minutes)' }),
    duration_median: z.number().optional().meta({ description: 'Median session length (minutes)' }),
    duration_min: z.number().optional().meta({ description: 'Shortest session (minutes)' }),
    first_start_time: iso8601DateTimeSchema,
    hr: valueDistributionSchema
      .optional()
      .meta({ description: 'Distribution of the heart rate samples of all sessions in the group, pooled' }),
    hr_zone_secs: hrZoneSecsSchema
      .optional()
      .meta({ description: 'HR zone seconds summed over the sessions' }),
    last_start_time: iso8601DateTimeSchema,
    max_hr: z.number().optional().meta({ description: 'Highest heart rate across the sessions' }),
    session_ids: z.array(z.string()).meta({ description: 'IDs of the sessions in the group, newest first' }),
    value: z
      .union([z.string(), z.number(), z.boolean()])
      .nullable()
      .meta({ description: 'The group-by field value; null groups the sessions without one' }),
  })
  .meta({
    description: 'Sessions sharing a value of the group-by data field, with aggregate heart-rate stats',
    id: 'ActivitySessionGroup',
  })

export type ActivitySessionGroup = z.infer<typeof activitySessionGroupSchema>

export const activitySessionsQuerySchema = z
  .object({
    end: iso8601DateTimeSchema.optional().meta({ description: 'End date/time (defaults to now)' }),
    filter_field: dataFieldNameSchema.optional().meta({
      description: 'Only sessions whose data field equals filter_value (both must be given)',
    }),
    filter_value: z.string().optional().meta({
      description: 'Value filter_field must equal; "(none)" matches sessions without a value',
    }),
    group_by: dataFieldNameSchema.optional().meta({
      description: 'Data field to group sessions by, typically one marked is_categorical',
      example: 'session_name',
    }),
    start: iso8601DateTimeSchema.optional().meta({ description: 'Start date/time (defaults to all time)' }),
  })
  .refine((q) => (q.filter_field === undefined) === (q.filter_value === undefined), {
    message: 'filter_field and filter_value must be given together',
    path: ['filter_value'],
  })
  .meta({ id: 'ActivitySessionsQuery' })

export type ActivitySessionsQuery = z.infer<typeof activitySessionsQuerySchema>

export const activitySessionsSchema = z
  .object({
    activity_type: z
      .string()
      .meta({ description: 'The requested activity type (descendant types included)' }),
    group_by: z.string().optional(),
    groups: z.array(activitySessionGroupSchema).optional().meta({
      description: 'Present when group_by was given: most recently done first, no-value group last',
    }),
    sessions: z.array(activitySessionSchema).meta({ description: 'Sessions, newest first' }),
  })
  .meta({ id: 'ActivitySessions' })

export type ActivitySessions = z.infer<typeof activitySessionsSchema>

export const activitySessionsResponseSchema = createDataResponseSchema(activitySessionsSchema).meta({
  id: 'ActivitySessionsResponse',
})

export type ActivitySessionsResponse = z.infer<typeof activitySessionsResponseSchema>

export const activityNeighborSchema = z
  .object({
    end_time: iso8601DateTimeSchema.optional(),
    id: z.string().meta({ description: 'Activity ID, prefixed "merged:" when merged from several sources' }),
    start_time: iso8601DateTimeSchema,
    title: z.string().optional(),
  })
  .meta({ id: 'ActivityNeighbor' })

export type ActivityNeighbor = z.infer<typeof activityNeighborSchema>

export const activityNeighborsQuerySchema = z
  .object({
    same_field: dataFieldNameSchema.optional().meta({
      description:
        'Only step to activities whose data field has the same value as this one (e.g. session_name)',
      example: 'session_name',
    }),
  })
  .meta({ id: 'ActivityNeighborsQuery' })

export type ActivityNeighborsQuery = z.infer<typeof activityNeighborsQuerySchema>

export const activityNeighborsSchema = z
  .object({
    activity_type: activityTypeSchema,
    next: activityNeighborSchema.optional().meta({ description: 'The next activity, if any' }),
    previous: activityNeighborSchema.optional().meta({ description: 'The previous activity, if any' }),
  })
  .meta({
    description: 'The activities of the same type just before and after one activity',
    id: 'ActivityNeighbors',
  })

export type ActivityNeighbors = z.infer<typeof activityNeighborsSchema>

export const activityNeighborsResponseSchema = createDataResponseSchema(activityNeighborsSchema).meta({
  id: 'ActivityNeighborsResponse',
})

export type ActivityNeighborsResponse = z.infer<typeof activityNeighborsResponseSchema>
