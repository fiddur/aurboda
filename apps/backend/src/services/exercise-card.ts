import { activityMeasureLabels, type SharedExerciseData } from '@aurboda/api-spec'

import type { SharedExerciseRecord } from '../db/index.ts'

import { formatExerciseDate } from './activitypub/exercise-object.ts'
import { formatMeasureValue } from './feed-exercises.ts'
import { type ActivitySessionsOptions, queryActivitySessions } from './queries/activity-sessions.ts'

export interface OgExerciseDetails {
  activityTypeName: string
  headline?: { value: string; label: string; date: string }
  sessions?: string
  /** Trend values oldest → newest, at most `SPARKLINE_POINTS`; empty below two points. */
  sparkline: number[]
}

export const SPARKLINE_POINTS = 120

type Share = Pick<SharedExerciseRecord, 'activity_type' | 'field' | 'value'>

type SessionStartsQuery = (
  user: string,
  activityType: string,
  options: ActivitySessionsOptions,
) => Promise<{ sessions: { start_time: string }[] }>

const formatMonthYear = (iso: string, timeZone: string): string => {
  const date = new Date(iso)
  const options: Intl.DateTimeFormatOptions = { month: 'short', year: 'numeric' }
  try {
    return new Intl.DateTimeFormat('en-GB', { ...options, timeZone }).format(date)
  } catch {
    return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(date)
  }
}

/** Evenly spaced picks that always keep the first and the last value. */
export const downsample = (values: number[], max: number): number[] => {
  if (values.length <= max) return values
  return Array.from({ length: max }, (_, i) => values[Math.round((i * (values.length - 1)) / (max - 1))])
}

const headlineOf = (data: SharedExerciseData, timeZone: string): OgExerciseDetails['headline'] => {
  const record = data.records.find((r) => r.measure === data.trend?.measure) ?? data.records[0]
  if (!record) return undefined
  return {
    date: formatExerciseDate(record.start_time, timeZone),
    label: activityMeasureLabels[record.measure],
    value: formatMeasureValue(record.measure, record.value),
  }
}

const sessionsOf = (done: SharedExerciseData['done'], timeZone: string): string | undefined => {
  if (!done) return undefined
  return done.count === 1
    ? `1 session, ${formatExerciseDate(done.first, timeZone)}`
    : `${done.count} sessions since ${formatMonthYear(done.first, timeZone)}`
}

export const describeExercise = (
  data: SharedExerciseData,
  activityTypeName: string,
  timeZone: string,
): OgExerciseDetails => {
  const history = data.trend?.history ?? []
  return {
    activityTypeName,
    headline: headlineOf(data, timeZone),
    sessions: sessionsOf(data.done, timeZone),
    sparkline:
      history.length < 2
        ? []
        : downsample(
            history.map((p) => p.value),
            SPARKLINE_POINTS,
          ),
  }
}

/** The start of the newest session with the shared value, without running the trend and chart queries. */
export const latestExerciseSession = async (
  user: string,
  share: Share,
  query: SessionStartsQuery = queryActivitySessions,
): Promise<string | null> => {
  const { sessions } = await query(user, share.activity_type, {
    filter: { field: share.field, value: share.value },
  })
  return sessions.reduce<string | null>(
    (latest, s) => (latest === null || s.start_time > latest ? s.start_time : latest),
    null,
  )
}
