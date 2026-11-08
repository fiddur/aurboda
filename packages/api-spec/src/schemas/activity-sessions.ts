import { z } from 'zod'

import { runCategoryFilterSchema } from './activity-features.ts'
import { activityMeasureSchema, activityMeasuresSchema } from './activity-measures.ts'
import {
  activityTypeSchema,
  createDataResponseSchema,
  dataFieldNameSchema,
  dataFieldPathSchema,
  hrZoneSecsSchema,
  iso8601DateTimeSchema,
} from './common.ts'
import { sleepStageSummarySchema } from './daily-summary.ts'
import { sharedExerciseSetSchema } from './shared-exercises.ts'

const listItemSchema = z.record(z.string(), z.unknown())
const listItemsSchema = z.array(listItemSchema)

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
    items: listItemsSchema.optional().meta({
      description:
        'With filter_field on a list item path (sets.exercise): the items of this session matching the value, in order',
    }),
    max_hr: z.number().optional().meta({ description: 'Maximum heart rate (bpm)' }),
    measures: activityMeasuresSchema.optional().meta({
      description:
        "Measures over the session's list items — all of them, or only the matching ones when filter_field is an item path",
    }),
    records: z.array(activityMeasureSchema).optional().meta({
      description:
        'With filter_field on an item path: the measures this session set a record for, beating every earlier session with that value',
    }),
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
    avg_hr_count: z.number().int().meta({
      description: 'Number of sessions with an average heart rate: the sample size of avg_hr_median',
    }),
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
    measures: activityMeasuresSchema.optional().meta({
      description:
        "Grouped by an item path: the sessions' measures for this value combined — volume and set_count summed, e1rm, max_weight and max_time at their maximum",
    }),
    session_ids: z.array(z.string()).meta({ description: 'IDs of the sessions in the group, newest first' }),
    value: z.union([z.string(), z.number(), z.boolean()]).nullable().meta({
      description:
        'The group-by field value; null groups the sessions without one. For an item path, the most recent spelling of a value compared trimmed and case-insensitively',
    }),
  })
  .meta({
    description: 'Sessions sharing a value of the group-by data field, with aggregate heart-rate stats',
    id: 'ActivitySessionGroup',
  })

export type ActivitySessionGroup = z.infer<typeof activitySessionGroupSchema>

