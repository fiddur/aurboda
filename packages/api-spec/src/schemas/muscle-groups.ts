/**
 * Muscle group history of an activity type with a catalogue-backed item path (strength sets): when
 * each group was last trained, and one group's totals, exercises and sessions over a period. Every
 * measure counts a set by the exercise's recruitment weight for the group (a bench press is 1 set for
 * the chest, 0.5 for the shoulders).
 */

import { z } from 'zod'

import { activityMeasuresSchema } from './activity-measures.ts'
import { createDataResponseSchema, dataFieldPathSchema } from './common.ts'
import { exerciseMuscleGroupSchema } from './exercise-catalog.ts'

const muscleGroupFieldSchema = dataFieldPathSchema.meta({
  description: 'A catalogue-backed item path of the activity type, e.g. sets.exercise',
  example: 'sets.exercise',
})

export const muscleGroupsQuerySchema = z
  .object({ field: muscleGroupFieldSchema })
  .meta({ description: 'Which item path the exercises are read from', id: 'MuscleGroupsQuery' })

export type MuscleGroupsQuery = z.infer<typeof muscleGroupsQuerySchema>

const lastTrainedSchema = z.string().nullable().meta({
  description:
    'ISO start time of the latest session (all time) in which the group got a weighted set count above 0; null when never',
})

export const muscleGroupLastTrainedSchema = z
  .object({
    last_trained: lastTrainedSchema,
    muscle_group: exerciseMuscleGroupSchema,
    name: z.string().meta({ description: 'Display name of the muscle group' }),
  })
  .meta({ description: 'A muscle group and when it was last trained', id: 'MuscleGroupLastTrained' })

export type MuscleGroupLastTrained = z.infer<typeof muscleGroupLastTrainedSchema>

export const muscleGroupOverviewSchema = z
  .object({
    field: z.string().meta({ description: 'The item path the exercises are read from' }),
    groups: z
      .array(muscleGroupLastTrainedSchema)
      .meta({ description: 'Every muscle group of the catalogue, in catalogue order' }),
  })
  .meta({
    description: 'Every muscle group of the exercise catalogue with when it was last trained',
    id: 'MuscleGroupOverview',
  })

export type MuscleGroupOverview = z.infer<typeof muscleGroupOverviewSchema>

export const muscleGroupsResponseSchema = createDataResponseSchema(muscleGroupOverviewSchema).meta({
  id: 'MuscleGroupsResponse',
})

export type MuscleGroupsResponse = z.infer<typeof muscleGroupsResponseSchema>

export const MUSCLE_GROUP_HISTORY_DEFAULT_DAYS = 90

export const MUSCLE_GROUP_HISTORY_START_AFTER_END = 'start must be before end'

/** The period of a history query: `end` defaults to `now`, `start` to 90 days before `end`. */
export const muscleGroupHistoryPeriod = (
  query: { end?: string; start?: string },
  now: Date = new Date(),
): { end: Date; start: Date } => {
  const end = query.end === undefined ? now : new Date(query.end)
  const start =
    query.start === undefined
      ? new Date(end.getTime() - MUSCLE_GROUP_HISTORY_DEFAULT_DAYS * 86_400_000)
      : new Date(query.start)
  return { end, start }
}

export const muscleGroupHistoryQuerySchema = z
  .object({
    end: z.iso
      .datetime({ offset: true })
      .optional()
      .meta({ description: 'End of the period (ISO 8601); defaults to now' }),
    field: muscleGroupFieldSchema,
    start: z.iso
      .datetime({ offset: true })
      .optional()
      .meta({ description: 'Start of the period (ISO 8601); defaults to 90 days before end' }),
  })
  .refine(
    (query) => {
      const { end, start } = muscleGroupHistoryPeriod(query)
      return start.getTime() < end.getTime()
    },
    { message: MUSCLE_GROUP_HISTORY_START_AFTER_END, path: ['start'] },
  )
  .meta({
    description: 'Which item path the exercises are read from, and the period',
    id: 'MuscleGroupHistoryQuery',
  })

export type MuscleGroupHistoryQuery = z.infer<typeof muscleGroupHistoryQuerySchema>

const weightedMeasuresSchema = activityMeasuresSchema.meta({
  description:
    "set_count, volume and total_reps of the working sets, each weighted by the exercise's recruitment",
})

export const muscleGroupExerciseSchema = z
  .object({
    catalog_key: z.string().meta({ description: 'The catalogue entry the exercise resolves to' }),
    catalog_name: z.string().meta({ description: 'Display name of the catalogue entry' }),
    last_time: z.string().meta({ description: 'ISO start time of its latest session, all time' }),
    measures: weightedMeasuresSchema.meta({
      description: 'Its weighted measures over the period; empty when not done in it',
    }),
    session_count: z.number().int().meta({ description: 'Sessions in the period with it' }),
    value: z.string().meta({ description: 'The exercise as logged, spelled as in its latest session' }),
    weight: z.number().meta({ description: 'Its recruitment weight for the muscle group, in (0, 1]' }),
  })
  .meta({
    description: 'An exercise the user has logged that trains the muscle group',
    id: 'MuscleGroupExercise',
  })

export type MuscleGroupExercise = z.infer<typeof muscleGroupExerciseSchema>

export const muscleGroupSessionSchema = z
  .object({
    activity_type: z.string(),
    exercises: z
      .array(z.string())
      .meta({ description: 'The exercises of the session that train the group, as logged' }),
    id: z.string().meta({ description: 'Session id (`merged:<id>` for a merged session)' }),
    measures: weightedMeasuresSchema.meta({ description: "The group's weighted measures in the session" }),
    start_time: z.string().meta({ description: 'ISO start time' }),
    title: z.string().optional(),
  })
  .meta({ description: 'A session that trained the muscle group', id: 'MuscleGroupSession' })

export type MuscleGroupSession = z.infer<typeof muscleGroupSessionSchema>

export const muscleGroupHistorySchema = z
  .object({
    end: z.string().meta({ description: 'ISO end of the period' }),
    exercises: z.array(muscleGroupExerciseSchema).meta({
      description:
        'Every exercise logged for the type (all time) that trains the group: most weighted sets in the period first, then the most recently done',
    }),
    field: z.string().meta({ description: 'The item path the exercises are read from' }),
    last_trained: lastTrainedSchema,
    muscle_group: exerciseMuscleGroupSchema,
    name: z.string().meta({ description: 'Display name of the muscle group' }),
    sessions: z
      .array(muscleGroupSessionSchema)
      .meta({ description: 'The sessions in the period that trained the group, newest first' }),
    start: z.string().meta({ description: 'ISO start of the period' }),
    totals: weightedMeasuresSchema.meta({ description: "The group's weighted measures over the period" }),
  })
  .meta({
    description:
      "One muscle group's history over a period: its weighted totals, the exercises that train it and the sessions that did",
    id: 'MuscleGroupHistory',
  })

export type MuscleGroupHistory = z.infer<typeof muscleGroupHistorySchema>

export const muscleGroupHistoryResponseSchema = createDataResponseSchema(muscleGroupHistorySchema).meta({
  id: 'MuscleGroupHistoryResponse',
})

export type MuscleGroupHistoryResponse = z.infer<typeof muscleGroupHistoryResponseSchema>
