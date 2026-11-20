import { z } from 'zod'

import { allWeekdays, reminderTimeOfDayRe } from './reminders.ts'

export const SCHEDULE_TIMES_MAX = 12

export const DEFAULT_DAY_STARTS_AT = '04:00'

const timeOnGridSchema = z.string().regex(reminderTimeOfDayRe, 'Must be HH:MM in five-minute steps')

const scheduleDateSchema = z.iso.date()

/**
 * A recurring schedule in the user's time zone: one or more times on the five-minute grid, on some
 * ISO weekdays, between optional dates. A time earlier than `day_starts_at` belongs to the day before
 * (a 00:30 "bedtime" slot is part of the evening that started it), and the weekdays and dates are
 * those of that day.
 */
export const scheduleSchema = z
  .object({
    day_starts_at: timeOnGridSchema.default(DEFAULT_DAY_STARTS_AT).meta({
      description:
        'Local time (HH:MM, five-minute steps) a day starts at: a slot before it belongs to the day before (default 04:00)',
      example: '04:00',
    }),
    end_date: scheduleDateSchema
      .optional()
      .meta({ description: 'Last day (YYYY-MM-DD) the schedule has slots on, if any' }),
    start_date: scheduleDateSchema
      .optional()
      .meta({ description: 'First day (YYYY-MM-DD) the schedule has slots on, if any' }),
    times: z
      .array(timeOnGridSchema)
      .min(1)
      .max(SCHEDULE_TIMES_MAX)
      .refine((times) => new Set(times).size === times.length, 'Times must be unique')
      .meta({
        description: `Local times (HH:MM, five-minute steps) of the slots in a day, 1 to ${SCHEDULE_TIMES_MAX}`,
        example: ['08:00', '20:00'],
      }),
    weekdays: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .refine((days) => new Set(days).size === days.length, 'Weekdays must be unique')
      .default([...allWeekdays])
      .meta({ description: 'ISO weekdays with slots: 1 = Monday … 7 = Sunday (default every day)' }),
  })
  .refine(
    (schedule) =>
      schedule.start_date === undefined ||
      schedule.end_date === undefined ||
      schedule.start_date <= schedule.end_date,
    { message: 'end_date must not be before start_date', path: ['end_date'] },
  )
  .meta({
    description: "A recurring schedule of slots in the user's time zone",
    id: 'Schedule',
  })

export type Schedule = z.infer<typeof scheduleSchema>