export const activitySessionsQuerySchema = z
  .object({
    category: runCategoryFilterSchema.optional().meta({
      description: 'Filter to activities carrying this run category (data.run_categories)',
    }),
    end: iso8601DateTimeSchema.optional().meta({ description: 'End date/time (defaults to now)' }),
    filter_field: dataFieldPathSchema.optional().meta({
      description:
        'Only sessions whose data field equals filter_value (both must be given). An item path (sets.exercise) keeps the sessions with an item of that value and restricts items, measures and records to them',
    }),
    filter_value: z.string().optional().meta({
      description: 'Value filter_field must equal; "(none)" matches sessions without a value',
    }),
    group_by: dataFieldPathSchema.optional().meta({
      description:
        'Data field to group sessions by, typically one marked is_categorical; an item path (sets.exercise) gives one group per item value, a session in every group it has an item for',
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

export const activityRecordsQuerySchema = z
  .object({
    end: iso8601DateTimeSchema
      .optional()
      .meta({ description: 'Only sessions before this date/time (defaults to now)' }),
    filter_field: dataFieldPathSchema.optional().meta({
      description:
        'Only sessions whose data field equals filter_value (both must be given). An item path (sets.exercise) measures only the items of that value',
    }),
    filter_value: z.string().optional().meta({
      description: 'Value filter_field must equal; "(none)" matches sessions without a value',
    }),
    start: iso8601DateTimeSchema
      .optional()
      .meta({ description: 'Only sessions from this date/time (defaults to all time)' }),
  })
  .refine((q) => (q.filter_field === undefined) === (q.filter_value === undefined), {
    message: 'filter_field and filter_value must be given together',
    path: ['filter_value'],
  })
  .meta({ id: 'ActivityRecordsQuery' })

export type ActivityRecordsQuery = z.infer<typeof activityRecordsQuerySchema>

export const activityRecordSchema = z
  .object({
    measure: activityMeasureSchema,
    session_id: z.string().optional().meta({
      description:
        'Activity ID of the first session that reached it, prefixed "merged:" when merged; absent on public data',
    }),
    set: sharedExerciseSetSchema.optional().meta({ description: 'The set the value came from' }),
    start_time: iso8601DateTimeSchema.meta({ description: 'Start of the first session that reached it' }),
    value: z.number().meta({ description: 'The best value of the measure' }),
  })
  .meta({ description: 'The best value of one record measure', id: 'ActivityRecord' })

export type ActivityRecord = z.infer<typeof activityRecordSchema>

export const activityRecordsSchema = z
  .object({
    activity_type: z
      .string()
      .meta({ description: 'The requested activity type (descendant types included)' }),
    records: z.array(activityRecordSchema).meta({
      description:
        'One entry per record measure a session has a value for: e1rm, max_weight, max_time, max_reps, in that order',
    }),
  })
  .meta({ id: 'ActivityRecords' })

export type ActivityRecords = z.infer<typeof activityRecordsSchema>

export const activityRecordsResponseSchema = createDataResponseSchema(activityRecordsSchema).meta({
  id: 'ActivityRecordsResponse',
})

export type ActivityRecordsResponse = z.infer<typeof activityRecordsResponseSchema>

export const activityTypeSummaryQuerySchema = z
  .object({
    end: iso8601DateTimeSchema.meta({ description: 'Only sessions starting at or before this date/time' }),
    filter_field: dataFieldPathSchema.optional().meta({
      description:
        'Only sessions whose data field equals filter_value (both must be given). An item path (sets.exercise) keeps the sessions with an item of that value',
    }),
    filter_value: z.string().optional().meta({
      description: 'Value filter_field must equal; "(none)" matches sessions without a value',
    }),
    start: iso8601DateTimeSchema.meta({ description: 'Only sessions starting at or after this date/time' }),
  })
  .refine((q) => (q.filter_field === undefined) === (q.filter_value === undefined), {
    message: 'filter_field and filter_value must be given together',
    path: ['filter_value'],
  })
  .meta({ id: 'ActivityTypeSummaryQuery' })

export type ActivityTypeSummaryQuery = z.infer<typeof activityTypeSummaryQuerySchema>

export const activityTypeSleepSummarySchema = z
  .object({
    avg_minutes: z.number().meta({ description: 'Average night (minutes from start to end)' }),
    avg_stages: sleepStageSummarySchema.nullable().meta({
      description: 'Average whole minutes per stage over the nights with stages; null when none has',
    }),
    best_night_minutes: z.number().meta({ description: 'The longest night (minutes)' }),
  })
  .meta({ description: 'Sleep figures of an activity type roll-up', id: 'ActivityTypeSleepSummary' })

export type ActivityTypeSleepSummary = z.infer<typeof activityTypeSleepSummarySchema>

export const activityTypeSummarySchema = z
  .object({
    activity_type_name: z.string().meta({ description: "The activity type's display name, else its name" }),
    avg_speed_kmh: z.number().nullable().meta({
      description: 'Total distance over the total hours of the sessions with a distance; null when none has',
    }),
    best_pace_sec_per_km: z.number().nullable().meta({
      description: 'Fastest pace (seconds per km) of a session with a distance; null when none has',
    }),
    count: z.number().int().meta({ description: 'Number of sessions' }),
    distance_km: z
      .number()
      .nullable()
      .meta({ description: 'Total distance (km) of the sessions with a distance; null when none has' }),
    sleep: activityTypeSleepSummarySchema.nullable().meta({
      description:
        'Sleep figures, when the type is sleep or has sleep among its subtypes and there are nights',
    }),
    total_minutes: z.number().meta({ description: 'Total duration of the sessions (minutes)' }),
  })
  .meta({
    description:
      'Roll-up of one activity type (descendants included) over a time range: sessions, time, distance, pace, and sleep figures for sleep',
    id: 'ActivityTypeSummary',
  })

export type ActivityTypeSummary = z.infer<typeof activityTypeSummarySchema>

export const activityTypeSummaryResponseSchema = createDataResponseSchema(activityTypeSummarySchema).meta({
  id: 'ActivityTypeSummaryResponse',
})

export type ActivityTypeSummaryResponse = z.infer<typeof activityTypeSummaryResponseSchema>

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

export const activityFieldValuesQuerySchema = z
  .object({
    field: dataFieldPathSchema.meta({
      description:
        'Data field name, e.g. session_name, or an item path into a list field, e.g. sets.exercise',
    }),
  })
  .meta({ description: 'Which data field to list the values of', id: 'ActivityFieldValuesQuery' })

export type ActivityFieldValuesQuery = z.infer<typeof activityFieldValuesQuerySchema>

export const activityFieldValueSchema = z
  .object({
    count: z.number().int().meta({ description: 'Number of activities with this value' }),
    last_used: iso8601DateTimeSchema.meta({ description: 'Start time of the latest activity with it' }),
    value: z.string(),
  })
  .meta({ id: 'ActivityFieldValue' })

export type ActivityFieldValue = z.infer<typeof activityFieldValueSchema>

export const activityFieldValuesSchema = z
  .object({
    activity_type: z.string(),
    field: z.string(),
    values: z.array(activityFieldValueSchema).meta({ description: 'Most recently used first' }),
  })
  .meta({
    description:
      'Values a data field has taken across an activity type and its subtypes, for picking a value already in use',
    id: 'ActivityFieldValues',
  })

export type ActivityFieldValues = z.infer<typeof activityFieldValuesSchema>

export const activityFieldValuesResponseSchema = createDataResponseSchema(activityFieldValuesSchema).meta({
  id: 'ActivityFieldValuesResponse',
})

export type ActivityFieldValuesResponse = z.infer<typeof activityFieldValuesResponseSchema>

export const activityItemHistoryQuerySchema = z
  .object({
    field: dataFieldPathSchema
      .refine((f) => f.includes('.'), { message: 'field must be an item path such as sets.exercise' })
      .meta({ description: 'Item path: the list field and the item field to group by, e.g. sets.exercise' }),
  })
  .meta({ id: 'ActivityItemHistoryQuery' })

export type ActivityItemHistoryQuery = z.infer<typeof activityItemHistoryQuerySchema>

export const activityItemPreviousSchema = z
  .object({
    id: z.string().meta({ description: 'Activity ID, prefixed "merged:" when merged from several sources' }),
    items: listItemsSchema.meta({ description: 'Its items with this value, in order' }),
    measures: activityMeasuresSchema,
    start_time: iso8601DateTimeSchema,
  })
  .meta({ description: 'The previous session with the same item value', id: 'ActivityItemPrevious' })

export type ActivityItemPrevious = z.infer<typeof activityItemPreviousSchema>

export const activityItemTrendSchema = z
  .object({
    after: z
      .number()
      .meta({ description: "The trend after this session: max(before, this session's value)" }),
    before: z.number().optional().meta({
      description:
        "The decaying best of the earlier sessions with this value, decayed to this session's day; absent when none has the measure",
    }),
    measure: activityMeasureSchema,
  })
  .meta({
    description:
      'The decaying-best trend of one measure (as on the exercise page) just before and after this session, to one decimal',
    id: 'ActivityItemTrend',
  })

export type ActivityItemTrend = z.infer<typeof activityItemTrendSchema>

export const activityItemGroupSchema = z
  .object({
    items: listItemsSchema.meta({ description: "This session's items with this value, in order" }),
    measures: activityMeasuresSchema,
    previous: activityItemPreviousSchema.optional(),
    records: z.array(activityMeasureSchema).meta({
      description:
        'Measures this session set a record for: higher than in every earlier session with this value',
    }),
    trend: z.array(activityItemTrendSchema).meta({
      description: 'One entry per measure this session has a value for, in ActivityMeasure order',
    }),
    value: z.string().meta({ description: 'The item value, as spelled in this session' }),
  })
  .meta({
    description:
      'One item value of the session (an exercise) and how it compares to last time and to its trend',
    id: 'ActivityItemGroup',
  })

export type ActivityItemGroup = z.infer<typeof activityItemGroupSchema>

export const activityItemHistorySchema = z
  .object({
    activity_id: z.string(),
    field: z.string().meta({ description: 'The item path grouped by' }),
    groups: z
      .array(activityItemGroupSchema)
      .meta({ description: 'In order of first appearance in the list' }),
    totals: activityMeasuresSchema.meta({ description: "Measures over all the session's items" }),
    trend_half_life_days: z
      .number()
      .meta({ description: "Half-life (days) of the groups' decaying-best trend" }),
  })
  .meta({
    description:
      "A session's list items grouped by an item value (its exercises), each with its measures, the records it set, the previous session with that value and its trend before and after",
    id: 'ActivityItemHistory',
  })

export type ActivityItemHistory = z.infer<typeof activityItemHistorySchema>

export const activityItemHistoryResponseSchema = createDataResponseSchema(activityItemHistorySchema).meta({
  id: 'ActivityItemHistoryResponse',
})

export type ActivityItemHistoryResponse = z.infer<typeof activityItemHistoryResponseSchema>
