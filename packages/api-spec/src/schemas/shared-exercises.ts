/**
 * A *shared exercise* publishes the progress on one item value of one activity type (one exercise,
 * such as `sets.exercise` = `Bench Press` of `strength_training`) under the user's public namespace
 * (`<public-base>/u/<username>/<slug>`), with the same public/unlisted visibility as shared
 * dashboards. A viewer gets a server-resolved projection of the exercise's sessions: records, the
 * trend, per-week figures and the sets of each session, never the sessions' ids, titles, notes,
 * locations or heart rate.
 */
import { z } from 'zod'

import { activityMeasureSchema, activityMeasuresSchema } from './activity-measures.ts'
import { chartDataAggregationSchema, chartDataBucketSchema } from './chart-data.ts'
import { activityTypeSchema, baseResponseSchema, dataFieldPathSchema } from './common.ts'
import { trendHistoryPointSchema } from './trends.ts'
import { shareVisibilitySchema } from './visibility.ts'

export const sharedExerciseNameSchema = z
  .string()
  .min(1)
  .max(120)
  .meta({ description: 'Display name for the shared exercise' })

const visibilityDescription = 'public → listed on the public profile; unlisted → reachable only by its link'

export const sharedExerciseSchema = z
  .object({
    activity_type: z.string().meta({ description: 'Activity type the exercise belongs to' }),
    created_at: z.string().meta({ description: 'Creation timestamp (ISO 8601)' }),
    field: z.string().meta({ description: 'Item path the exercise is a value of, e.g. `sets.exercise`' }),
    id: z.string().uuid().meta({ description: 'Shared exercise ID' }),
    name: sharedExerciseNameSchema,
    share_url: z.string().meta({ description: 'Absolute URL of the shared exercise' }),
    slug: z.string().meta({ description: 'URL-safe public slug' }),
    updated_at: z.string().meta({ description: 'Last update timestamp (ISO 8601)' }),
    value: z.string().meta({ description: 'The item value shared, e.g. `Bench Press`' }),
    visibility: shareVisibilitySchema.meta({ description: visibilityDescription }),
  })
  .meta({ description: 'One exercise published under the public namespace', id: 'SharedExercise' })

export type SharedExercise = z.infer<typeof sharedExerciseSchema>

export const createSharedExerciseBodySchema = z
  .object({
    activity_type: activityTypeSchema,
    field: dataFieldPathSchema.meta({
      description:
        'A categorical list-item path of the activity type whose value is shared, such as `sets.exercise`; session-level fields are rejected',
    }),
    name: sharedExerciseNameSchema.optional().meta({ description: 'Display name; defaults to the value' }),
    value: z.string().min(1).meta({ description: 'The item value to share, e.g. `Bench Press`' }),
    visibility: shareVisibilitySchema
      .default('unlisted')
      .meta({ description: 'public → listed on the public profile; unlisted (default) → link-only' }),
  })
  .meta({ id: 'CreateSharedExerciseBody' })

export type CreateSharedExerciseBody = z.infer<typeof createSharedExerciseBodySchema>

export const updateSharedExerciseBodySchema = z
  .object({
    name: sharedExerciseNameSchema.optional(),
    visibility: shareVisibilitySchema.optional().meta({ description: visibilityDescription }),
  })
  .meta({ id: 'UpdateSharedExerciseBody' })

export type UpdateSharedExerciseBody = z.infer<typeof updateSharedExerciseBodySchema>

export const sharedExerciseResponseSchema = baseResponseSchema
  .extend({ exercise: sharedExerciseSchema.optional() })
  .meta({ id: 'SharedExerciseResponse' })

export type SharedExerciseResponse = z.infer<typeof sharedExerciseResponseSchema>

export const sharedExercisesResponseSchema = baseResponseSchema
  .extend({ exercises: z.array(sharedExerciseSchema) })
  .meta({ id: 'SharedExercisesResponse' })

export type SharedExercisesResponse = z.infer<typeof sharedExercisesResponseSchema>

export const sharedExerciseSetSchema = z
  .object({
    reps: z.number().optional().meta({ description: 'Repetitions' }),
    set_type: z.string().optional().meta({
      description: 'Set type as logged, e.g. `warmup`, `drop_set`, `failure`; absent for a working set',
    }),
    time: z.number().optional().meta({ description: 'Time under load or hold, in seconds' }),
    weight: z.number().optional().meta({ description: 'Load in kg' }),
  })
  .meta({ description: 'One set as logged: any of reps, weight and time', id: 'SharedExerciseSet' })

export type SharedExerciseSet = z.infer<typeof sharedExerciseSetSchema>

