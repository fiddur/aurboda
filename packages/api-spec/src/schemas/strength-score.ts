import { z } from 'zod'

import { createDataResponseSchema, dataFieldPathSchema } from './common.ts'
import { exerciseMuscleGroupSchema } from './exercise-catalog.ts'

export const STRENGTH_SCORE_WINDOW_DAYS = 90
export const STRENGTH_SCORE_MAX_REPS = 12
export const STRENGTH_SCORE_GROUP_LIFTS = 3
export const STRENGTH_SCORE_HISTORY_DEFAULT_DAYS = 365
export const STRENGTH_SCORE_HISTORY_DEFAULT_STEP_DAYS = 7
export const STRENGTH_SCORE_HISTORY_MAX_POINTS = 500

export const STRENGTH_SCORE_HISTORY_START_AFTER_END = 'start must be before end'
export const STRENGTH_SCORE_HISTORY_TOO_MANY_POINTS = `the period holds more than ${STRENGTH_SCORE_HISTORY_MAX_POINTS} points; raise step_days or shorten it`

export const strengthScoreGroups = [
  'chest',
  'shoulders',
  'back',
  'biceps',
  'triceps',
  'quadriceps',
  'hamstrings',
  'glutes',
] as const

export const strengthScoreGroupSchema = z.enum(strengthScoreGroups).meta({
  description: 'A muscle group the strength score is given for',
  id: 'StrengthScoreGroup',
})

export type StrengthScoreGroup = z.infer<typeof strengthScoreGroupSchema>

export const strengthScoreMissingSchema = z.enum(['sex', 'bodyweight']).meta({
  description:
    'What a score needs and the user has not given: `sex` in the user settings, `bodyweight` as at least one value of the weight metric',
  id: 'StrengthScoreMissing',
})

export type StrengthScoreMissing = z.infer<typeof strengthScoreMissingSchema>

const strengthScoreFieldSchema = dataFieldPathSchema.meta({
  description: 'A catalogue-backed item path of the activity type, e.g. sets.exercise',
  example: 'sets.exercise',
})

export const strengthScoreQuerySchema = z
  .object({
    at: z.iso
      .datetime({ offset: true })
      .optional()
      .meta({ description: 'The moment the score is given for (ISO 8601); defaults to now' }),
    field: strengthScoreFieldSchema,
  })
  .meta({
    description: 'Which item path the exercises are read from, and the moment scored',
    id: 'StrengthScoreQuery',
  })

export type StrengthScoreQuery = z.infer<typeof strengthScoreQuerySchema>

export const strengthScoreSetSchema = z
  .object({
    activity_type: z.string(),
    bodyweight: z.number().optional().meta({
      description:
        'Bodyweight in kg the reference is scaled to: the latest weight at or before the session, else the earliest after it; absent without any weight',
    }),
    catalog_key: z.string().meta({ description: 'The catalogue entry the logged exercise resolves to' }),
    e1rm: z
      .number()
      .meta({ description: 'Estimated one-rep max in kg (Epley: weight × (1 + reps / 30)), one decimal' }),
    reference_e1rm: z.number().optional().meta({
      description:
        'The one-rep max in kg that scores 100 points at that bodyweight and sex, one decimal; absent without sex or bodyweight',
    }),
    reps: z.number(),
    session_id: z.string().meta({ description: 'Session id (`merged:<id>` for a merged session)' }),
    start_time: z.string().meta({ description: 'ISO start time of the session' }),
    value: z.string().meta({ description: 'The exercise as logged' }),
    weight: z.number().meta({ description: 'Logged weight in kg; one dumbbell for a dumbbell lift' }),
  })
  .meta({
    description: 'The set a lift is scored on: its best working set of 1 to 12 reps in the window',
    id: 'StrengthScoreSet',
  })

export type StrengthScoreSet = z.infer<typeof strengthScoreSetSchema>

const pointsSchema = z.number().int().nullable()

export const strengthScoreLiftSchema = z
  .object({
    best: strengthScoreSetSchema.optional().meta({ description: 'Absent when no set in the window counts' }),
    catalog_keys: z.array(z.string()).meta({ description: 'The catalogue entries that count as this lift' }),
    counted: z.boolean().meta({
      description: `Whether the lift is among the group's best ${STRENGTH_SCORE_GROUP_LIFTS} and so in its score`,
    }),
    expires_at: z.string().optional().meta({
      description: 'ISO time at which `best` leaves the window; a lower set may take its place then',
    }),
    lift: z.string().meta({ description: 'Id of the reference lift' }),
    name: z.string().meta({ description: 'Display name of the reference lift' }),
    score: pointsSchema.meta({
      description:
        '100 × e1rm / reference_e1rm of the best set, whole points; null without a set in the window, or without sex or bodyweight',
    }),
  })
  .meta({ description: 'A reference lift and its score', id: 'StrengthScoreLift' })

export type StrengthScoreLift = z.infer<typeof strengthScoreLiftSchema>

export const strengthScoreGroupResultSchema = z
  .object({
    group: strengthScoreGroupSchema,
    lifts: z.array(strengthScoreLiftSchema).meta({
      description: 'Every reference lift of the group: scored ones first, highest score first',
    }),
    muscle_groups: z
      .array(exerciseMuscleGroupSchema)
      .meta({ description: 'The muscle groups of the exercise catalogue the score group covers' }),
    name: z.string().meta({ description: 'Display name of the group' }),
    score: pointsSchema.meta({
      description: `Mean of the group's best ${STRENGTH_SCORE_GROUP_LIFTS} lift scores (fewer when fewer are scored); null with none`,
    }),
  })
  .meta({ description: "A muscle group's strength score and its lifts", id: 'StrengthScoreGroupResult' })

