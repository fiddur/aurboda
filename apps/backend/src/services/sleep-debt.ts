import {
  defaultSleepNeedMinutes,
  type SleepDebt,
  type SleepDebtDay,
  type SleepDebtQuery,
  type SleepDebtSeverity,
} from '@aurboda/api-spec'

import type { MergedActivity } from '../db/types.ts'

import { expandActivityTypes, fetchCategoryMap, getActivities } from '../db/index.ts'
import { dateOnlyToRange } from '../mcp/tz-utils.ts'
import { getSettings, getUserTimezone } from './settings.ts'
import { computeSleepMinutes } from './sleep-duration.ts'

export const DEBT_DECAY = 0.85
export const NAP_MIN_MINUTES = 20
export const NAP_CREDIT = 0.5
export const WARMUP_DAYS = 28
export const MAX_RANGE_DAYS = 366
const DEFAULT_RANGE_DAYS = 14

export interface CountedSleep {
  /** Local date of the wake-up. */
  date: string
  kind: 'nap' | 'night'
  minutes: number
}

export const classifyDebt = (debtMinutes: number, needMinutes: number): SleepDebtSeverity => {
  const ratio = debtMinutes / needMinutes
  if (ratio < 0.1) return 'none'
  if (ratio < 0.5) return 'mild'
  if (ratio < 1) return 'moderate'
  return 'severe'
}

/** Credited minutes per date that has a night: the nights in full, naps over 20 minutes at half. */
export const creditByDate = (sleeps: CountedSleep[]): Map<string, number> => {
  const credit = new Map<string, number>()
  for (const s of sleeps) {
    if (s.kind === 'night' && s.minutes > 0) credit.set(s.date, (credit.get(s.date) ?? 0) + s.minutes)
  }
  for (const s of sleeps) {
    if (s.kind === 'nap' && s.minutes > NAP_MIN_MINUTES && credit.has(s.date)) {
      credit.set(s.date, credit.get(s.date)! + s.minutes * NAP_CREDIT)
    }
  }
  return credit
}

/**
 * One entry per date, starting from no debt: debt = max(0, debt × 0.85 + need − slept). A date
 * without a night only decays the debt, so a night the tracker missed is not read as no sleep;
 * `today` without a night carries the debt unchanged, since its night may not have synced yet.
 */
export const sleepDebtSeries = (
  dates: string[],
  sleeps: CountedSleep[],
  needMinutes: number,
  today?: string,
): SleepDebtDay[] => {
  const credit = creditByDate(sleeps)
  let debt = 0
  return dates.map((date) => {
    const slept = credit.get(date)
    if (slept !== undefined) debt = Math.max(0, debt * DEBT_DECAY + needMinutes - slept)
    else if (date !== today) debt *= DEBT_DECAY
    return {
      date,
      debt_minutes: Math.round(debt),
      severity: classifyDebt(debt, needMinutes),
      slept_minutes: slept === undefined ? null : Math.round(slept),
    }
  })
}

export const localDate = (instant: Date, tz: string): string =>
  Temporal.Instant.fromEpochMilliseconds(instant.getTime()).toZonedDateTimeISO(tz).toPlainDate().toString()

export const addDays = (date: string, days: number): string =>
  Temporal.PlainDate.from(date).add({ days }).toString()

export const datesBetween = (start: string, end: string): string[] => {
  const dates: string[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) dates.push(d)
  return dates
}

/** The minutes the Sleep page shows for a session: asleep time when known, else time in bed. */
export const sessionSleepMinutes = (activity: MergedActivity & { end_time: Date }): number =>
  computeSleepMinutes(activity.data) ??
  Math.round((activity.end_time.getTime() - activity.start_time.getTime()) / 60000)

export const toCountedSleeps = (
  activities: MergedActivity[],
  napTypes: ReadonlySet<string>,
  tz: string,
): CountedSleep[] =>
  activities.flatMap((a) => {
    if (!a.end_time) return []
    const kind = a.activity_type === 'sleep' ? 'night' : napTypes.has(a.activity_type) ? 'nap' : undefined
    if (!kind) return []
    return [
      { date: localDate(a.end_time, tz), kind, minutes: sessionSleepMinutes({ ...a, end_time: a.end_time }) },
    ]
  })

export interface SleepDebtRange {
  end: string
  start: string
}

