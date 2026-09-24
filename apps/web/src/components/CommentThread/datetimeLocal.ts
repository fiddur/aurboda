import { format } from 'date-fns'

/**
 * `<input type="datetime-local">` speaks local wall-clock time with no zone,
 * while the API speaks ISO instants. These two helpers are the only conversion
 * between them, so the comment editor never hand-rolls a slice of an ISO string
 * (which would silently shift a comment by the UTC offset).
 */

/** ISO string or Date → the `yyyy-MM-ddTHH:mm` a datetime-local input wants. Empty for no/invalid value. */
export const toDatetimeLocal = (value: string | Date | undefined | null): string => {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return format(date, "yyyy-MM-dd'T'HH:mm")
}

/** A datetime-local input's value → a Date, or undefined when blank or unparseable. */
export const fromDatetimeLocal = (value: string): Date | undefined => {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}
