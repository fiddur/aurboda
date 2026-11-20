import {
  addCheckInFormBodySchema,
  checkInAdherenceQuerySchema,
  checkInFormsQuerySchema,
  checkInsQuerySchema,
  dueQuerySchema,
  submitCheckInBodySchema,
  updateCheckInBodySchema,
  updateCheckInFormBodySchema,
} from '@aurboda/api-spec'
import { z } from 'zod'

import {
  addCheckInForm,
  type CheckInDeps,
  checkInDeps,
  deleteCheckInById,
  deleteCheckInFormById,
  getCheckInAdherence,
  getCheckInFormById,
  listCheckInFormsView,
  listCheckInTemplates,
  listDue,
  type Outcome,
  queryCheckIns,
  restoreCheckInById,
  restoreCheckInFormById,
  submitCheckIn,
  updateCheckInById,
  updateCheckInFormById,
} from '../services/check-ins.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

const issues = (error: z.ZodError): string =>
  error.issues
    .map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
    .join('; ')

const answer = <T>(outcome: Outcome<T>, field: 'adherence' | 'check_in' | 'form') =>
  outcome.ok ? jsonResponse({ [field]: outcome.value, success: true }) : errorResponse(outcome.error)

const FORM_NOT_FOUND = 'Check-in form not found'
const CHECK_IN_NOT_FOUND = 'Check-in not found'

