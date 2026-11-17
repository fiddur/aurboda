import {
  createStrengthPlanBodySchema,
  strengthPlansQuerySchema,
  updateStrengthPlanBodySchema,
} from '@aurboda/api-spec'
import { z } from 'zod'

import { createStrengthPlansService, type StrengthPlansService } from '../services/strength-plans.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

const planId = z.string().describe('Plan ID')

// `planned_for` and `note` are re-declared without `.nullable()`: a nullable field makes
// clients that validate the tool list (e.g. Claude) drop the whole tool.
const noteInput = z.string().trim().max(2000).optional()
const createFields = {
  ...createStrengthPlanBodySchema.shape,
  note: noteInput.describe('Free text shown with the plan: the idea behind it, what to watch'),
  planned_for: z.iso
    .date()
    .optional()
    .describe('The day (YYYY-MM-DD) the workout is planned for; leave out for a routine'),
}
const updateFields = {
  ...updateStrengthPlanBodySchema.shape,
  note: noteInput.describe('New note; an empty string clears it'),
  planned_for: z
    .string()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/)
    .optional()
    .describe('New day (YYYY-MM-DD); an empty string removes the day and makes it a routine'),
}

const emptyToNull = (value: string | undefined): string | null | undefined => (value === '' ? null : value)

const CREATE_DESCRIPTION = [
  'Plan a strength workout ahead of time: a named list of planned sets.',
  "The plan shows on the user's strength start page with a Start button; starting it opens a live session prefilled with the planned sets, which the user then logs (the session's activity carries the plan's id in `data.plan_id`, and the plan lists it under `sessions`).",
  '`planned_for` (YYYY-MM-DD) makes it a workout for that day, done once a session is started from it; leave it out for a routine, which has no day and can be started any number of times.',
  '`sets` are in the order to do them; consecutive sets of one exercise form a block, so write every set of an exercise (warm-ups with `set_type: "warmup"`) one after another.',
  'Each set has `reps` or `time` (seconds, for holds and timed sets) and, where it applies, `weight` in kg: for a dumbbell exercise the weight of ONE dumbbell, as sets are logged. `note` on a set is a cue; `note` on the plan is the idea behind it.',
  'Exercise names: use the user\'s own names first (list_activity_field_values with activity_type strength_training and field "sets.exercise"), so the logged sets continue their history; otherwise take a catalogue name from search_exercise_catalog and give that entry\'s key as `exercise_key` (an unknown key is refused).',
  'Before planning, read: get_muscle_recovery (which muscle groups are ready, 80 and above; pass a later `at` for the day of a plan ahead), get_strength_score (best recent sets per lift, to pick weights), get_activity_item_history or query_activities for what was done last time, and list_strength_plans so as not to plan the same workout twice.',
].join(' ')

export const registerStrengthPlanTools = (
  server: McpServer,
  user: string,
  service: StrengthPlansService = createStrengthPlansService(),
) => {
  server.tool(
    'list_strength_plans',
    'List planned strength workouts (see create_strength_plan), each with its sets and the `sessions` started from it (newest session first). `status`: `open` (default) gives the routines and the plans with a day that no session has been started from; `all` also the done ones. Plans with a day come first, earliest first, then routines by name.',
    { ...strengthPlansQuerySchema.shape },
    async ({ status }) => jsonResponse({ plans: await service.list(user, status) }),
  )

  server.tool(
    'get_strength_plan',
    'Get one planned strength workout by ID, with its sets and the sessions started from it.',
    { id: planId },
    async ({ id }) => {
      const result = await service.get(user, id)
      return result.success ? jsonResponse(result.data) : errorResponse(result.error)
    },
  )

  server.tool('create_strength_plan', CREATE_DESCRIPTION, createFields, async (body) => {
    const result = await service.create(user, body)
    return result.success ? jsonResponse(result.data) : errorResponse(result.error)
  })

  server.tool(
    'update_strength_plan',
    'Change a planned strength workout (see create_strength_plan). A field left out stays as it is; an empty `planned_for` turns it into a routine and an empty `note` clears the note; `sets`, when given, replaces the whole list.',
    { id: planId, ...updateFields },
    async ({ id, note, planned_for, ...rest }) => {
      const body = updateStrengthPlanBodySchema.safeParse({
        ...rest,
        ...(note !== undefined && { note: emptyToNull(note) }),
        ...(planned_for !== undefined && { planned_for: emptyToNull(planned_for) }),
      })
      if (!body.success) return errorResponse(body.error.issues[0]?.message ?? 'Invalid plan')
      const result = await service.update(user, id, body.data)
      return result.success ? jsonResponse(result.data) : errorResponse(result.error)
    },
  )

  server.tool(
    'delete_strength_plan',
    'Delete a planned strength workout by ID. Sessions already started from it are kept.',
    { id: planId },
    async ({ id }) => {
      const result = await service.remove(user, id)
      return result.success ? jsonResponse({ deleted: true, id }) : errorResponse(result.error)
    },
  )
}
