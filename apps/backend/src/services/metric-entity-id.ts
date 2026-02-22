/**
 * Helpers for constructing and parsing composite entity_ids for metric data points.
 *
 * Metrics use a composite primary key (time, metric, source) instead of a UUID.
 * These helpers encode/decode that key as a pipe-delimited string for use in
 * the notes system.
 */

/**
 * Construct a metric entity_id from its composite key parts.
 * Format: `<iso_time>|<metric>|<source>`
 */
export const toMetricEntityId = (time: Date, metric: string, source: string): string =>
  `${time.toISOString()}|${metric}|${source}`

/**
 * Parse a metric entity_id back into its composite key parts.
 * Returns null if the format is invalid.
 */
export const parseMetricEntityId = (
  entityId: string,
): { time: Date; metric: string; source: string } | null => {
  const parts = entityId.split('|')
  if (parts.length !== 3) return null

  const [timeStr, metric, source] = parts
  const time = new Date(timeStr)
  if (isNaN(time.getTime()) || !metric || !source) return null

  return { metric, source, time }
}
