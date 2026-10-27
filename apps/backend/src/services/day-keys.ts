import { Temporal } from '@js-temporal/polyfill'

const dayKeyFormatters = new Map<string, Intl.DateTimeFormat>()

const dayKeyFormatter = (tz: string): Intl.DateTimeFormat => {
  let fmt = dayKeyFormatters.get(tz)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('sv-SE', {
      day: '2-digit',
      month: '2-digit',
      timeZone: tz,
      year: 'numeric',
    })
    dayKeyFormatters.set(tz, fmt)
  }
  return fmt
}

/** `YYYY-MM-DD` of `d` as a calendar day in `tz`. */
export const dayKey = (d: Date, tz: string): string => dayKeyFormatter(tz).format(d)

export const shiftDayKey = (key: string, days: number): string =>
  Temporal.PlainDate.from(key).add({ days }).toString()

/** Local midnight of the calendar day `key` in `tz`. */
export const dayStartInTz = (key: string, tz: string): Date =>
  new Date(Temporal.PlainDate.from(key).toZonedDateTime(tz).epochMilliseconds)

/** The last millisecond of the calendar day `key` in `tz`. */
export const dayEndInTz = (key: string, tz: string): Date =>
  new Date(dayStartInTz(shiftDayKey(key, 1), tz).getTime() - 1)

export const dayKeysEndingAt = (today: Date, count: number, tz: string): string[] => {
  const todayKey = dayKey(today, tz)
  return Array.from({ length: count }, (_, i) => shiftDayKey(todayKey, i - (count - 1)))
}
