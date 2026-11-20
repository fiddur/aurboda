import type { CheckInStatus, DueSlotState, Schedule } from '@aurboda/api-spec'

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
  status: CheckInStatus
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

const answeredFirst = (a: SlotCheckIn, b: SlotCheckIn): number =>
  (a.status === 'skipped' ? 1 : 0) - (b.status === 'skipped' ? 1 : 0)

/**
 * Each slot's state at `now`. A slot is done by an answered check-in whose `scheduled_for` is the
 * slot, and skipped by a skip of it (an answer to the same slot wins); a check-in without
 * `scheduled_for` counts, in the order answered, for the earliest slot of its day still open.
 */
export const slotStates = (
  slots: readonly ScheduleSlot[],
  checkIns: readonly SlotCheckIn[],
  now: Date,
): SlotWithState[] => {
  const takenBy = new Map<ScheduleSlot, SlotCheckIn>()
  for (const checkIn of [...checkIns].sort(answeredFirst)) {
    if (!checkIn.scheduled_for) continue
    const slot = slots.find((s) => s.at.getTime() === checkIn.scheduled_for!.getTime() && !takenBy.has(s))
    if (slot) takenBy.set(slot, checkIn)
  }
  const unscheduled = checkIns
    .filter((checkIn) => !checkIn.scheduled_for)
    .sort((a, b) => a.answered_at.getTime() - b.answered_at.getTime())
  for (const checkIn of unscheduled) {
    const at = checkIn.answered_at.getTime()
    const slot = slots.find((s) => !takenBy.has(s) && at >= s.day_start.getTime() && at < s.day_end.getTime())
    if (slot) takenBy.set(slot, checkIn)
  }
  return slots.map((slot) => {
    const checkIn = takenBy.get(slot)
    if (!checkIn) return { check_in_id: null, slot, state: stateAt(slot, now) }
    return { check_in_id: checkIn.id, slot, state: checkIn.status === 'skipped' ? 'skipped' : 'done' }
  })
}

/** The slots of each day from `from` to `to` (YYYY-MM-DD, both included), in time order. */
export const slotsBetween = (
  schedule: DaySchedule,
  from: string,
  to: string,
  timezone: string,
): { date: string; slots: ScheduleSlot[] }[] => {
  const days: { date: string; slots: ScheduleSlot[] }[] = []
  for (let date = from; date <= to; date = nextDate(date)) {
    days.push({ date, slots: slotsForDay(schedule, date, timezone) })
  }
  return days
}
