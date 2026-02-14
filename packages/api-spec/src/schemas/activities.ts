/**
 * Activities schemas.
 */

import { z } from 'zod'
import {
  activityTypeSchema,
  baseResponseSchema,
  createDataArrayResponseSchema,
  durationMinutesSchema,
  iso8601DateTimeSchema,
  timeRangeQuerySchema,
} from './common.js'
import { hrZoneSecsSchema } from './settings.js'

/**
 * Health Connect exercise types mapping.
 * Maps friendly names to Health Connect ExerciseSessionRecord type values.
 * @see https://developer.android.com/reference/kotlin/androidx/health/connect/client/records/ExerciseSessionRecord
 */
export const exerciseTypes = {
  back_extension: 1,
  badminton: 2,
  barbell_shoulder_press: 3,
  baseball: 4,
  basketball: 5,
  bench_press: 6,
  bench_sit_up: 7,
  biking: 8,
  biking_stationary: 9,
  boot_camp: 10,
  boxing: 11,
  burpee: 12,
  calisthenics: 13,
  cricket: 14,
  crunch: 15,
  dancing: 16,
  deadlift: 17,
  dumbbell_curl_left_arm: 18,
  dumbbell_curl_right_arm: 19,
  dumbbell_front_raise: 20,
  dumbbell_lateral_raise: 21,
  dumbbell_triceps_extension_left_arm: 22,
  dumbbell_triceps_extension_right_arm: 23,
  dumbbell_triceps_extension_two_arm: 24,
  elliptical: 25,
  exercise_class: 26,
  fencing: 27,
  football_american: 28,
  football_australian: 29,
  forward_twist: 30,
  frisbee_disc: 31,
  golf: 32,
  guided_breathing: 33,
  gymnastics: 34,
  handball: 35,
  high_intensity_interval_training: 36,
  hiking: 37,
  ice_hockey: 38,
  ice_skating: 39,
  jump_rope: 41,
  jumping_jack: 40,
  lat_pull_down: 42,
  lunge: 43,
  martial_arts: 44,
  other_workout: 0,
  paddling: 46,
  paragliding: 47,
  pilates: 48,
  plank: 49,
  racquetball: 50,
  rock_climbing: 51,
  roller_hockey: 52,
  rowing: 53,
  rowing_machine: 54,
  rugby: 55,
  running: 56,
  running_treadmill: 57,
  sailing: 58,
  scuba_diving: 59,
  skating: 60,
  skiing: 61,
  snowboarding: 62,
  snowshoeing: 63,
  soccer: 64,
  softball: 65,
  squash: 66,
  squat: 67,
  stair_climbing: 68,
  stair_climbing_machine: 69,
  strength_training: 70,
  stretching: 71,
  surfing: 72,
  swimming_open_water: 73,
  swimming_pool: 74,
  table_tennis: 75,
  tennis: 76,
  upper_twist: 77,
  volleyball: 78,
  walking: 79,
  water_polo: 80,
  weightlifting: 81,
  wheelchair: 82,
  yoga: 83,
} as const

export type ExerciseTypeName = keyof typeof exerciseTypes

export const exerciseTypeNames = Object.keys(exerciseTypes) as ExerciseTypeName[]

export const exerciseTypeSchema = z
  .enum(exerciseTypeNames as [ExerciseTypeName, ...ExerciseTypeName[]])
  .meta({
    description: 'Exercise type name',
    example: 'weightlifting',
    id: 'ExerciseTypeName',
  })

export const isValidExerciseType = (name: string): name is ExerciseTypeName => name in exerciseTypes

export const getExerciseTypeValue = (name: ExerciseTypeName): number => exerciseTypes[name]

/**
 * Activity schema.
 */
export const activitySchema = z
  .object({
    activity_type: z.string().meta({ description: 'Activity type' }),
    data: z.record(z.string(), z.unknown()).optional(),
    duration: durationMinutesSchema.optional(),
    end_time: iso8601DateTimeSchema.optional(),
    hr_zone_secs: hrZoneSecsSchema.optional().meta({
      description: 'Time spent in each HR zone (for exercise)',
    }),
    id: z.string().uuid().optional().meta({ description: 'Activity ID' }),
    notes: z.string().optional().meta({ description: 'Activity notes' }),
    source: z.string().optional().meta({ description: 'Data source' }),
    start_time: iso8601DateTimeSchema,
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

/**
 * Add activity request body schema.
 */
export const addActivityBodySchema = z
  .object({
    activity_type: activityTypeSchema.meta({ description: 'Type of activity' }),
    end_time: iso8601DateTimeSchema.meta({ description: 'End time of the activity' }),
    exercise_type: exerciseTypeSchema.optional().meta({
      description: 'Exercise type name (only for exercise activities)',
    }),
    notes: z.string().optional().meta({
      description:
        'Activity notes. For workouts, use format: "Exercise Name: reps×weight, reps×weight" per line.',
    }),
    start_time: iso8601DateTimeSchema.meta({ description: 'Start time of the activity' }),
    title: z
      .string()
      .optional()
      .meta({ description: 'Activity title (e.g., "Upper body", "Morning meditation")' }),
  })
  .meta({ id: 'AddActivityBody' })

export type AddActivityBody = z.infer<typeof addActivityBodySchema>

/**
 * Added activity data schema.
 */
const addedActivitySchema = z.object({
  activity_type: activityTypeSchema,
  end_time: iso8601DateTimeSchema,
  id: z.string().uuid(),
  notes: z.string().optional(),
  start_time: iso8601DateTimeSchema,
  title: z.string().optional(),
})

/**
 * Add activity response schema.
 */
export const addActivityResponseSchema = baseResponseSchema
  .extend({
    data: addedActivitySchema.optional(),
  })
  .meta({ id: 'AddActivityResponse' })

export type AddActivityResponse = z.infer<typeof addActivityResponseSchema>

/**
 * Delete activity params.
 */
export const deleteActivityParamsSchema = z
  .object({
    id: z.string().uuid().meta({ description: 'ID of the activity to delete' }),
  })
  .meta({ id: 'DeleteActivityParams' })

export type DeleteActivityParams = z.infer<typeof deleteActivityParamsSchema>

/**
 * Delete activity response.
 */
export const deleteActivityResponseSchema = baseResponseSchema.meta({ id: 'DeleteActivityResponse' })

export type DeleteActivityResponse = z.infer<typeof deleteActivityResponseSchema>

/**
 * Update activity request body schema.
 * All fields are optional - only provided fields will be updated.
 */
export const updateActivityBodySchema = z
  .object({
    end_time: iso8601DateTimeSchema.optional().meta({ description: 'New end time of the activity' }),
    notes: z.string().optional().meta({ description: 'New activity notes' }),
    start_time: iso8601DateTimeSchema.optional().meta({ description: 'New start time of the activity' }),
    title: z.string().optional().meta({ description: 'New activity title' }),
  })
  .meta({ id: 'UpdateActivityBody' })

export type UpdateActivityBody = z.infer<typeof updateActivityBodySchema>

/**
 * Update activity params.
 */
export const updateActivityParamsSchema = z
  .object({
    id: z.string().uuid().meta({ description: 'ID of the activity to update' }),
  })
  .meta({ id: 'UpdateActivityParams' })

export type UpdateActivityParams = z.infer<typeof updateActivityParamsSchema>

/**
 * Update activity response schema.
 */
export const updateActivityResponseSchema = baseResponseSchema
  .extend({
    data: addedActivitySchema.optional(),
  })
  .meta({ id: 'UpdateActivityResponse' })

export type UpdateActivityResponse = z.infer<typeof updateActivityResponseSchema>
