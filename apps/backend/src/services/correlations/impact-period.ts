/** A fixed analysis period for the impact query: `start` inclusive, `end` exclusive. */
export type ImpactPeriod = { ok: true; since?: Date; until?: Date } | { ok: false; error: string }

/** Both bounds or neither; with both, they must parse and `start` must come before `end`. */
export const parseImpactPeriod = (start?: string, end?: string): ImpactPeriod => {
  if (start == null && end == null) return { ok: true }
  if (start == null || end == null) return { error: 'Give both start and end, or neither.', ok: false }
  const since = new Date(start)
  const until = new Date(end)
  if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) {
    return { error: 'start and end must be ISO 8601 datetimes.', ok: false }
  }
  if (since.getTime() >= until.getTime()) return { error: 'start must be before end.', ok: false }
  return { ok: true, since, until }
}
