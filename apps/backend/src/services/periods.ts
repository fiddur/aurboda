import { type PeriodGranularity, parsePeriodKey, shiftPeriodKey } from '@aurboda/api-spec'

export interface PeriodWindowBounds {
  end: Date
  start: Date
}

export type PeriodErrorCode = 'before_period_from' | 'granularity_mismatch' | 'invalid' | 'not_finished'

const periodErrorMessages: Record<PeriodErrorCode, string> = {
  before_period_from: 'Period is before the earliest period this dashboard shows',
  granularity_mismatch: "Period does not match the dashboard's granularity",
  invalid: 'Invalid period',
  not_finished: 'Period has not finished yet',
}

export class PeriodError extends Error {
  readonly code: PeriodErrorCode
  readonly status = 400

  constructor(code: PeriodErrorCode) {
    super(periodErrorMessages[code])
    this.code = code
    this.name = 'PeriodError'
  }
}

const startOf = (date: Temporal.PlainDate, tz: string): Date =>
  new Date(date.toZonedDateTime(tz).epochMilliseconds)

const mondayOfIsoWeek = (year: number, week: number): Temporal.PlainDate => {
  const jan4 = new Temporal.PlainDate(year, 1, 4)
  return jan4.subtract({ days: jan4.dayOfWeek - 1 }).add({ weeks: week - 1 })
}

/** The bounds of the calendar period `key` in `tz`; `end` is exclusive. */
export const periodWindow = (key: string, tz: string): PeriodWindowBounds => {
  const period = parsePeriodKey(key)
  if (!period) throw new PeriodError('invalid')
  switch (period.granularity) {
    case 'year': {
      const start = new Temporal.PlainDate(period.year, 1, 1)
      return { end: startOf(start.add({ years: 1 }), tz), start: startOf(start, tz) }
    }
    case 'month': {
      const start = new Temporal.PlainDate(period.year, period.month, 1)
      return { end: startOf(start.add({ months: 1 }), tz), start: startOf(start, tz) }
    }
    case 'week': {
      const start = mondayOfIsoWeek(period.year, period.week)
      return { end: startOf(start.add({ days: 7 }), tz), start: startOf(start, tz) }
    }
  }
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** The key of the period of `granularity` that contains `date` in `tz`. */
export const periodKeyOf = (date: Date, granularity: PeriodGranularity, tz: string): string => {
  const local = Temporal.Instant.fromEpochMilliseconds(date.getTime()).toZonedDateTimeISO(tz).toPlainDate()
  switch (granularity) {
    case 'year':
      return String(local.year)
    case 'month':
      return `${local.year}-${pad2(local.month)}`
    case 'week':
      return `${local.yearOfWeek ?? local.year}-W${pad2(local.weekOfYear ?? 1)}`
  }
}

export const latestFinishedPeriodKey = (granularity: PeriodGranularity, now: Date, tz: string): string =>
  shiftPeriodKey(periodKeyOf(now, granularity, tz), -1) as string

export const isFinishedPeriod = (key: string, now: Date, tz: string): boolean =>
  periodWindow(key, tz).end.getTime() <= now.getTime()

export const previousWindow = (key: string, tz: string): PeriodWindowBounds => {
  const previous = shiftPeriodKey(key, -1)
  if (!previous) throw new PeriodError('invalid')
  return periodWindow(previous, tz)
}

const DAY_MS = 86_400_000

/** Whole calendar days in a window; DST days count as one. */
export const periodDays = (window: PeriodWindowBounds): number =>
  Math.round((window.end.getTime() - window.start.getTime()) / DAY_MS)
