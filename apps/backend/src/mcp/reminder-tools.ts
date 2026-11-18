import { addReminderBodySchema, updateReminderBodySchema } from '@aurboda/api-spec'
import { z } from 'zod'

import {
  addReminder,
  deleteReminderById,
  listRemindersView,
  type ReminderDeps,
  reminderDeps,
  updateReminderById,
} from '../services/reminders.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

const issues = (error: z.ZodError): string => error.issues.map((issue) => issue.message).join('; ')

export const registerReminderTools = (server: McpServer, user: string, deps: ReminderDeps = reminderDeps) => {
  server.tool(
    'list_reminders',
    "List the user's recurring reminders. Each has `next_due_at` (the next time it raises a `reminder` notification, null when switched off); `timezone` is the zone the times are read in.",
    {},
    async () => jsonResponse({ ...(await listRemindersView(deps, user)), success: true }),
  )

  server.tool(
    'add_reminder',
    "Create a recurring reminder: a `reminder` notification at `time_of_day` (HH:MM, five-minute steps, in the user's time zone) on each of `weekdays` (1 = Monday … 7 = Sunday, default every day). One created after today's time starts with the next matching day.",
    { ...addReminderBodySchema.shape },
    async (params) => {
      const parsed = addReminderBodySchema.safeParse(params)
      if (!parsed.success) return errorResponse(issues(parsed.error))
      return jsonResponse({ reminder: await addReminder(deps, user, parsed.data), success: true })
    },
  )

  server.tool(
    'update_reminder',
    'Change a reminder by ID: give only the fields to change (`body` and `link` take null to clear). Changing the time or days, or switching it back on, starts it afresh from now.',
    { id: z.string().describe('The reminder ID'), ...updateReminderBodySchema.shape },
    async ({ id, ...fields }) => {
      const parsed = updateReminderBodySchema.safeParse(fields)
      if (!parsed.success) return errorResponse(issues(parsed.error))
      const reminder = await updateReminderById(deps, user, id, parsed.data)
      if (!reminder) return errorResponse('Reminder not found')
      return jsonResponse({ reminder, success: true })
    },
  )

  server.tool(
    'delete_reminder',
    'Delete a reminder by ID. Notifications it already raised stay.',
    { id: z.string().describe('The reminder ID') },
    async ({ id }) => {
      if (!(await deleteReminderById(deps, user, id))) return errorResponse('Reminder not found')
      return jsonResponse({ success: true })
    },
  )
}