export type StrengthScoreGroupResult = z.infer<typeof strengthScoreGroupResultSchema>

const missingSchema = z.array(strengthScoreMissingSchema).meta({
  description: 'Empty when a score can be given; otherwise every score is null',
})

export const strengthScoreSchema = z
  .object({
    at: z.string().meta({ description: 'ISO time the score is given for' }),
    field: z.string().meta({ description: 'The item path the exercises are read from' }),
    groups: z
      .array(strengthScoreGroupResultSchema)
      .meta({ description: 'Every score group, in a fixed order' }),
    missing: missingSchema,
    score: pointsSchema.meta({ description: 'Mean of the group scores that are not null; null with none' }),
    window_days: z.number().int().meta({ description: 'Sessions this many days before `at` count' }),
  })
  .meta({
    description:
      'Strength score at a moment: per reference lift the best estimated one-rep max of the window against a reference by sex and bodyweight (100 points: a solid recreational lifter), averaged per muscle group and overall',
    id: 'StrengthScore',
  })

export type StrengthScore = z.infer<typeof strengthScoreSchema>

export const strengthScoreResponseSchema = createDataResponseSchema(strengthScoreSchema).meta({
  id: 'StrengthScoreResponse',
})

export type StrengthScoreResponse = z.infer<typeof strengthScoreResponseSchema>

interface HistoryQuery {
  end?: string
  start?: string
  step_days?: number
}

/** The period of a history query: `end` defaults to `now`, `start` to 365 days before `end`. */
export const strengthScoreHistoryPeriod = (
  query: HistoryQuery,
  now: Date = new Date(),
): { end: Date; start: Date; step_days: number } => {
  const end = query.end === undefined ? now : new Date(query.end)
  const start =
    query.start === undefined
      ? new Date(end.getTime() - STRENGTH_SCORE_HISTORY_DEFAULT_DAYS * 86_400_000)
      : new Date(query.start)
  return { end, start, step_days: query.step_days ?? STRENGTH_SCORE_HISTORY_DEFAULT_STEP_DAYS }
}

/** Why a history period cannot be answered, or undefined when it can. */
export const strengthScoreHistoryPeriodError = (period: {
  end: Date
  start: Date
  step_days: number
}): string | undefined => {
  const span = period.end.getTime() - period.start.getTime()
  if (span <= 0) return STRENGTH_SCORE_HISTORY_START_AFTER_END
  return span / (period.step_days * 86_400_000) + 1 > STRENGTH_SCORE_HISTORY_MAX_POINTS
    ? STRENGTH_SCORE_HISTORY_TOO_MANY_POINTS
    : undefined
}

export const strengthScoreHistoryQuerySchema = z
  .object({
    end: z.iso
      .datetime({ offset: true })
      .optional()
      .meta({ description: 'End of the period and the last point (ISO 8601); defaults to now' }),
    field: strengthScoreFieldSchema,
    start: z.iso
      .datetime({ offset: true })
      .optional()
      .meta({ description: 'Start of the period (ISO 8601); defaults to 365 days before end' }),
    step_days: z.coerce
      .number()
      .int()
      .min(1)
      .max(31)
      .optional()
      .meta({ description: 'Days between two points, 1 to 31; defaults to 7' }),
  })
  .superRefine((query, ctx) => {
    const error = strengthScoreHistoryPeriodError(strengthScoreHistoryPeriod(query))
    if (error !== undefined) ctx.addIssue({ code: 'custom', message: error, path: ['start'] })
  })
  .meta({
    description: 'Which item path the exercises are read from, the period and the spacing of its points',
    id: 'StrengthScoreHistoryQuery',
  })

export type StrengthScoreHistoryQuery = z.infer<typeof strengthScoreHistoryQuerySchema>

export const strengthScoreHistoryPointSchema = z
  .object({
    at: z.string().meta({ description: 'ISO time the point is scored at' }),
    groups: z
      .partialRecord(strengthScoreGroupSchema, z.number().int())
      .meta({ description: 'The score of every group that has one at that time' }),
    score: pointsSchema.meta({ description: 'The overall score at that time; null with no group score' }),
  })
  .meta({ description: 'The strength score at one moment', id: 'StrengthScoreHistoryPoint' })

export type StrengthScoreHistoryPoint = z.infer<typeof strengthScoreHistoryPointSchema>

export const strengthScoreHistorySchema = z
  .object({
    end: z.string().meta({ description: 'ISO end of the period' }),
    field: z.string().meta({ description: 'The item path the exercises are read from' }),
    missing: missingSchema,
    points: z.array(strengthScoreHistoryPointSchema).meta({
      description:
        'The score at `end` and every `step_days` before it down to `start`, oldest first; each point looks back over its own window. Empty when something is missing',
    }),
    start: z.string().meta({ description: 'ISO start of the period' }),
    step_days: z.number().int(),
  })
  .meta({ description: 'The strength score over time', id: 'StrengthScoreHistory' })

export type StrengthScoreHistory = z.infer<typeof strengthScoreHistorySchema>

export const strengthScoreHistoryResponseSchema = createDataResponseSchema(strengthScoreHistorySchema).meta({
  id: 'StrengthScoreHistoryResponse',
})

export type StrengthScoreHistoryResponse = z.infer<typeof strengthScoreHistoryResponseSchema>
