import {
  addPersonBodySchema,
  addPersonDateBodySchema,
  importantDatesQuerySchema,
  peopleQuerySchema,
  personPostsQuerySchema,
  personRelationshipSuggestions,
  updatePersonBodySchema,
  updatePersonDateBodySchema,
} from '@aurboda/api-spec'
import { z } from 'zod'

import {
  addPerson,
  addPersonDate,
  deletePersonById,
  deletePersonDateById,
  getPersonDetail,
  listImportantDates,
  listPeopleView,
  listPersonPosts,
  PERSON_NOT_FOUND,
  type PeopleDeps,
  type PeopleResult,
  restorePersonById,
  updatePersonById,
  updatePersonDateById,
} from '../services/people.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

const issues = (error: z.ZodError): string => error.issues.map((issue) => issue.message).join('; ')

const personId = z.string().describe('The person ID')
const dateId = z.string().describe('The date ID')

const respond = <T>(result: PeopleResult<T>, key: string) =>
  result.ok ? jsonResponse({ [key]: result.value, success: true }) : errorResponse(result.error)

export const registerPeopleTools = (server: McpServer, user: string, deps: PeopleDeps) => {
  server.tool(
    'list_people',
    "List the user's private profiles of people, by name, each with birthday, relationship and fediverse `actor` when it has a handle. `archived: true` includes archived people; `deleted: true` lists the deleted ones that can still be restored instead.",
    { ...peopleQuerySchema.shape },
    async (params) => {
      const parsed = peopleQuerySchema.safeParse(params)
      if (!parsed.success) return errorResponse(issues(parsed.error))
      return jsonResponse({
        people: await listPeopleView(deps, user, parsed.data),
        relationship_suggestions: [...personRelationshipSuggestions],
        success: true,
      })
    },
  )

  server.tool(
    'get_person',
    'One person by ID with their dates and the latest activities they were with. Their notes are read with get_notes (entity_type person).',
    { id: personId },
    async ({ id }) => {
      const person = await getPersonDetail(deps, user, id)
      return person ? jsonResponse({ person, success: true }) : errorResponse(PERSON_NOT_FOUND)
    },
  )

  server.tool(
    'add_person',
    'Add a private profile of someone: `name`, and optionally `relationship`, `birth_date` (YYYY-MM-DD, or --MM-DD without a year), `birthday_notify_days_before`, `pronouns` and a fediverse `handle` (@name@server), which is resolved to the account it names. Never shared.',
    { ...addPersonBodySchema.shape },
    async (params) => {
      const parsed = addPersonBodySchema.safeParse(params)
      if (!parsed.success) return errorResponse(issues(parsed.error))
      return respond(await addPerson(deps, user, parsed.data), 'person')
    },
  )

  server.tool(
    'update_person',
    'Change a person by ID: give only the fields to change; `birth_date`, `relationship`, `pronouns`, `handle` and `birthday_notify_days_before` take null to clear.',
    { id: personId, ...updatePersonBodySchema.shape },
    async ({ id, ...fields }) => {
      const parsed = updatePersonBodySchema.safeParse(fields)
      if (!parsed.success) return errorResponse(issues(parsed.error))
      return respond(await updatePersonById(deps, user, id, parsed.data), 'person')
    },
  )

  server.tool(
    'delete_person',
    'Delete a person by ID: they, their dates, notes and activity links go out of sight and can be restored for 30 days. `purge: true` removes all of it for good at once.',
    { id: personId, purge: z.boolean().optional().describe('Remove for good at once') },
    async ({ id, purge }) => {
      if (!(await deletePersonById(deps, user, id, { purge: purge === true }))) {
        return errorResponse(PERSON_NOT_FOUND)
      }
      return jsonResponse({ success: true })
    },
  )

  server.tool(
    'restore_person',
    'Restore a deleted person by ID, with their dates, notes and activity links.',
    { id: personId },
    async ({ id }) => respond(await restorePersonById(deps, user, id), 'person'),
  )

  server.tool(
    'add_person_date',
    'Add a yearly date to a person: `label`, `kind` (birthday, anniversary, remembrance, other), `month`, `day`, optional `year`, and `notify_days_before` (0 to 60) to raise an `important_date` notification ahead of each occurrence.',
    { person_id: personId, ...addPersonDateBodySchema.shape },
    async ({ person_id, ...fields }) => {
      const parsed = addPersonDateBodySchema.safeParse(fields)
      if (!parsed.success) return errorResponse(issues(parsed.error))
      return respond(await addPersonDate(deps, user, person_id, parsed.data), 'date')
    },
  )

  server.tool(
    'update_person_date',
    "Change one of a person's dates: give only the fields to change; `year` and `notify_days_before` take null to clear.",
    { date_id: dateId, person_id: personId, ...updatePersonDateBodySchema.shape },
    async ({ date_id, person_id, ...fields }) => {
      const parsed = updatePersonDateBodySchema.safeParse(fields)
      if (!parsed.success) return errorResponse(issues(parsed.error))
      return respond(await updatePersonDateById(deps, user, person_id, date_id, parsed.data), 'date')
    },
  )

  server.tool(
    'delete_person_date',
    "Delete one of a person's dates for good.",
    { date_id: dateId, person_id: personId },
    async ({ date_id, person_id }) => {
      const result = await deletePersonDateById(deps, user, person_id, date_id)
      return result.ok ? jsonResponse({ success: true }) : errorResponse(result.error)
    },
  )

  server.tool(
    'list_important_dates',
    "Every occurrence of the people's dates and birthdays between `from` and `to` (YYYY-MM-DD, at most 400 days apart; default today to 60 days on, in the user's time zone), by date, with `years` (age or count) when the year is known. Archived and deleted people are left out.",
    { ...importantDatesQuerySchema.shape },
    async (params) => {
      const parsed = importantDatesQuerySchema.safeParse(params)
      if (!parsed.success) return errorResponse(issues(parsed.error))
      const result = await listImportantDates(deps, user, parsed.data)
      return result.ok ? jsonResponse({ ...result.value, success: true }) : errorResponse(result.error)
    },
  )

  server.tool(
    'list_person_posts',
    "A person's recent posts from the user's own timeline (only what the user already received from their fediverse account), newest first. Fails for a person without a handle.",
    { id: personId, ...personPostsQuerySchema.shape },
    async ({ id, limit }) => respond(await listPersonPosts(deps, user, id, limit), 'entries'),
  )
}
