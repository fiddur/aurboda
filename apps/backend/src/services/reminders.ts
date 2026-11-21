import {
  type AddReminderBody,
  type Reminder,
  type RemindersResponse,
  type UpdateReminderBody,
  UUID_RE,
} from '@aurboda/api-spec'

import {
  deleteReminder,
  getReminder,
  insertReminder,
  listReminders,
  markReminderNotificationsRead,
  normalizeWeekdays,
  type ReminderInsert,
  type ReminderPatch,
  type ReminderRecord,
  updateReminder,
} from '../db/index.ts'
import { type Notifier, notifier, pingWhenMarkedRead } from './notifications.ts'
import { getUserTimezone } from './settings.ts'

const DUE_WINDOW_MS = 60 * 60 * 1000
const LOOKAHEAD_DAYS = 8

type Schedule = Pick<ReminderRecord, 'enabled' | 'not_before' | 'time_of_day' | 'weekdays'>

export interface ReminderOccurrence {
  /** Local date (YYYY-MM-DD) of the occurrence. */
  date: string
  at: Date
}

/**
 * The instant of `time_of_day` on local `date` in `timezone`. A time skipped by a
 * spring-forward moves to the instant the clocks jump (the first valid one after it); a
 * time that happens twice uses the first.
 */
export const occurrenceAt = (date: string, timeOfDay: string, timezone: string): Date => {
  const local = Temporal.PlainDateTime.from(`${date}T${timeOfDay}`)
  const earlier = local.toZonedDateTime(timezone, { disambiguation: 'earlier' })
  const zoned = earlier.toPlainDateTime().equals(local)
    ? earlier
    : (earlier.getTimeZoneTransition('next') ?? local.toZonedDateTime(timezone, { disambiguation: 'later' }))
  return new Date(zoned.epochMilliseconds)
}

const localDateOf = (instant: Date, timezone: string): Temporal.PlainDate =>
  Temporal.Instant.fromEpochMilliseconds(instant.getTime()).toZonedDateTimeISO(timezone).toPlainDate()

const occurrenceOn = (
  reminder: Schedule,
  date: Temporal.PlainDate,
  timezone: string,
): ReminderOccurrence | null => {
  if (!reminder.weekdays.includes(date.dayOfWeek)) return null
  const at = occurrenceAt(date.toString(), reminder.time_of_day, timezone)
  return at.getTime() >= reminder.not_before.getTime() ? { at, date: date.toString() } : null
}

/**
 * The occurrence due at `now`: its instant is at most an hour ago (a longer outage skips it)
 * and not before `not_before` (so a reminder created after today's time starts tomorrow).
 */
export const dueOccurrence = (reminder: Schedule, timezone: string, now: Date): ReminderOccurrence | null => {
  if (!reminder.enabled) return null
  const today = localDateOf(now, timezone)
  const windowStart = localDateOf(new Date(now.getTime() - DUE_WINDOW_MS), timezone)
  const dates = Temporal.PlainDate.compare(windowStart, today) === 0 ? [today] : [today, windowStart]
  for (const date of dates) {
    const occurrence = occurrenceOn(reminder, date, timezone)
    if (!occurrence) continue
    const age = now.getTime() - occurrence.at.getTime()
    if (age >= 0 && age < DUE_WINDOW_MS) return occurrence
  }
  return null
}

/** The next instant at or after `now` this reminder will raise; null when disabled. */
export const nextOccurrence = (reminder: Schedule, timezone: string, now: Date): Date | null => {
  if (!reminder.enabled) return null
  const today = localDateOf(now, timezone)
  for (let offset = 0; offset < LOOKAHEAD_DAYS; offset++) {
    const occurrence = occurrenceOn(reminder, today.add({ days: offset }), timezone)
    if (occurrence && occurrence.at.getTime() >= now.getTime()) return occurrence.at
  }
  return null
}

export const reminderDedupeKey = (reminderId: string, date: string): string =>
  `reminder:${reminderId}:${date}`

export interface ReminderDeps {
  list: (user: string) => Promise<ReminderRecord[]>
  get: (user: string, id: string) => Promise<ReminderRecord | null>
  insert: (user: string, input: ReminderInsert) => Promise<ReminderRecord>
  update: (user: string, id: string, patch: ReminderPatch) => Promise<ReminderRecord | null>
  delete: (user: string, id: string) => Promise<boolean>
  markRead: (user: string, reminderId: string, exceptDedupeKey?: string) => Promise<number>
  raise: Notifier['raiseBestEffort']
  getTimezone: (user: string) => Promise<string>
  now: () => Date
}

