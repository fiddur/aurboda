/**
 * Date-range helpers for the challenge create form. Challenge windows are
 * `[start_ts, end_ts)` — start at the first day's local midnight, end at the
 * local midnight *after* the last day. Quick-span helpers use calendar
 * arithmetic (setDate / month construction) rather than millisecond math so
 * they're DST-safe.
 */

/** A YYYY-MM-DD date input value (local calendar day). */
export const toDateInput = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Local YYYY-MM-DD → UTC ISO instant at that day's local midnight (inclusive start). */
export const dateToStartIso = (date: string): string => new Date(`${date}T00:00:00`).toISOString()

/** Local YYYY-MM-DD → UTC ISO instant at the local midnight AFTER that day (exclusive end). */
export const dateToEndIso = (date: string): string => {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + 1)
  return d.toISOString()
}

export const browserTz = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone

export interface DateRange {
  start: string
  end: string
}

/** `from` through 6 days later — a one-week default range. */
export const defaultWeekRange = (from: Date = new Date()): DateRange => {
  const end = new Date(from)
  end.setDate(end.getDate() + 6)
  return { end: toDateInput(end), start: toDateInput(from) }
}

/** The Monday–Sunday week containing `from`. */
export const thisWeekRange = (from: Date = new Date()): DateRange => {
  const monday = new Date(from)
  monday.setDate(from.getDate() - ((from.getDay() + 6) % 7))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return { end: toDateInput(sunday), start: toDateInput(monday) }
}

/** The full calendar month containing `from`. */
export const thisMonthRange = (from: Date = new Date()): DateRange => ({
  end: toDateInput(new Date(from.getFullYear(), from.getMonth() + 1, 0)),
  start: toDateInput(new Date(from.getFullYear(), from.getMonth(), 1)),
})
