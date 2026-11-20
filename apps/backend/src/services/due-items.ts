import type { DueSlotState, Schedule } from '@aurboda/api-spec'

import { DEFAULT_DAY_STARTS_AT } from '@aurboda/api-spec'

import { occurrenceAt } from './reminders.ts'

export interface ScheduleSlot {
  /** The day (YYYY-MM-DD) the slot belongs to, by `day_starts_at`. */
  date: string
  time: string
  at: Date
  day_start: Date
  day_end: Date
}

export interface SlotCheckIn {
  id: string
  answered_at: Date
  scheduled_for: Date | null
}

export interface SlotWithState {
  slot: ScheduleSlot
  state: DueSlotState
  check_in_id: string | null
}

type DaySchedule = Pick<Schedule, 'end_date' | 'start_date' | 'times' | 'weekdays'> & {
  day_starts_at?: string
}

const dayStartsAt = (schedule: Pick<DaySchedule, 'day_starts_at'>): string =>
  schedule.day_starts_at ?? DEFAULT_DAY_STARTS_AT

const nextDate = (date: string): string => Temporal.PlainDate.from(date).add({ days: 1 }).toString()

export const dayWindow = (date: string, startsAt: string, timezone: string): { start: Date; end: Date } => ({
  end: occurrenceAt(nextDate(date), startsAt, timezone),
  start: occurrenceAt(date, startsAt, timezone),
})

/** The day `now` falls in when days start at `startsAt`: before that time it is still the day before. */
export const currentDay = (now: Date, startsAt: string, timezone: string): string => {
  const calendar = Temporal.Instant.fromEpochMilliseconds(now.getTime())
    .toZonedDateTimeISO(timezone)
    .toPlainDate()
  return now.getTime() >= occurrenceAt(calendar.toString(), startsAt, timezone).getTime()
    ? calendar.toString()
    : calendar.subtract({ days: 1 }).toString()
}

/**
 * The slots of `date` in `timezone`, in time order. A time before `day_starts_at` falls on the next
 * calendar date; the weekday and the start and end dates are those of `date`.
 */
export const slotsForDay = (schedule: DaySchedule, date: string, timezone: string): ScheduleSlot[] => {
  if (schedule.start_date !== undefined && date < schedule.start_date) return []
  if (schedule.end_date !== undefined && date > schedule.end_date) return []
  const weekdays = schedule.weekdays ?? [1, 2, 3, 4, 5, 6, 7]
  if (!weekdays.includes(Temporal.PlainDate.from(date).dayOfWeek)) return []
  const startsAt = dayStartsAt(schedule)
  const { end, start } = dayWindow(date, startsAt, timezone)
  return schedule.times
    .map((time) => ({
      at: occurrenceAt(time < startsAt ? nextDate(date) : date, time, timezone),
      date,
      day_end: end,
      day_start: start,
      time,
    }))
    .sort((a, b) => a.at.getTime() - b.at.getTime())
}

const stateAt = (slot: ScheduleSlot, now: Date): DueSlotState => {
  if (now.getTime() < slot.at.getTime()) return 'upcoming'
  return now.getTime() >= slot.day_end.getTime() ? 'missed' : 'due'
}

/**
 * Each slot's state at `now`. A slot is done by a check-in whose `scheduled_for` is the slot; a
 * check-in without one counts, in the order answered, for the earliest slot of its day still open.
 */
export const slotStates = (
  slots: readonly ScheduleSlot[],
  checkIns: readonly SlotCheckIn[],
  now: Date,
): SlotWithState[] => {
  const takenBy = new Map<ScheduleSlot, string>()
  for (const checkIn of checkIns) {
    if (!checkIn.scheduled_for) continue
    const slot = slots.find((s) => s.at.getTime() === checkIn.scheduled_for!.getTime() && !takenBy.has(s))
    if (slot) takenBy.set(slot, checkIn.id)
  }
  const unscheduled = checkIns
    .filter((checkIn) => !checkIn.scheduled_for)
    .sort((a, b) => a.answered_at.getTime() - b.answered_at.getTime())
  for (const checkIn of unscheduled) {
    const at = checkIn.answered_at.getTime()
    const slot = slots.find((s) => !takenBy.has(s) && at >= s.day_start.getTime() && at < s.day_end.getTime())
    if (slot) takenBy.set(slot, checkIn.id)
  }
  return slots.map((slot) => {
    const checkInId = takenBy.get(slot) ?? null
    return { check_in_id: checkInId, slot, state: checkInId ? 'done' : stateAt(slot, now) }
  })
}
