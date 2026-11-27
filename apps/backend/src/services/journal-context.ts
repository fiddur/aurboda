import {
  type CustomMetricDefinition,
  getMetricAggregation,
  type JournalContext,
  type JournalContextItem,
  type JournalContextValue,
} from '@aurboda/api-spec'

import {
  getDailyAggregates,
  getDaysSinceActivity,
  getLatestMetricSampleTimeBefore,
  getUserSettings,
} from '../db/index.ts'
import { getCustomMetrics } from './custom-metrics.ts'
import { dayEndInTz, dayKey, dayStartInTz, shiftDayKey } from './day-keys.ts'
import { moonPhase } from './moon.ts'
import { getTrend } from './trends.ts'

type ItemOf<K extends JournalContextItem['kind']> = Extract<JournalContextItem, { kind: K }>
type ElapsedUnit = ItemOf<'days_since'>['unit']

/** What every item of one context computation shares. */
export interface ContextScope {
  customMetrics: CustomMetricDefinition[]
  day: string
  tz: string
  user: string
}

export interface JournalContextDeps {
  getCustomMetrics: (user: string) => Promise<CustomMetricDefinition[]>
  getItems: (user: string) => Promise<JournalContextItem[]>
  metricValue: (scope: ContextScope, item: ItemOf<'metric'>) => Promise<number | undefined>
  trendValue: (scope: ContextScope, item: ItemOf<'trend'>) => Promise<number | undefined>
  /** Whole days from the latest occurrence of `pattern` on or before `day` to `day`. */
  daysSinceActivity: (user: string, pattern: string, day: string, tz: string) => Promise<number | undefined>
}

/** Time from calendar day `from` to calendar day `to`; undefined when `from` is after `to`. */
export const elapsedSince = (from: string, to: string, unit: ElapsedUnit): number | undefined => {
  const start = Temporal.PlainDate.from(from)
  const end = Temporal.PlainDate.from(to)
  const days = start.until(end, { largestUnit: 'days' }).days
  if (days < 0) return undefined
  if (unit === 'days') return days
  if (unit === 'weeks') return days / 7
  const whole = start.until(end, { largestUnit: 'years' }).years
  const last = start.add({ years: whole })
  const next = start.add({ years: whole + 1 })
  return (
    whole + last.until(end, { largestUnit: 'days' }).days / last.until(next, { largestUnit: 'days' }).days
  )
}

const unitWords: Record<ElapsedUnit, string> = { days: 'Days', weeks: 'Weeks', years: 'Years' }

const moonNames: Record<ItemOf<'moon'>['value'], string> = {
  age_days: 'Moon age (days)',
  age_percent: 'Moon age (% of cycle)',
  illumination: 'Moon illumination',
}

const moonSuffixes: Record<ItemOf<'moon'>['value'], string> = {
  age_days: 'd',
  age_percent: '%',
  illumination: '%',
}

export const itemName = (item: JournalContextItem): string => {
  switch (item.kind) {
    case 'metric':
      return item.source ? `${item.metric} (${item.source})` : item.metric
    case 'trend':
      return `Trend: ${item.pattern} (${item.half_life_days ?? 15} d half-life, ${item.display_period ?? 'monthly'})`
    case 'days_since':
      return `${unitWords[item.unit]} since ${item.source_type === 'date' ? item.date : item.pattern}`
    case 'moon':
      return moonNames[item.value]
  }
}

/** `value` with `decimals`, never `-0`. */
const fixed = (value: number, decimals: number): string => {
  const text = value.toFixed(decimals)
  return Number(text) === 0 ? (0).toFixed(decimals) : text
}

export const formatContextValue = (
  item: JournalContextItem,
  value: number,
  { label = item.label, suffix = '' }: { label?: string; suffix?: string } = {},
): JournalContextValue => ({
  decimals: item.decimals,
  id: item.id,
  kind: item.kind,
  label,
  name: itemName(item),
  suffix,
  text: `${label}${fixed(value, item.decimals)}${suffix}`,
  value,
})

/** `value` cut (not rounded) to `decimals`, as an age is: 46.53 years is 46 at 0 decimals. */
export const truncateTo = (value: number, decimals: number): number => {
  const scale = 10 ** decimals
  return Math.floor(Number((value * scale).toPrecision(12))) / scale
}

const elapsedValue = async (
  { day, tz, user }: ContextScope,
  item: ItemOf<'days_since'>,
  deps: JournalContextDeps,
): Promise<number | undefined> => {
  if (item.source_type === 'date') {
    return item.date === undefined ? undefined : elapsedSince(item.date, day, item.unit)
  }
  if (item.pattern === undefined) return undefined
  const days = await deps.daysSinceActivity(user, item.pattern, day, tz)
  return days === undefined ? undefined : elapsedSince(shiftDayKey(day, -days), day, item.unit)
}

const daysSinceValue = async (
  scope: ContextScope,
  item: ItemOf<'days_since'>,
  deps: JournalContextDeps,
): Promise<number | undefined> => {
  const value = await elapsedValue(scope, item, deps)
  return value === undefined ? undefined : truncateTo(value, item.decimals)
}

