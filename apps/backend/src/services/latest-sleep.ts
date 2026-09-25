import type { LatestSleep, SleepStageMinutes, SleepStageSegment } from '@aurboda/api-spec'

import type { MergedActivity, MetricStats } from '../db/types.ts'
import type { MetricType } from '../schema.ts'

import { getSleepSessions, getTimeSeriesMultiMetric, getTimeSeriesStats } from '../db/index.ts'
import { getSettings } from './settings.ts'
import { computeSleepMinutes } from './sleep-duration.ts'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
export const LATEST_SLEEP_LOOKBACK_MS = 36 * HOUR_MS
const BASELINE_DAYS = 30

const NIGHT_METRICS: MetricType[] = ['sleep_score', 'resting_heart_rate', 'hrv_rmssd', 'body_battery']

type Series = Partial<Record<string, [Date, number][]>>

export interface TimeRange {
  start: Date
  end: Date
}

/** Newest sleep whose wake-up falls within the lookback before `now`. */
type EndedSleep = MergedActivity & { id: string; end_time: Date }

export const pickLatestSleep = (sessions: MergedActivity[], now: Date): EndedSleep | undefined => {
  const from = now.getTime() - LATEST_SLEEP_LOOKBACK_MS
  return sessions
    .filter(
      (s): s is EndedSleep =>
        !!s.id && !!s.end_time && s.end_time.getTime() >= from && s.end_time.getTime() <= now.getTime(),
    )
    .toSorted((a, b) => b.end_time.getTime() - a.end_time.getTime())[0]
}

export const parseStageSegments = (data: Record<string, unknown> | undefined): SleepStageSegment[] => {
  const stages = data?.stages
  if (!Array.isArray(stages)) return []
  return stages
    .flatMap((s: unknown) => {
      if (typeof s !== 'object' || s === null) return []
      const { endTime, stage, startTime } = s as Record<string, unknown>
      if (typeof startTime !== 'string' || typeof endTime !== 'string') return []
      if (typeof stage !== 'number' || !Number.isInteger(stage) || stage < 1 || stage > 6) return []
      const start = new Date(startTime)
      const end = new Date(endTime)
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return []
      return [{ end_time: end.toISOString(), stage, start_time: start.toISOString() }]
    })
    .toSorted((a, b) => a.start_time.localeCompare(b.start_time))
}

const segmentMinutes = (s: SleepStageSegment): number =>
  (new Date(s.end_time).getTime() - new Date(s.start_time).getTime()) / 60000

