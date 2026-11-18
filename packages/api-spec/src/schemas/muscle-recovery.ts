import { z } from 'zod'

import { createDataResponseSchema, dataFieldPathSchema } from './common.ts'
import { exerciseMuscleGroupSchema } from './exercise-catalog.ts'

export const MUSCLE_RECOVERY_WINDOW_DAYS = 10
export const MUSCLE_RECOVERY_READY_PERCENT = 80
export const MUSCLE_RECOVERY_SET_FATIGUE = 0.1
export const MUSCLE_RECOVERY_MAX_SOURCES = 5
export const MUSCLE_RECOVERY_HISTORY_DEFAULT_DAYS = 14
export const MUSCLE_RECOVERY_HISTORY_DEFAULT_STEP_HOURS = 6
export const MUSCLE_RECOVERY_HISTORY_MAX_POINTS = 1000

export const MUSCLE_RECOVERY_HISTORY_START_AFTER_END = 'start must be before end'
export const MUSCLE_RECOVERY_HISTORY_TOO_MANY_POINTS = `the period holds more than ${MUSCLE_RECOVERY_HISTORY_MAX_POINTS} points; raise step_hours or shorten it`

const muscleRecoveryFieldSchema = dataFieldPathSchema.meta({
  description: 'A catalogue-backed item path of the activity type, e.g. sets.exercise',
  example: 'sets.exercise',
})

export const muscleRecoveryQuerySchema = z
  .object({
    at: z.iso.datetime({ offset: true }).optional().meta({
      description:
        'The moment recovery is given for (ISO 8601); defaults to now. A later moment shows where recovery will be if nothing more is trained',
    }),
    field: muscleRecoveryFieldSchema,
  })
  .meta({
    description: 'Which item path the exercises are read from, and the moment',
    id: 'MuscleRecoveryQuery',
  })

export type MuscleRecoveryQuery = z.infer<typeof muscleRecoveryQuerySchema>

export const muscleRecoverySourceSchema = z
  .object({
    activity_type: z.string(),
    end_time: z.string().meta({
      description:
        'ISO time the fatigue is counted from: the end of the session, its last set while it is unfinished',
    }),
    fatigue: z
      .number()
      .meta({ description: 'What is left of the fatigue the session gave the group, 2 decimals' }),
    session_id: z.string().meta({ description: 'Session id (`merged:<id>` for a merged session)' }),
    sets: z.number().meta({
      description:
        'Working sets of the session for the group, each weighted by recruitment and effort, 2 decimals',
    }),
    start_time: z.string().meta({ description: 'ISO start time' }),
    title: z.string().optional(),
  })
  .meta({ description: 'A session that still tires the muscle group', id: 'MuscleRecoverySource' })

export type MuscleRecoverySource = z.infer<typeof muscleRecoverySourceSchema>

const recoveryPercentSchema = z.number().int().min(0).max(100)

export const muscleRecoveryGroupSchema = z
  .object({
    fatigue: z.number().meta({
      description: `Fatigue left, 2 decimals: ${MUSCLE_RECOVERY_SET_FATIGUE} per full working set, halved every half-life; 1 or more is 0 % recovered`,
    }),
    half_life_hours: z.number().int().meta({ description: "The group's fatigue halves in this many hours" }),
    muscle_group: exerciseMuscleGroupSchema,
    name: z.string().meta({ description: 'Display name of the muscle group' }),
    ready_at: z
      .string()
      .nullable()
      .meta({
        description: `ISO time recovery reaches ${MUSCLE_RECOVERY_READY_PERCENT} % if nothing more is trained; null when it is there already`,
      }),
    recovery: recoveryPercentSchema.meta({
      description: '100 × (1 − fatigue), from 0 to 100; 100 is fully recovered',
    }),
    sources: z.array(muscleRecoverySourceSchema).meta({
      description: `The sessions with the most fatigue left, at most ${MUSCLE_RECOVERY_MAX_SOURCES}, most first`,
    }),
  })
  .meta({ description: "A muscle group's recovery", id: 'MuscleRecoveryGroup' })

export type MuscleRecoveryGroup = z.infer<typeof muscleRecoveryGroupSchema>

export const muscleRecoverySchema = z
  .object({
    at: z.string().meta({ description: 'ISO time recovery is given for' }),
    field: z.string().meta({ description: 'The item path the exercises are read from' }),
    groups: z
      .array(muscleRecoveryGroupSchema)
      .meta({ description: 'Every muscle group of the catalogue, in catalogue order' }),
    ready_percent: z.number().int().meta({ description: 'Recovery from which a group counts as ready' }),
    window_days: z.number().int().meta({ description: 'Sessions this many days before `at` count' }),
  })
  .meta({
    description:
      'Muscle recovery at a moment: per muscle group the share of the fatigue of the last days that has worn off, from the working sets logged (recruitment weight × effort per set, halving every 24 or 36 hours)',
    id: 'MuscleRecovery',
  })

