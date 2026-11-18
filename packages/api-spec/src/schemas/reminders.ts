import { z } from 'zod'

import { baseResponseSchema, iso8601DateTimeSchema } from './common.ts'

export const allWeekdays = [1, 2, 3, 4, 5, 6, 7] as const

export const REMINDER_TITLE_MAX = 120
export const REMINDER_BODY_MAX = 500
export const REMINDER_LINK_MAX = 500

export const reminderTimeOfDayRe = /^([01]\d|2[0-3]):[0-5][05]$/

/** Same rule as a notification's link: an in-app path, never protocol-relative. */
export const isInAppPath = (value: string): boolean => value.startsWith('/') && !value.startsWith('//')

const titleSchema = z
  .string()
  .trim()
  .min(1)
  .max(REMINDER_TITLE_MAX)
  .meta({ description: 'Name of the reminder, shown as the notification title' })

const bodySchema = z
  .string()
  .max(REMINDER_BODY_MAX)
  .meta({ description: 'Optional text shown under the title in the notification' })

const linkSchema = z
  .string()
  .max(REMINDER_LINK_MAX)
  .refine(isInAppPath, 'Must be an in-app path starting with a single /')
  .meta({ description: 'In-app path (starting with `/`) the notification opens, e.g. `/reports`' })

const timeOfDaySchema = z.string().regex(reminderTimeOfDayRe, 'Must be HH:MM in five-minute steps').meta({
  description: "Local time of day (HH:MM, five-minute steps), read in the user's time zone",
  example: '20:00',
})

const weekdaysSchema = z
  .array(z.number().int().min(1).max(7))
  .min(1)
  .max(7)
  .refine((days) => new Set(days).size === days.length, 'Weekdays must be unique')
  .meta({ description: 'ISO weekdays the reminder fires on: 1 = Monday … 7 = Sunday', example: [1, 3, 5] })

export const reminderSchema = z
  .object({
    body: z.string().nullable().meta({ description: 'Text under the title, if any' }),
    created_at: iso8601DateTimeSchema,
    enabled: z.boolean().meta({ description: 'Whether the reminder fires' }),
    id: z.string().uuid().meta({ description: 'Reminder ID' }),
    link: z.string().nullable().meta({ description: 'In-app path the notification opens, if any' }),
    next_due_at: iso8601DateTimeSchema.nullable().meta({
      description: 'The next instant this reminder will raise a notification; null when switched off',
    }),
    time_of_day: z.string().meta({ description: "Local time of day (HH:MM) in the user's time zone" }),
    title: z.string().meta({ description: 'Name of the reminder, shown as the notification title' }),
    updated_at: iso8601DateTimeSchema,
    weekdays: z
      .array(z.number().int())
      .meta({ description: 'ISO weekdays it fires on, sorted: 1 = Monday … 7 = Sunday' }),
  })
  .meta({
    description: 'A recurring reminder the user set up, delivered as a `reminder` notification',
    id: 'Reminder',
  })

export type Reminder = z.infer<typeof reminderSchema>

export const addReminderBodySchema = z
  .object({
    body: bodySchema.optional(),
    enabled: z.boolean().default(true).meta({ description: 'Whether the reminder fires (default true)' }),
    link: linkSchema.optional(),
    time_of_day: timeOfDaySchema,
    title: titleSchema,
    weekdays: weekdaysSchema.default([...allWeekdays]),
  })
  .meta({ description: 'A new recurring reminder', id: 'AddReminderBody' })

export type AddReminderBody = z.infer<typeof addReminderBodySchema>

export const updateReminderBodySchema = z
  .object({
    body: bodySchema.nullable().optional().meta({ description: 'New text; null clears it' }),
    enabled: z.boolean().optional().meta({ description: 'Switch the reminder on or off' }),
    link: linkSchema.nullable().optional().meta({ description: 'New in-app path; null clears it' }),
    time_of_day: timeOfDaySchema.optional(),
    title: titleSchema.optional(),
    weekdays: weekdaysSchema.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Give at least one field to change',
    path: ['title'],
  })
  .meta({ description: 'Fields of a reminder to change; at least one', id: 'UpdateReminderBody' })

export type UpdateReminderBody = z.infer<typeof updateReminderBodySchema>

export const remindersResponseSchema = baseResponseSchema
  .extend({
    next_due_at: iso8601DateTimeSchema
      .nullable()
      .meta({ description: 'The earliest `next_due_at` of all reminders, or null when none is on' }),
    reminders: z.array(reminderSchema),
    timezone: z
      .string()
      .meta({ description: 'The time zone reminder times are read in', example: 'Europe/Stockholm' }),
  })
  .meta({ id: 'RemindersResponse' })

export type RemindersResponse = z.infer<typeof remindersResponseSchema>

export const reminderResponseSchema = baseResponseSchema
  .extend({ reminder: reminderSchema.optional() })
  .meta({ id: 'ReminderResponse' })

export type ReminderResponse = z.infer<typeof reminderResponseSchema>