const numberField = (data: Record<string, unknown> | undefined, key: string): number | undefined => {
  const v = data?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** Per-stage minutes from the stage timeline, else from the per-stage second totals Garmin reports. */
export const computeStageMinutes = (
  stages: SleepStageSegment[],
  data: Record<string, unknown> | undefined,
): SleepStageMinutes | undefined => {
  if (stages.length > 0) {
    const sum = (stage: number) =>
      Math.round(stages.filter((s) => s.stage === stage).reduce((acc, s) => acc + segmentMinutes(s), 0))
    return { awake: sum(1), deep: sum(5), light: sum(4), rem: sum(6) }
  }
  const secs = {
    awake: numberField(data, 'awake_seconds'),
    deep: numberField(data, 'deep_sleep_seconds'),
    light: numberField(data, 'light_sleep_seconds'),
    rem: numberField(data, 'rem_sleep_seconds'),
  }
  if (Object.values(secs).every((v) => v === undefined)) return undefined
  const toMin = (v: number | undefined) => Math.round((v ?? 0) / 60)
  return { awake: toMin(secs.awake), deep: toMin(secs.deep), light: toMin(secs.light), rem: toMin(secs.rem) }
}

/** Minutes asleep: from stages (or Oura's total), else deep + light + REM. */
export const computeTotalSleepMinutes = (
  data: Record<string, unknown> | undefined,
  stageMinutes: SleepStageMinutes | undefined,
): number | undefined => {
  const fromData = computeSleepMinutes(data)
  if (fromData !== undefined) return fromData
  if (!stageMinutes) return undefined
  const total = stageMinutes.deep + stageMinutes.light + stageMinutes.rem
  return total > 0 ? total : undefined
}

/**
 * The UTC-midnight-bounded calendar day of the wake-up in the user's timezone.
 * Daily values (Garmin's resting HR, overnight HRV and sleep score, Oura's
 * sleep score) are stored on that calendar date, not at the wake-up instant.
 */
export const wakeDayRange = (end: Date, tz: string | undefined): TimeRange => {
  const localDate = (timeZone: string) =>
    new Intl.DateTimeFormat('en-CA', { day: '2-digit', month: '2-digit', timeZone, year: 'numeric' }).format(
      end,
    )
  let date: string
  try {
    date = localDate(tz ?? 'UTC')
  } catch {
    date = localDate('UTC')
  }
  const start = new Date(`${date}T00:00:00.000Z`)
  return { end: new Date(start.getTime() + DAY_MS - 1), start }
}

const inRange = (points: [Date, number][] | undefined, range: TimeRange): [Date, number][] =>
  (points ?? []).filter(([t]) => t >= range.start && t <= range.end)

const lastValue = (points: [Date, number][]): number | undefined => points.at(-1)?.[1]

const round = (v: number, decimals: number): number => {
  const f = 10 ** decimals
  return Math.round(v * f) / f
}

const baselineAvg = (stats: MetricStats[], metric: string): number | undefined => {
  const s = stats.find((m) => m.metric === metric)
  return s && s.count > 0 ? round(s.avg, 1) : undefined
}

export interface LatestSleepInputs {
  /** Series for NIGHT_METRICS covering both the sleep window and the wake day. */
  series: Series
  /** Stats over the baseline window before the night. */
  baseline: MetricStats[]
  wakeDay: TimeRange
}

export const buildLatestSleep = (
  activity: EndedSleep,
  { baseline, series, wakeDay }: LatestSleepInputs,
): LatestSleep => {
  const night = { end: activity.end_time, start: activity.start_time }
  const stages = parseStageSegments(activity.data)
  const stageMinutes = computeStageMinutes(stages, activity.data)

  const nightHrv = inRange(series.hrv_rmssd, night)
  const hrv =
    nightHrv.length > 0
      ? Math.round(nightHrv.reduce((acc, [, v]) => acc + v, 0) / nightHrv.length)
      : lastValue(inRange(series.hrv_rmssd, wakeDay))
  const bodyBattery = inRange(series.body_battery, night)

  return {
    activity_id: activity.id,
    body_battery_end: lastValue(bodyBattery),
    body_battery_start: bodyBattery[0]?.[1],
    end_time: activity.end_time.toISOString(),
    hrv,
    hrv_baseline: baselineAvg(baseline, 'hrv_rmssd'),
    resting_hr: lastValue(inRange(series.resting_heart_rate, wakeDay)),
    resting_hr_baseline: baselineAvg(baseline, 'resting_heart_rate'),
    sleep_score: numberField(activity.data, 'sleep_score') ?? lastValue(inRange(series.sleep_score, wakeDay)),
    stage_minutes: stageMinutes,
    stages,
    start_time: activity.start_time.toISOString(),
    time_in_bed_min: Math.round((activity.end_time.getTime() - activity.start_time.getTime()) / 60000),
    total_sleep_min: computeTotalSleepMinutes(activity.data, stageMinutes),
  }
}

export interface LatestSleepDeps {
  getSleepSessions: (user: string, start: Date, end: Date) => Promise<MergedActivity[]>
  getTimeSeriesMultiMetric: (user: string, metrics: MetricType[], start: Date, end: Date) => Promise<Series>
  getTimeSeriesStats: (user: string, metrics: string[], start: Date, end: Date) => Promise<MetricStats[]>
  getTimezone: (user: string) => Promise<string | undefined>
}

const defaultDeps: LatestSleepDeps = {
  getSleepSessions: (...args) => getSleepSessions(...args),
  getTimeSeriesMultiMetric: (...args) => getTimeSeriesMultiMetric(...args),
  getTimeSeriesStats: (...args) => getTimeSeriesStats(...args),
  getTimezone: async (user) => (await getSettings(user)).device_timezone,
}

/** The most recent sleep that ended within the last 36 hours, or null. */
export const getLatestSleep = async (
  user: string,
  now: Date = new Date(),
  deps: LatestSleepDeps = defaultDeps,
): Promise<LatestSleep | null> => {
  const sessions = await deps.getSleepSessions(user, new Date(now.getTime() - LATEST_SLEEP_LOOKBACK_MS), now)
  const activity = pickLatestSleep(sessions, now)
  if (!activity) return null

  const wakeDay = wakeDayRange(activity.end_time, await deps.getTimezone(user))
  const seriesStart = new Date(Math.min(activity.start_time.getTime(), wakeDay.start.getTime()))
  const seriesEnd = new Date(Math.max(activity.end_time.getTime(), wakeDay.end.getTime()))
  const baselineStart = new Date(activity.start_time.getTime() - BASELINE_DAYS * DAY_MS)

  const [series, baseline] = await Promise.all([
    deps.getTimeSeriesMultiMetric(user, NIGHT_METRICS, seriesStart, seriesEnd),
    deps.getTimeSeriesStats(user, ['resting_heart_rate', 'hrv_rmssd'], baselineStart, activity.start_time),
  ])

  return buildLatestSleep(activity, { baseline, series, wakeDay })
}
