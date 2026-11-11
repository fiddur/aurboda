import { chartSinceMin } from '@aurboda/api-spec'

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 24 * 60 * 60 * 1000

const pad = (n: number): string => String(n).padStart(2, '0')

export const localDateKey = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

const dateKeyParts = (value: string): [number, number, number] | undefined => {
  const match = DATE_KEY.exec(value)
  if (!match) return undefined
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? [year, month, day]
    : undefined
}

/** A `since` query value as a real `YYYY-MM-DD` calendar date from `chartSinceMin` on, or undefined. */
export const parseSince = (value: string | undefined): string | undefined =>
  value && value >= chartSinceMin && dateKeyParts(value) ? value : undefined

export const validateSince = (value: string, now: Date): { since: string } | { error: string } => {
  const since = parseSince(value)
  if (!since) return { error: 'Pick a date.' }
  return since > localDateKey(now) ? { error: 'The date is in the future.' } : { since }
}

/**
 * Whole calendar days from `since` to today, at least one: the trend covers days on or after
 * today minus this many. Counted on UTC dates built from local parts so a DST change is no partial day.
 */
export const sinceToLookbackDays = (since: string, now: Date): number => {
  const [year, month, day] = since.split('-').map(Number)
  const days =
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(year, month - 1, day)) / DAY_MS
  return Math.max(1, Math.round(days))
}

export const sinceForLookback = (lookbackDays: number, now: Date): string =>
  localDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - lookbackDays))

/** Start/end ISO strings from lookback_days, rounded to day boundaries for stable query keys. */
export const lookbackToRange = (lookbackDays: number, now: Date): { end: string; start: string } => {
  const end = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59))
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - lookbackDays)
  start.setUTCHours(0, 0, 0, 0)
  return { end: end.toISOString(), start: start.toISOString() }
}

export const sinceStart = (since: string): string => {
  const [year, month, day] = since.split('-').map(Number)
  return new Date(year, month - 1, day).toISOString()
}

/** The chart's range: a `since` date, when set, wins over `lookback_days`. */
export const chartRange = (
  range: { lookback_days: number; since: string },
  now: Date,
): { end: string; lookback_days: number; start: string } => {
  const { end, start } = lookbackToRange(range.lookback_days, now)
  return range.since
    ? { end, lookback_days: sinceToLookbackDays(range.since, now), start: sinceStart(range.since) }
    : { end, lookback_days: range.lookback_days, start }
}

/** A stored `since` can be later than today (saved through the API); it then starts today. */
const clampSince = (since: string, now: Date): string => {
  const today = localDateKey(now)
  return since > today ? today : since
}

/** A dashboard chart's trend lookback: days since its fixed `since` date when set, else its `lookback_days`. */
export const widgetLookbackDays = (lookbackDays: number, since: string | undefined, now: Date): number =>
  since ? sinceToLookbackDays(clampSince(since, now), now) : lookbackDays

/** A dashboard chart's range ending now: from its `since` date's local midnight when set, else `lookbackDays` back. */
export const widgetRange = (
  lookbackDays: number,
  since: string | undefined,
  now: Date,
): { end: string; start: string } => {
  if (since) return { end: now.toISOString(), start: sinceStart(clampSince(since, now)) }
  const start = new Date(now)
  start.setDate(start.getDate() - lookbackDays)
  return { end: now.toISOString(), start: start.toISOString() }
}