export const computeContextValue = async (
  scope: ContextScope,
  item: JournalContextItem,
  deps: JournalContextDeps,
): Promise<JournalContextValue | undefined> => {
  switch (item.kind) {
    case 'moon': {
      const moon = moonPhase(scope.day)
      return formatContextValue(item, moon[item.value], {
        label: `${item.label}${moon.emoji}`,
        suffix: moonSuffixes[item.value],
      })
    }
    case 'metric': {
      const value = await deps.metricValue(scope, item)
      return value === undefined ? undefined : formatContextValue(item, value)
    }
    case 'trend': {
      const value = await deps.trendValue(scope, item)
      return value === undefined ? undefined : formatContextValue(item, value)
    }
    case 'days_since': {
      const value = await daysSinceValue(scope, item, deps)
      return value === undefined ? undefined : formatContextValue(item, value)
    }
  }
}

/** The items' values for `day`, in order; an item without a value, or whose computation fails, is left out. */
export const contextForItems = async (
  user: string,
  items: readonly JournalContextItem[],
  day: string,
  tz: string,
  deps: JournalContextDeps,
): Promise<JournalContext> => {
  const needsMetrics = items.some((item) => item.kind === 'metric' || item.kind === 'trend')
  const customMetrics = needsMetrics ? await deps.getCustomMetrics(user) : []
  const scope: ContextScope = { customMetrics, day, tz, user }
  const values = await Promise.all(
    items.map((item) =>
      computeContextValue(scope, item, deps).catch((error: unknown) => {
        console.warn(`Journal context item ${item.id} (${item.kind}) failed:`, error)
        return undefined
      }),
    ),
  )
  return { date: day, items: values.filter((value) => value !== undefined) }
}

const metricDayValue = async (
  { customMetrics, tz, user }: ContextScope,
  metric: string,
  day: string,
  source: string | undefined,
): Promise<number | undefined> => {
  const rows = await getDailyAggregates(
    user,
    [metric],
    dayStartInTz(day, tz),
    dayEndInTz(day, tz),
    tz,
    source,
  )
  const row = rows.find((r) => r.date === day)
  if (!row) return undefined
  return getMetricAggregation(metric, customMetrics) === 'sum' ? row.sum : row.avg
}

export const defaultJournalContextDeps: JournalContextDeps = {
  daysSinceActivity: (user, pattern, day, tz) => getDaysSinceActivity(user, pattern, day, tz),
  getCustomMetrics: (user) => getCustomMetrics(user),
  getItems: async (user) => (await getUserSettings(user))?.journal_context ?? [],
  metricValue: async (scope, item) => {
    const { day, tz, user } = scope
    const value = await metricDayValue(scope, item.metric, day, item.source)
    if (value !== undefined || item.missing !== 'carry_forward') return value
    const latest = await getLatestMetricSampleTimeBefore(
      user,
      item.metric,
      dayStartInTz(day, tz),
      item.source,
    )
    return latest === undefined
      ? undefined
      : metricDayValue(scope, item.metric, dayKey(latest, tz), item.source)
  },
  trendValue: async ({ customMetrics, day, tz, user }, item) => {
    const result = await getTrend(user, {
      aggregation: item.aggregation,
      custom_metrics: customMetrics,
      display_period: item.display_period,
      end: dayEndInTz(day, tz),
      exclude_flagged: true,
      half_life_days: item.half_life_days,
      missing_days: item.missing_days,
      pattern: item.pattern,
      source_type: item.source_type,
      tz,
    })
    return result.history.length === 0 ? undefined : result.current_value
  },
}

/** The journal context line for `date` (today in `tz` when omitted); undefined when the user configured no items. */
export const getJournalContext = async (
  user: string,
  date: string | undefined,
  tz: string,
  deps: JournalContextDeps = defaultJournalContextDeps,
): Promise<JournalContext | undefined> => {
  const items = await deps.getItems(user)
  if (items.length === 0) return undefined
  return contextForItems(user, items, date ?? dayKey(new Date(), tz), tz, deps)
}

/** The calendar day a journal entry is about: a `day` entry's date, a `time` entry's start in `tz`. */
export const entryContextDay = (
  note: { entity_type: string; date?: string; start_time?: string },
  tz: string,
): string | undefined => {
  if (note.entity_type === 'day') return note.date
  if (note.entity_type === 'time' && note.start_time) return dayKey(new Date(note.start_time), tz)
  return undefined
}

/** `note` with its journal context line, when it is a journal entry and the user configured one. */
export const withJournalContext = async <
  T extends { entity_type: string; date?: string; start_time?: string },
>(
  user: string,
  note: T,
  tz: string,
  deps: JournalContextDeps = defaultJournalContextDeps,
): Promise<T & { context?: JournalContext }> => {
  const day = entryContextDay(note, tz)
  if (day === undefined) return note
  const context = await getJournalContext(user, day, tz, deps)
  return context ? { ...note, context } : note
}