export type MuscleRecovery = z.infer<typeof muscleRecoverySchema>

export const muscleRecoveryResponseSchema = createDataResponseSchema(muscleRecoverySchema).meta({
  id: 'MuscleRecoveryResponse',
})

export type MuscleRecoveryResponse = z.infer<typeof muscleRecoveryResponseSchema>

interface HistoryQuery {
  end?: string
  start?: string
  step_hours?: number
}

/** The period of a history query: `end` defaults to `now`, `start` to 14 days before `end`. */
export const muscleRecoveryHistoryPeriod = (
  query: HistoryQuery,
  now: Date = new Date(),
): { end: Date; start: Date; step_hours: number } => {
  const end = query.end === undefined ? now : new Date(query.end)
  const start =
    query.start === undefined
      ? new Date(end.getTime() - MUSCLE_RECOVERY_HISTORY_DEFAULT_DAYS * 86_400_000)
      : new Date(query.start)
  return { end, start, step_hours: query.step_hours ?? MUSCLE_RECOVERY_HISTORY_DEFAULT_STEP_HOURS }
}

/** Why a history period cannot be answered, or undefined when it can. */
export const muscleRecoveryHistoryPeriodError = (period: {
  end: Date
  start: Date
  step_hours: number
}): string | undefined => {
  const span = period.end.getTime() - period.start.getTime()
  if (span <= 0) return MUSCLE_RECOVERY_HISTORY_START_AFTER_END
  return span / (period.step_hours * 3_600_000) + 1 > MUSCLE_RECOVERY_HISTORY_MAX_POINTS
    ? MUSCLE_RECOVERY_HISTORY_TOO_MANY_POINTS
    : undefined
}

export const muscleRecoveryHistoryQuerySchema = z
  .object({
    end: z.iso.datetime({ offset: true }).optional().meta({
      description: 'End of the period and the last point (ISO 8601); defaults to now, and may lie ahead',
    }),
    field: muscleRecoveryFieldSchema,
    start: z.iso
      .datetime({ offset: true })
      .optional()
      .meta({ description: 'Start of the period (ISO 8601); defaults to 14 days before end' }),
    step_hours: z.coerce
      .number()
      .int()
      .min(1)
      .max(24)
      .optional()
      .meta({ description: 'Hours between two points, 1 to 24; defaults to 6' }),
  })
  .superRefine((query, ctx) => {
    const error = muscleRecoveryHistoryPeriodError(muscleRecoveryHistoryPeriod(query))
    if (error !== undefined) ctx.addIssue({ code: 'custom', message: error, path: ['start'] })
  })
  .meta({
    description: 'Which item path the exercises are read from, the period and the spacing of its points',
    id: 'MuscleRecoveryHistoryQuery',
  })

export type MuscleRecoveryHistoryQuery = z.infer<typeof muscleRecoveryHistoryQuerySchema>

export const muscleRecoveryHistoryPointSchema = z
  .object({
    at: z.string().meta({ description: 'ISO time of the point' }),
    recovery: z
      .record(exerciseMuscleGroupSchema, recoveryPercentSchema)
      .meta({ description: 'Recovery of every muscle group at that time' }),
  })
  .meta({ description: 'Muscle recovery at one moment', id: 'MuscleRecoveryHistoryPoint' })

export type MuscleRecoveryHistoryPoint = z.infer<typeof muscleRecoveryHistoryPointSchema>

export const muscleRecoveryHistorySchema = z
  .object({
    end: z.string().meta({ description: 'ISO end of the period' }),
    field: z.string().meta({ description: 'The item path the exercises are read from' }),
    points: z.array(muscleRecoveryHistoryPointSchema).meta({
      description: 'Recovery at `end` and every `step_hours` before it down to `start`, oldest first',
    }),
    start: z.string().meta({ description: 'ISO start of the period' }),
    step_hours: z.number().int(),
  })
  .meta({ description: 'Muscle recovery over time', id: 'MuscleRecoveryHistory' })

export type MuscleRecoveryHistory = z.infer<typeof muscleRecoveryHistorySchema>

export const muscleRecoveryHistoryResponseSchema = createDataResponseSchema(muscleRecoveryHistorySchema).meta(
  {
    id: 'MuscleRecoveryHistoryResponse',
  },
)

export type MuscleRecoveryHistoryResponse = z.infer<typeof muscleRecoveryHistoryResponseSchema>