/** The asked range with its defaults: end today, start two weeks back. */
export const resolveSleepDebtRange = (
  query: Pick<SleepDebtQuery, 'end' | 'start'>,
  today: string,
): SleepDebtRange | { error: string } => {
  const end = query.end ?? today
  const start = query.start ?? addDays(end, 1 - DEFAULT_RANGE_DAYS)
  if (start > end) return { error: 'start must not be after end' }
  if (datesBetween(start, end).length > MAX_RANGE_DAYS) {
    return { error: `The range can span at most ${MAX_RANGE_DAYS} days` }
  }
  return { end, start }
}

export interface SleepDebtDeps {
  /** Sleep and nap sessions starting inside the window, merged across sources as the Sleep page shows them. */
  getSleepActivities: (user: string, napTypes: string[], start: Date, end: Date) => Promise<MergedActivity[]>
  getNapTypes: (user: string) => Promise<string[]>
  getSleepNeed: (user: string) => Promise<number>
  getTimezone: (user: string) => Promise<string>
  now: () => Date
}

const defaultDeps: SleepDebtDeps = {
  getNapTypes: (user) => expandActivityTypes(user, ['nap']),
  getSleepNeed: async (user) => (await getSettings(user)).sleep_need_minutes ?? defaultSleepNeedMinutes,
  getSleepActivities: async (user, napTypes, start, end) =>
    getActivities(
      user,
      ['sleep', ...napTypes],
      start,
      end,
      undefined,
      undefined,
      await fetchCategoryMap(user),
    ),
  getTimezone: getUserTimezone,
  now: () => new Date(),
}

type SleepDebtResult = SleepDebt & { has_sleep_data: boolean }

const computeSleepDebt = async (
  user: string,
  range: SleepDebtRange,
  tz: string,
  deps: SleepDebtDeps,
): Promise<SleepDebtResult> => {
  const first = addDays(range.start, -WARMUP_DAYS)
  const [napTypes, need] = await Promise.all([deps.getNapTypes(user), deps.getSleepNeed(user)])
  const sessions = await deps.getSleepActivities(
    user,
    napTypes,
    dateOnlyToRange(addDays(first, -1), tz).start,
    dateOnlyToRange(range.end, tz).end,
  )
  const all = sleepDebtSeries(
    datesBetween(first, range.end),
    toCountedSleeps(sessions, new Set(napTypes), tz),
    need,
    localDate(deps.now(), tz),
  )
  const days = all.filter((d) => d.date >= range.start)
  const last = days.at(-1)
  return {
    days,
    debt_minutes: last?.debt_minutes ?? 0,
    has_sleep_data: all.some((d) => d.slept_minutes !== null),
    severity: last?.severity ?? 'none',
    sleep_need_minutes: need,
  }
}

/** Sleep debt per date over the asked range, or the error that makes the range unusable. */
export const getSleepDebt = async (
  user: string,
  query: SleepDebtQuery = {},
  deps: SleepDebtDeps = defaultDeps,
): Promise<SleepDebt | { error: string }> => {
  const tz = query.tz ?? (await deps.getTimezone(user))
  const range = resolveSleepDebtRange(query, localDate(deps.now(), tz))
  if ('error' in range) return range
  const { has_sleep_data: _, ...debt } = await computeSleepDebt(user, range, tz, deps)
  return debt
}

/** The debt after the night ending on `date`; null when no night was recorded in the four weeks up to it. */
export const getSleepDebtForDate = async (
  user: string,
  date: string,
  tz?: string,
  deps: SleepDebtDeps = defaultDeps,
): Promise<SleepDebtDay | null> => {
  const zone = tz ?? (await deps.getTimezone(user))
  const result = await computeSleepDebt(user, { end: date, start: date }, zone, deps)
  return result.has_sleep_data ? (result.days[0] ?? null) : null
}

/** The current debt for the dashboard widget: the last two weeks up to today. */
export const getCurrentSleepDebt = async (
  user: string,
  deps: SleepDebtDeps = defaultDeps,
): Promise<SleepDebt | null> => {
  const tz = await deps.getTimezone(user)
  const range = resolveSleepDebtRange({}, localDate(deps.now(), tz))
  if ('error' in range) return null
  const { has_sleep_data, ...debt } = await computeSleepDebt(user, range, tz, deps)
  return has_sleep_data ? debt : null
}
