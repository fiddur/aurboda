import { addDays, addHours, addWeeks, startOfDay, startOfHour, startOfWeek } from 'date-fns'

export type BarBucketSize = '1h' | '1d' | '1w'

/** Nominal length, only for comparing against a bucket spacing — real windows vary with DST. */
export const BAR_BUCKET_NOMINAL_MS: Record<BarBucketSize, number> = {
  '1d': 86_400_000,
  '1h': 3_600_000,
  '1w': 7 * 86_400_000,
}

/** Start of the local calendar window containing `date`. Weeks start on Monday, like
 * Postgres `date_trunc('week')` on the backend. */
export const barWindowStart = (date: Date, size: BarBucketSize): Date => {
  if (size === '1h') return startOfHour(date)
  if (size === '1d') return startOfDay(date)
  return startOfWeek(date, { weekStartsOn: 1 })
}

/** The next window boundary after `windowStart`, so a day is 23 or 25 h across DST. */
export const nextBarWindowStart = (windowStart: Date, size: BarBucketSize): Date => {
  if (size === '1h') return addHours(windowStart, 1)
  if (size === '1d') return addDays(windowStart, 1)
  return addWeeks(windowStart, 1)
}

/** First window boundary at or after `date`. */
export const barWindowCeil = (date: Date, size: BarBucketSize): Date => {
  const start = barWindowStart(date, size)
  return start.getTime() === date.getTime() ? start : nextBarWindowStart(start, size)
}
