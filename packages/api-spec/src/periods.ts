import { type PeriodGranularity, periodKeyPattern } from './schemas/dashboard.ts'

export type ParsedPeriodKey =
  | { granularity: 'month'; month: number; year: number }
  | { granularity: 'week'; week: number; year: number }
  | { granularity: 'year'; year: number }

const isThursday = (year: number, month: number, day: number): boolean =>
  new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 4

/** ISO week-years have 53 weeks when 1 January or 31 December falls on a Thursday. */
export const isoWeeksInYear = (year: number): number =>
  isThursday(year, 1, 1) || isThursday(year, 12, 31) ? 53 : 52

const pad2 = (n: number): string => String(n).padStart(2, '0')

export const formatPeriodKey = (period: ParsedPeriodKey): string => {
  switch (period.granularity) {
    case 'month':
      return `${period.year}-${pad2(period.month)}`
    case 'week':
      return `${period.year}-W${pad2(period.week)}`
    case 'year':
      return String(period.year)
  }
}

export const parsePeriodKey = (key: string): ParsedPeriodKey | null => {
  if (!periodKeyPattern.test(key)) return null
  const year = Number(key.slice(0, 4))
  if (key.length === 4) return { granularity: 'year', year }
  if (key[5] === 'W') {
    const week = Number(key.slice(6))
    return week > isoWeeksInYear(year) ? null : { granularity: 'week', week, year }
  }
  return { granularity: 'month', month: Number(key.slice(5)), year }
}

export const periodGranularityOf = (key: string): PeriodGranularity | null =>
  parsePeriodKey(key)?.granularity ?? null

const shiftWeek = (year: number, week: number, n: number): { week: number; year: number } => {
  let y = year
  let w = week + n
  while (w < 1) {
    y -= 1
    w += isoWeeksInYear(y)
  }
  while (w > isoWeeksInYear(y)) {
    w -= isoWeeksInYear(y)
    y += 1
  }
  return { week: w, year: y }
}

/** The key n periods after (negative: before) `key`; null when `key` is not a period key. */
export const shiftPeriodKey = (key: string, n: number): string | null => {
  const period = parsePeriodKey(key)
  if (!period) return null
  switch (period.granularity) {
    case 'year':
      return formatPeriodKey({ ...period, year: period.year + n })
    case 'month': {
      const index = period.year * 12 + (period.month - 1) + n
      return formatPeriodKey({ granularity: 'month', month: (index % 12) + 1, year: Math.floor(index / 12) })
    }
    case 'week':
      return formatPeriodKey({ granularity: 'week', ...shiftWeek(period.year, period.week, n) })
  }
}

const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

/** `October 2026`, `Week 44, 2026` or `2026`; the key itself when it does not parse. */
export const periodLabel = (key: string): string => {
  const period = parsePeriodKey(key)
  if (!period) return key
  switch (period.granularity) {
    case 'month':
      return `${monthNames[period.month - 1]} ${period.year}`
    case 'week':
      return `Week ${period.week}, ${period.year}`
    case 'year':
      return String(period.year)
  }
}

/** Orders two keys of the same granularity: negative when `a` comes first. */
export const comparePeriodKeys = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Percent change from `previous` to `current`, one decimal; null without both figures or from zero. */
export const percentChange = (current: number | null, previous: number | null | undefined): number | null => {
  if (current === null || previous === null || previous === undefined || previous === 0) return null
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10
}
