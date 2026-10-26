import { type ActivityMeasure, type ActivitySession, recordMeasures } from '@aurboda/api-spec'

import { measureSet } from '../../utils/measures'

export interface ItemRecord {
  measure: ActivityMeasure
  value: number
  session_id: string
  start_time: string
  /** The set the value came from. */
  set?: Record<string, unknown>
}

const oldestFirst = (sessions: ActivitySession[]): ActivitySession[] =>
  sessions.toSorted((a, b) => a.start_time.localeCompare(b.start_time))

/** The best value of each record measure, with the first session that reached it. */
export const recordsFrom = (sessions: ActivitySession[]): ItemRecord[] => {
  const ordered = oldestFirst(sessions)
  return recordMeasures.flatMap((measure) => {
    let best: ActivitySession | undefined
    for (const s of ordered) {
      const v = s.measures?.[measure]
      if (v !== undefined && (best === undefined || v > (best.measures?.[measure] ?? -Infinity))) best = s
    }
    const value = best?.measures?.[measure]
    if (best === undefined || value === undefined) return []
    const set = measureSet(best.items ?? [], measure)
    return [{ measure, session_id: best.id, start_time: best.start_time, value, ...(set && { set }) }]
  })
}

export const doneSummary = (
  sessions: ActivitySession[],
): { count: number; first: string; last: string } | undefined => {
  const ordered = oldestFirst(sessions)
  const first = ordered[0]
  const last = ordered.at(-1)
  return first && last ? { count: ordered.length, first: first.start_time, last: last.start_time } : undefined
}

/** One point per session that has the measure, oldest first. */
export const trendPoints = (
  sessions: ActivitySession[],
  measure: ActivityMeasure,
): { date: string; value: number }[] =>
  oldestFirst(sessions).flatMap((s) => {
    const value = s.measures?.[measure]
    return value === undefined ? [] : [{ date: s.start_time, value }]
  })

/** The sessions of the last `days` days; 0 keeps them all. */
export const sliceByLookback = (
  sessions: ActivitySession[],
  days: number,
  now: number = Date.now(),
): ActivitySession[] => {
  if (days <= 0) return sessions
  const from = now - days * 86_400_000
  return sessions.filter((s) => new Date(s.start_time).getTime() >= from)
}
