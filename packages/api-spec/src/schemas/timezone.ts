import { z } from 'zod'

/** True when `Intl` can format in `tz` — the check every downstream consumer relies on. */
export const isKnownTimezone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export const ianaTimezoneSchema = z
  .string()
  .refine(isKnownTimezone, { message: 'tz must be a valid IANA timezone' })
  .meta({
    description: 'IANA timezone name (e.g. "Europe/Stockholm", "UTC")',
    example: 'Europe/Stockholm',
    id: 'IanaTimezone',
  })