/** Resolved at call time, so importing this module never touches the db module's bindings. */
export const reminderDeps: ReminderDeps = {
  delete: (user, id) => deleteReminder(user, id),
  get: (user, id) => getReminder(user, id),
  getTimezone: (user) => getUserTimezone(user),
  insert: (user, input) => insertReminder(user, input),
  list: (user) => listReminders(user),
  markRead: pingWhenMarkedRead((user, reminderId: string, except?: string) =>
    markReminderNotificationsRead(user, reminderId, except),
  ),
  now: () => new Date(),
  raise: (user, input) => notifier.raiseBestEffort(user, input),
  update: (user, id, patch) => updateReminder(user, id, patch),
}

export const serializeReminder = (record: ReminderRecord, timezone: string, now: Date): Reminder => ({
  body: record.body,
  created_at: record.created_at.toISOString(),
  enabled: record.enabled,
  id: record.id,
  link: record.link,
  next_due_at: nextOccurrence(record, timezone, now)?.toISOString() ?? null,
  time_of_day: record.time_of_day,
  title: record.title,
  updated_at: record.updated_at.toISOString(),
  weekdays: record.weekdays,
})

export type RemindersView = Pick<RemindersResponse, 'next_due_at' | 'reminders' | 'timezone'>

export const listRemindersView = async (deps: ReminderDeps, user: string): Promise<RemindersView> => {
  const [records, timezone] = await Promise.all([deps.list(user), deps.getTimezone(user)])
  const now = deps.now()
  const reminders = records.map((record) => serializeReminder(record, timezone, now))
  const next = reminders
    .map((r) => r.next_due_at)
    .filter((at): at is string => at !== null)
    .sort()[0]
  return { next_due_at: next ?? null, reminders, timezone }
}

const blankToNull = (text: string | null | undefined): string | null =>
  text == null || text.trim() === '' ? null : text

const serializeNow = async (deps: ReminderDeps, user: string, record: ReminderRecord): Promise<Reminder> =>
  serializeReminder(record, await deps.getTimezone(user), deps.now())

export const addReminder = async (
  deps: ReminderDeps,
  user: string,
  body: AddReminderBody,
): Promise<Reminder> => {
  const record = await deps.insert(user, {
    body: blankToNull(body.body),
    enabled: body.enabled,
    link: blankToNull(body.link),
    not_before: deps.now(),
    time_of_day: body.time_of_day,
    title: body.title,
    weekdays: normalizeWeekdays(body.weekdays),
  })
  return serializeNow(deps, user, record)
}

const sameDays = (a: readonly number[], b: readonly number[]): boolean =>
  normalizeWeekdays(a).join(',') === normalizeWeekdays(b).join(',')

/** A schedule change, or switching back on, restarts the reminder from now. */
const restartsSchedule = (existing: ReminderRecord, body: UpdateReminderBody): boolean =>
  (body.time_of_day !== undefined && body.time_of_day !== existing.time_of_day) ||
  (body.weekdays !== undefined && !sameDays(body.weekdays, existing.weekdays)) ||
  (body.enabled === true && !existing.enabled)

/** Null when there is no such reminder. */
export const updateReminderById = async (
  deps: ReminderDeps,
  user: string,
  id: string,
  body: UpdateReminderBody,
): Promise<Reminder | null> => {
  if (!UUID_RE.test(id)) return null
  const existing = await deps.get(user, id)
  if (!existing) return null
  const patch: ReminderPatch = {}
  if (body.title !== undefined) patch.title = body.title
  if (body.body !== undefined) patch.body = blankToNull(body.body)
  if (body.link !== undefined) patch.link = blankToNull(body.link)
  if (body.time_of_day !== undefined) patch.time_of_day = body.time_of_day
  if (body.weekdays !== undefined) patch.weekdays = normalizeWeekdays(body.weekdays)
  if (body.enabled !== undefined) patch.enabled = body.enabled
  if (restartsSchedule(existing, body)) patch.not_before = deps.now()
  const record = await deps.update(user, id, patch)
  return record ? serializeNow(deps, user, record) : null
}

export const deleteReminderById = async (deps: ReminderDeps, user: string, id: string): Promise<boolean> =>
  UUID_RE.test(id) && deps.delete(user, id)

/** Raises every reminder occurrence due now. Resolves to how many were due. */
export const raiseDueReminders = async (deps: ReminderDeps, user: string): Promise<number> => {
  const [records, timezone] = await Promise.all([deps.list(user), deps.getTimezone(user)])
  const now = deps.now()
  let due = 0
  for (const record of records) {
    const occurrence = dueOccurrence(record, timezone, now)
    if (!occurrence) continue
    due++
    const dedupeKey = reminderDedupeKey(record.id, occurrence.date)
    await deps.markRead(user, record.id, dedupeKey)
    await deps.raise(user, {
      body: record.body ?? undefined,
      data: { occurrence_date: occurrence.date, reminder_id: record.id },
      dedupe_key: dedupeKey,
      link: record.link ?? undefined,
      title: record.title,
      type: 'reminder',
    })
  }
  return due
}
