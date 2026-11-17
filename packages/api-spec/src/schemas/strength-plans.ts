import { z } from 'zod'

import { createDataResponseSchema } from './common.ts'

export const STRENGTH_PLAN_MAX_SETS = 200

export const strengthPlanSetTypes = ['normal', 'warmup', 'drop_set', 'failure'] as const

export const strengthPlanSetSchema = z
  .object({
    exercise: z.string().trim().min(1).max(200).meta({
      description:
        "Exercise name, as on a logged set: the user's own name for it when they have one (list_activity_field_values with field sets.exercise), else a name of the exercise catalogue",
      example: 'Barbell Bench Press',
    }),
    exercise_key: z.string().max(200).optional().meta({
      description:
        'Key of the exercise catalogue entry the name stands for; given on to the logged sets, which ties a new name to the entry. An unknown key is refused',
      example: 'barbell_bench_press',
    }),
    note: z.string().trim().max(500).optional().meta({ description: 'A cue for the set' }),
    reps: z.number().int().min(1).max(1000).optional().meta({ description: 'Planned repetitions' }),
    set_type: z.enum(strengthPlanSetTypes).optional(),
    time: z
      .number()
      .positive()
      .max(86_400)
      .optional()
      .meta({ description: 'Planned hold or duration in seconds' }),
    weight: z.number().min(0).max(2000).optional().meta({
      description: 'Planned weight in kg; one dumbbell for a dumbbell exercise, as sets are logged',
    }),
  })
  .meta({
    description:
      'A planned set, with the item fields of a logged strength set. Consecutive sets of one exercise form a block',
    id: 'StrengthPlanSet',
  })

export type StrengthPlanSet = z.infer<typeof strengthPlanSetSchema>

const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .meta({ description: 'Name of the plan', example: 'Push day' })

const plannedForSchema = z.iso.date().nullable().meta({
  description:
    'The day (YYYY-MM-DD) the workout is planned for; null for a routine, which has no day and can be started any number of times',
  example: '2026-11-19',
})

const noteSchema = z.string().trim().max(2000).nullable().meta({
  description: 'Free text shown with the plan: the idea behind it, what to watch',
})

const setsSchema = z.array(strengthPlanSetSchema).min(1).max(STRENGTH_PLAN_MAX_SETS).meta({
  description: 'The planned sets in the order to do them',
})

export const createStrengthPlanBodySchema = z
  .object({
    name: nameSchema,
    note: noteSchema.optional(),
    planned_for: plannedForSchema.optional(),
    sets: setsSchema,
  })
  .meta({ id: 'CreateStrengthPlanBody' })

export type CreateStrengthPlanBody = z.infer<typeof createStrengthPlanBodySchema>

export const updateStrengthPlanBodySchema = z
  .object({
    name: nameSchema.optional(),
    note: noteSchema.optional(),
    planned_for: plannedForSchema.optional(),
    sets: setsSchema.optional(),
  })
  .meta({
    description: 'The fields to change; a field left out stays as it is',
    id: 'UpdateStrengthPlanBody',
  })

export type UpdateStrengthPlanBody = z.infer<typeof updateStrengthPlanBodySchema>

export const strengthPlanSessionSchema = z
  .object({
    activity_id: z.string(),
    start_time: z.string().meta({ description: 'ISO start time' }),
  })
  .meta({ description: 'A session started from the plan', id: 'StrengthPlanSession' })

export type StrengthPlanSession = z.infer<typeof strengthPlanSessionSchema>

export const strengthPlanSchema = z
  .object({
    created_at: z.string(),
    id: z.string(),
    name: z.string(),
    note: z.string().nullable(),
    planned_for: z.string().nullable().meta({ description: 'YYYY-MM-DD, or null for a routine' }),
    sessions: z.array(strengthPlanSessionSchema).meta({
      description:
        'The strength sessions started from the plan (their `data.plan_id` is its id), newest first. A plan with a day and a session is done',
    }),
    sets: z.array(strengthPlanSetSchema),
    updated_at: z.string(),
  })
  .meta({
    description:
      'A planned strength workout: with a day it is a workout to do once, without one a routine to start whenever',
    id: 'StrengthPlan',
  })

export type StrengthPlan = z.infer<typeof strengthPlanSchema>

export const strengthPlanStatuses = ['open', 'all'] as const

export const strengthPlansQuerySchema = z
  .object({
    status: z.enum(strengthPlanStatuses).optional().meta({
      description:
        '`open` (default): routines and the plans with a day that have no session yet. `all`: also the done ones',
    }),
  })
  .meta({ id: 'StrengthPlansQuery' })

export type StrengthPlansQuery = z.infer<typeof strengthPlansQuerySchema>

export const strengthPlanResponseSchema = createDataResponseSchema(strengthPlanSchema).meta({
  id: 'StrengthPlanResponse',
})

export type StrengthPlanResponse = z.infer<typeof strengthPlanResponseSchema>

export const strengthPlansResponseSchema = createDataResponseSchema(z.array(strengthPlanSchema)).meta({
  id: 'StrengthPlansResponse',
})

export type StrengthPlansResponse = z.infer<typeof strengthPlansResponseSchema>