export const sharedExerciseRecordSchema = z
  .object({
    measure: activityMeasureSchema,
    set: sharedExerciseSetSchema.optional().meta({ description: 'The set the value came from' }),
    start_time: z.string().meta({ description: 'Start of the first session that reached it (ISO 8601)' }),
    value: z.number().meta({ description: 'The best value of the measure' }),
  })
  .meta({ id: 'SharedExerciseRecord' })

export type SharedExerciseRecord = z.infer<typeof sharedExerciseRecordSchema>

export const sharedExerciseHistoryRowSchema = z
  .object({
    items: z.array(sharedExerciseSetSchema).meta({ description: "The session's sets of the exercise" }),
    measures: activityMeasuresSchema,
    records: z
      .array(activityMeasureSchema)
      .meta({ description: 'The measures this session set a record on' }),
    start_time: z.string().meta({ description: 'Session start (ISO 8601)' }),
  })
  .meta({ id: 'SharedExerciseHistoryRow' })

export type SharedExerciseHistoryRow = z.infer<typeof sharedExerciseHistoryRowSchema>

export const sharedExerciseDoneSchema = z
  .object({
    count: z.number().meta({ description: 'Number of sessions with the exercise' }),
    first: z.string().meta({ description: 'Start of the first session (ISO 8601)' }),
    last: z.string().meta({ description: 'Start of the latest session (ISO 8601)' }),
  })
  .meta({ id: 'SharedExerciseDone' })

export const sharedExerciseTrendSchema = z
  .object({
    half_life_days: z.number().meta({ description: 'Half-life of the decaying best' }),
    history: z.array(trendHistoryPointSchema).meta({ description: 'Trend values, all time' }),
    measure: activityMeasureSchema,
  })
  .meta({ id: 'SharedExerciseTrend' })

export const sharedExercisePerWeekSchema = z
  .object({
    aggregation: chartDataAggregationSchema,
    buckets: z.array(chartDataBucketSchema).meta({ description: 'One bucket per week' }),
    end: z.string().meta({ description: 'End of the range (ISO 8601)' }),
    measure: activityMeasureSchema,
    start: z.string().meta({ description: 'Start of the range (ISO 8601)' }),
  })
  .meta({ id: 'SharedExercisePerWeek' })

export const sharedExerciseDataSchema = z
  .object({
    done: sharedExerciseDoneSchema
      .nullable()
      .meta({ description: 'Session count and span; null without sessions' }),
    history: z
      .array(sharedExerciseHistoryRowSchema)
      .meta({ description: 'Every session with the exercise, newest first' }),
    per_week: sharedExercisePerWeekSchema
      .nullable()
      .meta({ description: 'A measure per week over the last 365 days; null without a measure' }),
    records: z
      .array(sharedExerciseRecordSchema)
      .meta({ description: 'The best value of each record measure' }),
    trend: sharedExerciseTrendSchema
      .nullable()
      .meta({ description: 'The decaying best of the primary measure; null without one' }),
  })
  .meta({
    description: 'Server-resolved progress on a shared exercise, from the stored share only',
    id: 'SharedExerciseData',
  })

export type SharedExerciseData = z.infer<typeof sharedExerciseDataSchema>

export const publicExerciseListItemSchema = z
  .object({
    name: sharedExerciseNameSchema,
    share_url: z.string().meta({ description: 'Absolute URL of the shared exercise' }),
    slug: z.string().meta({ description: 'URL-safe public slug' }),
  })
  .meta({ id: 'PublicExerciseListItem' })

export type PublicExerciseListItem = z.infer<typeof publicExerciseListItemSchema>

/** Payload fields are optional so error/not-found responses type-check. */
export const publicSharedExerciseResponseSchema = baseResponseSchema
  .extend({
    activity_type: z.string().optional().meta({ description: 'Activity type the exercise belongs to' }),
    activity_type_name: z.string().optional().meta({ description: 'Display name of the activity type' }),
    data: sharedExerciseDataSchema.optional(),
    name: sharedExerciseNameSchema.optional(),
    profile_url: z.string().optional().meta({ description: 'Absolute URL of the owner public profile' }),
    share_url: z.string().optional().meta({ description: 'Absolute URL of this shared exercise' }),
    type: z.literal('exercise').optional().meta({ description: 'Resource type discriminator' }),
    value: z.string().optional().meta({ description: 'The item value shared' }),
  })
  .meta({ id: 'PublicSharedExerciseResponse' })

export type PublicSharedExerciseResponse = z.infer<typeof publicSharedExerciseResponseSchema>