export const registerCheckInTools = (server: McpServer, user: string, deps: CheckInDeps = checkInDeps) => {
  server.tool(
    'list_check_in_forms',
    "List the user's check-in forms with their questions, score, schedule and current version. `is_routine` marks a routine (every required question has a `default`), which submit_check_in saves in one go with `use_defaults`; a routine without a schedule is an as-needed favourite. `deleted: true` lists the deleted ones instead, restorable for 30 days.",
    { ...checkInFormsQuerySchema.shape },
    async (params) => {
      const parsed = checkInFormsQuerySchema.safeParse(params)
      if (!parsed.success) return errorResponse(issues(parsed.error))
      return jsonResponse({ forms: await listCheckInFormsView(deps, user, parsed.data), success: true })
    },
  )

  server.tool(
    'get_check_in_form',
    'Get one check-in form by ID, deleted or not.',
    { id: z.string().describe('The form ID') },
    async ({ id }) => {
      const form = await getCheckInFormById(deps, user, id)
      return form ? jsonResponse({ form, success: true }) : errorResponse(FORM_NOT_FOUND)
    },
  )

  server.tool(
    'add_check_in_form',
    'Create a check-in form, from `name` and `questions` or by copying a `template` (see list_check_in_templates; the other fields override its own). A question may log its answer to a metric (`logs_to: { metric }`), created as a custom metric on first use, or as an activity (`logs_to: { activity_type, fields, answer_field }`, e.g. a `supplement` with `fields: { substance: "vitamin D", dose_unit: "µg" }` and `answer_field: "dose"`); `score` sums some answers times `factor` into a metric. A question with a `default` has a preset answer; a form whose required questions all have one is a routine. A `schedule` asks for the form with a `check_in_due` notification when a slot is due (with Done and Skip for a routine).',
    { ...addCheckInFormBodySchema.shape },
    async (params) => {
      const parsed = addCheckInFormBodySchema.safeParse(params)
      if (!parsed.success) return errorResponse(issues(parsed.error))
      return answer(await addCheckInForm(deps, user, parsed.data), 'form')
    },
  )

  server.tool(
    'update_check_in_form',
    'Change a check-in form by ID: give only the fields to change. `questions` replaces them all; changing a question (not just its place) or the score makes a new version, and earlier check-ins stay read against the version they answered. A new or changed schedule starts with its next slot.',
    { id: z.string().describe('The form ID'), ...updateCheckInFormBodySchema.shape },
    async ({ id, ...fields }) => {
      const parsed = updateCheckInFormBodySchema.safeParse(fields)
      if (!parsed.success) return errorResponse(issues(parsed.error))
      return answer(await updateCheckInFormById(deps, user, id, parsed.data), 'form')
    },
  )

  server.tool(
    'delete_check_in_form',
    'Delete a check-in form by ID. It stops asking; its check-ins stay readable. Restorable for 30 days with restore_check_in_form.',
    { id: z.string().describe('The form ID') },
    async ({ id }) => {
      const form = await deleteCheckInFormById(deps, user, id)
      return form ? jsonResponse({ form, success: true }) : errorResponse(FORM_NOT_FOUND)
    },
  )

  server.tool(
    'restore_check_in_form',
    'Restore a deleted check-in form by ID; its schedule starts again with its next slot.',
    { id: z.string().describe('The form ID') },
    async ({ id }) => {
      const form = await restoreCheckInFormById(deps, user, id)
      return form
        ? jsonResponse({ form, success: true })
        : errorResponse('No deleted check-in form with that ID')
    },
  )

  server.tool(
    'get_check_in_adherence',
    "How a check-in form was kept up from `from` to `to` (local dates, at most 366 days, default the last 30): its slots counted `done`, `skipped`, `missed` and `upcoming` (today's still open), per day and in total, read against the form's current schedule; and per question how many answered check-ins answered it with something other than 0 or no (for a routine, how often each item was taken).",
    { id: z.string().describe('The form ID'), ...checkInAdherenceQuerySchema.shape },
    async ({ id, ...fields }) => {
      const parsed = checkInAdherenceQuerySchema.safeParse(fields)
      if (!parsed.success) return errorResponse(issues(parsed.error))
      return answer(await getCheckInAdherence(deps, user, id, parsed.data), 'adherence')
    },
  )

  server.tool(
    'list_check_in_templates',
    'List the built-in check-in forms that add_check_in_form can copy with `template`, each with its source and licence.',
    {},
    async () => jsonResponse({ success: true, templates: listCheckInTemplates() }),
  )

  server.tool(
    'submit_check_in',
    'Save a check-in: `answers` to the form\'s current questions, keyed by question key. `use_defaults: true` saves a routine\'s preset answers (`answers` given alongside win per key). Answers whose question has `logs_to` are logged as metric points or activities at `answered_at` (data source `check_in`); 0, no, or no answer logs nothing. Pass `scheduled_for` (from list_due) to answer a particular slot, or with `status: "skipped"` to record it as skipped. `entity_type: "activity"` and `entity_id` tie the check-in to an activity.',
    { ...submitCheckInBodySchema.shape },
    async (params) => {
      const parsed = submitCheckInBodySchema.safeParse(params)
      if (!parsed.success) return errorResponse(issues(parsed.error))
      return answer(await submitCheckIn(deps, user, parsed.data), 'check_in')
    },
  )

  server.tool(
    'query_check_ins',
    'List check-ins newest first, each with its form name and the questions of the version it answered. Filter by `from`/`to`, `form_id`, or `entity_type` and `entity_id` (those tied to an activity); page with `cursor`; `deleted: true` lists the deleted ones.',
    { ...checkInsQuerySchema.shape },
    async (params) => {
      const parsed = checkInsQuerySchema.safeParse(params)
      if (!parsed.success) return errorResponse(issues(parsed.error))
      return jsonResponse({ ...(await queryCheckIns(deps, user, parsed.data)), success: true })
    },
  )

  server.tool(
    'update_check_in',
    'Change a check-in by ID: its answers (read against the version it answered), time, slot or note. The metric points and activities it logged are replaced.',
    { id: z.string().describe('The check-in ID'), ...updateCheckInBodySchema.shape },
    async ({ id, ...fields }) => {
      const parsed = updateCheckInBodySchema.safeParse(fields)
      if (!parsed.success) return errorResponse(issues(parsed.error))
      return answer(await updateCheckInById(deps, user, id, parsed.data), 'check_in')
    },
  )

  server.tool(
    'delete_check_in',
    'Delete a check-in by ID, the metric points it logged and the activities it logged. Restorable for 30 days with restore_check_in.',
    { id: z.string().describe('The check-in ID') },
    async ({ id }) => {
      const checkIn = await deleteCheckInById(deps, user, id)
      return checkIn ? jsonResponse({ check_in: checkIn, success: true }) : errorResponse(CHECK_IN_NOT_FOUND)
    },
  )

  server.tool(
    'restore_check_in',
    'Restore a deleted check-in by ID; the metric points it logged are written again and its activities restored.',
    { id: z.string().describe('The check-in ID') },
    async ({ id }) => answer(await restoreCheckInById(deps, user, id), 'check_in'),
  )

  server.tool(
    'list_due',
    "List the slots of the user's scheduled check-in forms on a day, each `upcoming`, `due`, `done`, `skipped` or `missed`. Without `date`, each form's current day.",
    { ...dueQuerySchema.shape },
    async (params) => {
      const parsed = dueQuerySchema.safeParse(params)
      if (!parsed.success) return errorResponse(issues(parsed.error))
      return jsonResponse({ ...(await listDue(deps, user, parsed.data.date)), success: true })
    },
  )
}
