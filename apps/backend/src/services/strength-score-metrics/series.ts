import { strengthScoreGroups, strengthScoreMetricOf } from '@aurboda/api-spec'

import type { TimeSeriesPoint } from '../../db/types.ts'
import type { StrengthReferences } from '../strength-references.ts'

import { dayEndInTz, dayKey, shiftDayKey } from '../day-keys.ts'
import {
  missingOf,
  type ScoredSet,
  type StrengthScoreSubject,
  strengthScorePoints,
} from '../strength-score.ts'

export interface ScoreDay {
  /** The moment scored: the end of the local day, or now for today */
  at: Date
  key: string
  /** The stored row's time: local noon, or now floored to the minute for today before noon */
  time: Date
}

const localNoon = (key: string, tz: string): Date =>
  new Date(
    Temporal.PlainDate.from(key).toZonedDateTime({ plainTime: '12:00', timeZone: tz }).epochMilliseconds,
  )

const floorToMinute = (d: Date): Date => new Date(Math.floor(d.getTime() / 60_000) * 60_000)

/** Every local day from the one of `firstSetStart` through today. */
export const scoreDays = (firstSetStart: Date, now: Date, tz: string): ScoreDay[] => {
  const today = dayKey(now, tz)
  const days: ScoreDay[] = []
  for (let key = dayKey(firstSetStart, tz); key <= today; key = shiftDayKey(key, 1)) {
    const noon = localNoon(key, tz)
    days.push(
      key === today
        ? { at: now, key, time: noon.getTime() <= now.getTime() ? noon : floorToMinute(now) }
        : { at: dayEndInTz(key, tz), key, time: noon },
    )
  }
  return days
}

/** One point per local day for the overall score and each group that has a score that day. */
export const dailyScorePoints = (
  sets: ScoredSet[],
  references: StrengthReferences,
  subject: StrengthScoreSubject,
  now: Date,
  tz: string,
): TimeSeriesPoint[] => {
  if (missingOf(subject).length > 0 || sets.length === 0) return []
  const first = new Date(sets.reduce((min, s) => Math.min(min, s.start_time.getTime()), Infinity))
  const days = scoreDays(first, now, tz)
  const scores = strengthScorePoints(
    sets,
    references,
    subject,
    days.map((d) => d.at),
  )
  const point = (metric: string, time: Date, value: number): TimeSeriesPoint => ({
    metric,
    source: 'aurboda',
    time,
    unit: 'points',
    value,
  })
  return days.flatMap(({ time }, i) => {
    const score = scores[i]
    if (!score) return []
    return [
      ...(score.score === null ? [] : [point(strengthScoreMetricOf(), time, score.score)]),
      ...strengthScoreGroups.flatMap((group) => {
        const value = score.groups[group]
        return value === undefined ? [] : [point(strengthScoreMetricOf(group), time, value)]
      }),
    ]
  })
}
