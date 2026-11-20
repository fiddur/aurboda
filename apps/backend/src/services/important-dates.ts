import type { ImportantDate, PersonDateKind } from '@aurboda/api-spec'

/** A person's yearly date, or their birthday (`date_id` null), as the occurrences are built from. */
export interface DatedEntry {
  person: { id: string; name: string }
  date_id: string | null
  label: string
  kind: PersonDateKind
  month: number
  day: number
  year: number | null
  notify_days_before: number | null
}

export interface DueImportantDate {
  entry: DatedEntry
  /** The occurrence (YYYY-MM-DD). */
  date: string
  days_until: number
  years?: number
}

/** The local hour from which a notification due on a day is raised. */
export const IMPORTANT_DATE_NOTIFY_HOUR = 8

export const birthdayLabel = (name: string): string => `${name}'s birthday`

const isLeapYear = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0

/** The day it falls on in `year`: 29 February is 28 February in a year without one. */
export const occurrenceIn = (year: number, month: number, day: number): Temporal.PlainDate =>
  Temporal.PlainDate.from({ day: month === 2 && day === 29 && !isLeapYear(year) ? 28 : day, month, year })

const yearsOn = (entry: DatedEntry, year: number): number | undefined => {
  if (entry.year === null) return undefined
  const years = year - entry.year
  return years > 0 ? years : undefined
}

const compareOccurrences = (a: ImportantDate, b: ImportantDate): number =>
  a.date.localeCompare(b.date) ||
  a.person.name.localeCompare(b.person.name) ||
  a.label.localeCompare(b.label) ||
  (a.date_id ?? '').localeCompare(b.date_id ?? '')

/** Every occurrence of the entries in [from, to] (YYYY-MM-DD), by date. */
export const importantDateOccurrences = (
  entries: DatedEntry[],
  from: string,
  to: string,
): ImportantDate[] => {
  const start = Temporal.PlainDate.from(from)
  const end = Temporal.PlainDate.from(to)
  const out: ImportantDate[] = []
  for (const entry of entries) {
    for (let year = start.year; year <= end.year; year++) {
      const date = occurrenceIn(year, entry.month, entry.day)
      if (Temporal.PlainDate.compare(date, start) < 0 || Temporal.PlainDate.compare(date, end) > 0) continue
      const years = yearsOn(entry, year)
      out.push({
        date: date.toString(),
        date_id: entry.date_id,
        kind: entry.kind,
        label: entry.label,
        person: entry.person,
        ...(years === undefined ? {} : { years }),
      })
    }
  }
  return out.sort(compareOccurrences)
}

/**
 * The entries whose notification is due at `now`: today (in `timezone`) is `notify_days_before`
 * days before an occurrence, and it is at least 08:00 local.
 */
export const dueImportantDates = (entries: DatedEntry[], timezone: string, now: Date): DueImportantDate[] => {
  const local = Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(timezone)
  if (local.hour < IMPORTANT_DATE_NOTIFY_HOUR) return []
  const today = local.toPlainDate()
  const out: DueImportantDate[] = []
  for (const entry of entries) {
    if (entry.notify_days_before === null) continue
    const target = today.add({ days: entry.notify_days_before })
    const date = occurrenceIn(target.year, entry.month, entry.day)
    if (!date.equals(target)) continue
    const years = yearsOn(entry, date.year)
    out.push({
      date: date.toString(),
      days_until: entry.notify_days_before,
      entry,
      ...(years === undefined ? {} : { years }),
    })
  }
  return out
}

const whenText = (days: number): string =>
  days === 0 ? 'is today' : days === 1 ? 'is tomorrow' : `is in ${days} days`

export const importantDateTitle = (due: DueImportantDate): string => {
  const { entry } = due
  const subject =
    entry.date_id === null ? birthdayLabel(entry.person.name) : `${entry.person.name}: ${entry.label}`
  const count =
    due.years === undefined ? '' : entry.date_id === null ? ` (turns ${due.years})` : ` (${due.years} years)`
  return `${subject} ${whenText(due.days_until)}${count}`
}

export const importantDateDedupeKey = (entry: DatedEntry, date: string): string =>
  `important_date:${entry.date_id ?? `birthday:${entry.person.id}`}:${date}`
