/**
 * Timezone utilities for MCP timestamp handling.
 *
 * Uses Temporal API for DST-correct timezone conversion.
 */

/**
 * Format a UTC Date as an ISO 8601 string with the correct offset for the given timezone.
 * E.g. formatInTz(new Date('2024-01-15T14:30:00Z'), 'Europe/Stockholm') => '2024-01-15T15:30:00+01:00'
 */
export const formatInTz = (date: Date, tz: string): string => {
  const instant = Temporal.Instant.fromEpochMilliseconds(date.getTime())
  const zoned = instant.toZonedDateTimeISO(tz)
  return zoned.toString({ timeZoneName: 'never' })
}

/**
 * Convert a date-only string (YYYY-MM-DD) to a UTC Date range for the full day in the given timezone.
 * E.g. dateOnlyToRange('2024-01-15', 'Europe/Stockholm') =>
 *   { start: Date('2024-01-14T23:00:00Z'), end: Date('2024-01-15T22:59:59.999Z') }
 */
export const dateOnlyToRange = (dateStr: string, tz: string): { start: Date; end: Date } => {
  const localDate = Temporal.PlainDate.from(dateStr)
  const startOfDay = localDate.toZonedDateTime(tz)
  const startOfNextDay = localDate.add({ days: 1 }).toZonedDateTime(tz)
  return {
    end: new Date(startOfNextDay.epochMilliseconds - 1),
    start: new Date(startOfDay.epochMilliseconds),
  }
}

/** Fields that contain date-only values (YYYY-MM-DD) and should not be timezone-converted. */
const dateOnlyFields = new Set(['date', 'birth_date', 'sleep_date', 'start_date', 'reference_date'])

/**
 * Deep-transform ISO datetime strings in a JSON-serializable value to the user's timezone.
 * Converts strings matching ISO 8601 datetime format (with time component) to offset-aware format.
 * Skips date-only fields and non-datetime strings.
 */
export const convertTimestamps = (data: unknown, tz: string): unknown => {
  if (data === null || data === undefined) return data
  if (data instanceof Date) return formatInTz(data, tz)
  if (typeof data === 'string') {
    // Match ISO 8601 datetime strings (must have time component with T separator)
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(data)) {
      const d = new Date(data)
      if (!isNaN(d.getTime())) return formatInTz(d, tz)
    }
    return data
  }
  if (Array.isArray(data)) return data.map((item) => convertTimestamps(item, tz))
  if (typeof data === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      result[key] = dateOnlyFields.has(key) ? value : convertTimestamps(value, tz)
    }
    return result
  }
  return data
}
