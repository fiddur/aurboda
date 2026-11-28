import {
  type CustomMetricDefinition,
  getMetricAggregation,
  isContextualHrvMetric,
  isHrZoneMetric,
  type JournalContext,
  type JournalContextItem,
  type JournalContextValue,
  metricLabels,
  type MetricType,
  type WeatherSummary,
  weatherTemperatureText,
} from '@aurboda/api-spec'

import {
  getDailyAggregates,
  getHrZoneSecs,
  getDaysSinceActivity,
  getLatestMetricSampleTimeBefore,
  getUserSettings,
} from '../db/index.ts'
import { mapWithConcurrency } from '../utils.ts'
import { getCustomMetrics } from './custom-metrics.ts'
import { dayEndInTz, dayKey, dayStartInTz, shiftDayKey } from './day-keys.ts'
import { type DerivedMetric, derivedMetric } from './derived-metrics.ts'
import { moonPhase } from './moon.ts'
import { queryMetrics } from './queries/index.ts'
import { getEffectiveHrZones } from './settings.ts'
import { computeTrainingLoad, createTrainingLoadDeps, type TrainingLoadDeps } from './training-load/index.ts'
import { getTrend } from './trends.ts'
import { getWeather } from './weather.ts'

type ItemOf<K extends JournalContextItem['kind']> = Extract<JournalContextItem, { kind: K }>
type ElapsedUnit = ItemOf<'days_since'>['unit']
type TrainingLoadKey = ItemOf<'training_load'>['value']

export type TrainingLoadValues = Record<TrainingLoadKey, number>

/** A day's weather, or the hour's that holds an instant (`start` = `end`). */
export type ContextWeatherQuery = { date: string; tz: string } | { start: string; end: string }

/** What every item of one context computation shares. */
export interface ContextScope {
  /** A timed entry's instant (ISO): the weather is that hour's rather than the day's. */
  at?: string
  customMetrics: CustomMetricDefinition[]
  day: string
  /** The day's training load, fetched once for every training_load item of the context. */
  trainingLoad?: Promise<TrainingLoadValues | undefined>
  tz: string
  user: string
  /** The weather, fetched once for every weather item of the context. */
  weather?: Promise<WeatherSummary | null>
  /** A list's trend values, computed once per item for each cluster of its days; undefined when that failed. */
  trends?: (item: ItemOf<'trend'>, day: string) => Promise<Map<string, number> | undefined>
}

/** What a trend computation shares across the days it is asked for. */
export type TrendScope = Pick<ContextScope, 'customMetrics' | 'tz' | 'user'>

export interface JournalContextDeps {
  getCustomMetrics: (user: string) => Promise<CustomMetricDefinition[]>
  getItems: (user: string) => Promise<JournalContextItem[]>
  metricValue: (scope: ContextScope, item: ItemOf<'metric'>) => Promise<number | undefined>
  /** The trend's value as of the end of each of `days` that has one. */
  trendValues: (
    scope: TrendScope,
    item: ItemOf<'trend'>,
    days: readonly string[],
  ) => Promise<Map<string, number>>
  /** CTL, ATL and TSB at the end of the day; undefined when there is no training load data. */
  trainingLoadValue: (scope: ContextScope) => Promise<TrainingLoadValues | undefined>
  /** Whole days from the latest occurrence of `pattern` on or before `day` to `day`. */
  daysSinceActivity: (user: string, pattern: string, day: string, tz: string) => Promise<number | undefined>
  /** The weather summary; null when there is none. */
  weather: (user: string, query: ContextWeatherQuery) => Promise<WeatherSummary | null>
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

const trainingLoadNames: Record<TrainingLoadKey, string> = {
  atl: 'Fatigue (ATL)',
  ctl: 'Fitness (CTL)',
  tsb: 'Form (TSB)',
}

const metricName = (metric: string): string =>
  derivedMetric(metric) ? (metricLabels[metric] ?? metric) : metric

export const itemName = (item: JournalContextItem): string => {
  switch (item.kind) {
    case 'metric':
      return item.source ? `${metricName(item.metric)} (${item.source})` : metricName(item.metric)
    case 'trend':
      return `Trend: ${item.pattern} (${item.half_life_days ?? 15} d half-life, ${item.display_period ?? 'monthly'})`
    case 'days_since':
      return `${unitWords[item.unit]} since ${item.source_type === 'date' ? item.date : item.pattern}`
    case 'moon':
      return moonNames[item.value]
    case 'training_load':
      return trainingLoadNames[item.value]
    case 'weather':
      return 'Weather'
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

export const contextWeatherQuery = ({ at, day, tz }: ContextScope): ContextWeatherQuery =>
  at === undefined ? { date: day, tz } : { end: at, start: at }

/**
 * The label gets the condition emoji; the text the temperature with `show_temperature`, else the condition in
 * words (each falling back to the other when it is missing). Undefined when there is nothing to show.
 */
export const weatherContextValue = (
  item: ItemOf<'weather'>,
  summary: WeatherSummary | null,
): JournalContextValue | undefined => {
  if (summary === null) return undefined
  const label = `${item.label}${summary.emoji}`
  const base = { decimals: 0, id: item.id, kind: item.kind, label, name: itemName(item) }
  const temperature = weatherTemperatureText(summary.temperature_min, summary.temperature_max)
  const showTemperature = (): JournalContextValue | undefined =>
    temperature === undefined || summary.temperature_avg === null
      ? undefined
      : { ...base, suffix: '°C', text: `${label} ${temperature}`, value: summary.temperature_avg }
  const showCondition = (): JournalContextValue | undefined =>
    summary.code === null
      ? undefined
      : { ...base, suffix: '', text: `${label} ${summary.condition}`, value: summary.code }
  return item.show_temperature
    ? (showTemperature() ?? showCondition())
    : (showCondition() ?? showTemperature())
}

const trendDayValue = async (
  scope: ContextScope,
  item: ItemOf<'trend'>,
  deps: JournalContextDeps,
): Promise<number | undefined> => {
  const values = await (scope.trends?.(item, scope.day) ?? deps.trendValues(scope, item, [scope.day]))
  return values?.get(scope.day)
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
      const value = await trendDayValue(scope, item, deps)
      return value === undefined ? undefined : formatContextValue(item, value)
    }
    case 'days_since': {
      const value = await daysSinceValue(scope, item, deps)
      return value === undefined ? undefined : formatContextValue(item, value)
    }
    case 'training_load': {
      const load = await (scope.trainingLoad ?? deps.trainingLoadValue(scope))
      return load === undefined ? undefined : formatContextValue(item, load[item.value])
    }
    case 'weather':
      return weatherContextValue(
        item,
        await (scope.weather ?? deps.weather(scope.user, contextWeatherQuery(scope))),
      )
  }
}

const needsCustomMetrics = (items: readonly JournalContextItem[]): boolean =>
  items.some((item) => item.kind === 'metric' || item.kind === 'trend')

/** The items' values for the scope, in order; undefined for an item without a value or whose computation fails. */
const itemValues = async (
  items: readonly JournalContextItem[],
  base: ContextScope,
  deps: JournalContextDeps,
): Promise<(JournalContextValue | undefined)[]> => {
  const scope: ContextScope = {
    ...base,
    ...(items.some((item) => item.kind === 'training_load') && {
      trainingLoad: deps.trainingLoadValue(base),
    }),
    ...(items.some((item) => item.kind === 'weather') && {
      weather: deps.weather(base.user, contextWeatherQuery(base)).catch((error: unknown) => {
        console.warn('Journal context weather failed:', error)
        return null
      }),
    }),
  }
  return Promise.all(
    items.map((item) =>
      computeContextValue(scope, item, deps).catch((error: unknown) => {
        console.warn(`Journal context item ${item.id} (${item.kind}) failed:`, error)
        return undefined
      }),
    ),
  )
}

const contextOf = (
  { at, day }: { day: string; at?: string },
  values: readonly (JournalContextValue | undefined)[],
): JournalContext => ({
  ...(at === undefined ? {} : { at }),
  date: day,
  items: values.filter((value) => value !== undefined),
})

/**
 * The items' values for `day`, in order; an item without a value, or whose computation fails, is left out. `at`, a
 * timed entry's instant, gives the weather of its hour instead of the day's.
 */
export const contextForItems = async (
  user: string,
  items: readonly JournalContextItem[],
  day: string,
  tz: string,
  deps: JournalContextDeps,
  at?: string,
): Promise<JournalContext> => {
  const customMetrics = needsCustomMetrics(items) ? await deps.getCustomMetrics(user) : []
  const target = { day, ...(at === undefined ? {} : { at }) }
  return contextOf(target, await itemValues(items, { customMetrics, tz, user, ...target }, deps))
}

const mean = (values: readonly number[]): number | undefined =>
  values.length === 0 ? undefined : values.reduce((sum, value) => sum + value, 0) / values.length

const sampleMean = async (user: string, metric: string, start: Date, end: Date) =>
  mean((await queryMetrics(user, metric, start, end)).data.map((point) => point.value))

/** Seconds in the zone of `metric` (`hr_zone_N_sec`) in [start, end], from heart_rate; undefined without samples. */
const hrZoneSeconds = async (user: string, metric: string, start: Date, end: Date) => {
  const zone = Number(/^hr_zone_([0-5])_sec$/.exec(metric)?.[1]) as 0 | 1 | 2 | 3 | 4 | 5
  const { zones } = await getEffectiveHrZones(user)
  const [row] = await getHrZoneSecs(user, start, end, zones)
  return row === undefined || row.sample_count === 0 ? undefined : row.secs[zone]
}

/** `definition` over the days ending on `day` (inclusive), in tz; undefined when the window has no data. */
const derivedValue = async (
  { tz, user }: ContextScope,
  definition: DerivedMetric,
  day: string,
  source: string | undefined,
): Promise<number | undefined> => {
  const start = dayStartInTz(shiftDayKey(day, 1 - definition.days), tz)
  const end = dayEndInTz(day, tz)
  if (isHrZoneMetric(definition.metric as MetricType)) {
    const seconds = await hrZoneSeconds(user, definition.metric, start, end)
    return seconds === undefined ? undefined : seconds * definition.scale
  }
  if (definition.prefer !== undefined && source === undefined) {
    const preferred = await sampleMean(user, definition.prefer, start, end)
    if (preferred !== undefined) return preferred
  }
  const rows = await getDailyAggregates(user, [definition.metric], start, end, tz, source)
  if (rows.length === 0) return undefined
  if (definition.reduce === 'mean') return mean(rows.map((row) => row.avg))
  return rows.reduce((sum, row) => sum + row.sum, 0) * definition.scale
}

const metricDayValue = async (
  { customMetrics, tz, user }: ContextScope,
  metric: string,
  day: string,
  source: string | undefined,
): Promise<number | undefined> => {
  if (isContextualHrvMetric(metric as MetricType)) {
    return sampleMean(user, metric, dayStartInTz(day, tz), dayEndInTz(day, tz))
  }
  if (isHrZoneMetric(metric as MetricType)) {
    return hrZoneSeconds(user, metric, dayStartInTz(day, tz), dayEndInTz(day, tz))
  }
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

/** The last hourly point of `day`; computeTrainingLoad warms its model up from before the range it is asked for. */
export const trainingLoadAt = async (
  deps: TrainingLoadDeps,
  user: string,
  day: string,
  tz: string,
): Promise<TrainingLoadValues | undefined> => {
  const result = await computeTrainingLoad(deps, user, dayStartInTz(day, tz), dayEndInTz(day, tz), '1h', tz)
  const last = result.points.at(-1)
  if (last === undefined || (last.ctl === 0 && last.atl === 0)) return undefined
  return { atl: last.atl, ctl: last.ctl, tsb: last.tsb }
}

/**
 * The process's training load deps with a short wait for a recompute: long enough for the incremental one a sync
 * leaves behind, so a note read is not held by a long backfill, whose item is left out until it is done. The recompute
 * state is the process's own, shared with every other reader.
 */
export const journalTrainingLoadDeps: TrainingLoadDeps = { ...createTrainingLoadDeps(), recomputeWaitMs: 500 }

/** The lookback of a single trend read; a day's value is the EMA over the 90 days ending on it. */
const TREND_LOOKBACK_DAYS = 90

const TREND_CLUSTER_MAX_GAP_DAYS = 30

const daysBetween = (from: string, to: string): number =>
  Temporal.PlainDate.from(from).until(Temporal.PlainDate.from(to), { largestUnit: 'days' }).days

/** `days` sorted and deduplicated, split where consecutive days are more than `maxGap` days apart. */
export const clusterDays = (days: readonly string[], maxGap = TREND_CLUSTER_MAX_GAP_DAYS): string[][] => {
  const clusters: string[][] = []
  for (const day of [...new Set(days)].sort()) {
    const current = clusters.at(-1)
    const previous = current?.at(-1)
    if (current && previous !== undefined && daysBetween(previous, day) <= maxGap) current.push(day)
    else clusters.push([day])
  }
  return clusters
}

const readTrend = (
  { customMetrics, tz, user }: TrendScope,
  item: ItemOf<'trend'>,
  end: string,
  lookback: number,
) =>
  getTrend(user, {
    aggregation: item.aggregation,
    custom_metrics: customMetrics,
    display_period: item.display_period,
    end: dayEndInTz(end, tz),
    exclude_flagged: true,
    half_life_days: item.half_life_days,
    lookback_days: lookback,
    missing_days: item.missing_days,
    pattern: item.pattern,
    source_type: item.source_type,
    tz,
  })

/**
 * The trend for `days` from one read ending on the last of them, whose history reaches the lookback back from the
 * first. A history point is a day's EMA over the 90 days ending on it, as the day's own read computes it, so it is the
 * day's value. A day without a point has none, unless a point lies in its lookback: then its own read decides (only a
 * metric trend that skips missing days has such gaps, and its read then answers an earlier day's value).
 */
const batchedTrendValues = async (
  scope: TrendScope,
  item: ItemOf<'trend'>,
  days: readonly string[],
): Promise<Map<string, number>> => {
  const sorted = [...new Set(days)].sort()
  const first = sorted[0]
  const last = sorted.at(-1)
  const values = new Map<string, number>()
  if (first === undefined || last === undefined) return values
  const batch = await readTrend(scope, item, last, daysBetween(first, last) + TREND_LOOKBACK_DAYS)
  const points = new Map(batch.history.map((point) => [point.date, point.value]))
  for (const day of sorted) {
    const own = points.get(day)
    if (own !== undefined) {
      values.set(day, own)
      continue
    }
    const since = shiftDayKey(day, -TREND_LOOKBACK_DAYS)
    if (!batch.history.some((point) => point.date >= since && point.date < day)) continue
    const single = sorted.length === 1 ? batch : await readTrend(scope, item, day, TREND_LOOKBACK_DAYS)
    if (single.history.length > 0) values.set(day, single.current_value)
  }
  return values
}

export const defaultJournalContextDeps: JournalContextDeps = {
  daysSinceActivity: (user, pattern, day, tz) => getDaysSinceActivity(user, pattern, day, tz),
  getCustomMetrics: (user) => getCustomMetrics(user),
  getItems: async (user) => (await getUserSettings(user))?.journal_context ?? [],
  metricValue: async (scope, item) => {
    const { day, tz, user } = scope
    const definition = derivedMetric(item.metric)
    if (definition) return derivedValue(scope, definition, day, item.source)
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
  trendValues: (scope, item, days) => batchedTrendValues(scope, item, days),
  trainingLoadValue: ({ day, tz, user }) => trainingLoadAt(journalTrainingLoadDeps, user, day, tz),
  weather: async (user, query) => {
    const result = await getWeather(user, query)
    return result.ok ? result.weather.summary : null
  },
}

/**
 * The journal context line for `date` (when omitted, the day of `at`, else today, in `tz`); undefined when the user
 * configured no items. `at`, a timed entry's instant, gives the weather of its hour.
 */
export const getJournalContext = async (
  user: string,
  date: string | undefined,
  tz: string,
  deps: JournalContextDeps = defaultJournalContextDeps,
  at?: string,
): Promise<JournalContext | undefined> => {
  const items = await deps.getItems(user)
  if (items.length === 0) return undefined
  return contextForItems(
    user,
    items,
    date ?? dayKey(at === undefined ? new Date() : new Date(at), tz),
    tz,
    deps,
    at,
  )
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

type JournalEntryLike = { entity_type: string; date?: string; start_time?: string }

/** What a journal entry's line is computed for: its day and, for a `time` entry, its start (the weather's hour). */
const entryContextTarget = (note: JournalEntryLike, tz: string): { day: string; at?: string } | undefined => {
  const day = entryContextDay(note, tz)
  if (day === undefined) return undefined
  return note.entity_type === 'time' && note.start_time ? { at: note.start_time, day } : { day }
}

const targetKey = ({ at, day }: { day: string; at?: string }): string => `${day}|${at ?? ''}`

const isWeatherItem = (item: JournalContextItem): boolean => item.kind === 'weather'

const JOURNAL_CONTEXTS_CONCURRENCY = 4

/**
 * `notes` with each journal entry's context line, when the user configured one. Only the weather depends on a timed
 * entry's start, so every other item is computed once per distinct day and the weather once per distinct day entry
 * or start; each entry's line is then the one the single-note read gives it.
 */
export const withJournalContexts = async <T extends JournalEntryLike>(
  user: string,
  notes: readonly T[],
  tz: string,
  deps: JournalContextDeps = defaultJournalContextDeps,
): Promise<(T & { context?: JournalContext })[]> => {
  const targets = notes.map((note) => entryContextTarget(note, tz))
  const present = targets.filter((target) => target !== undefined)
  if (present.length === 0) return [...notes]
  const items = await deps.getItems(user)
  if (items.length === 0) return [...notes]
  const customMetrics = needsCustomMetrics(items) ? await deps.getCustomMetrics(user) : []
  const dayItems = items.filter((item) => !isWeatherItem(item))
  const weatherItems = items.filter(isWeatherItem)
  const tasks = [
    ...(dayItems.length === 0
      ? []
      : [...new Set(present.map((target) => target.day))].map((day) => ({
          items: dayItems,
          key: `day:${day}`,
          target: { day },
        }))),
    ...(weatherItems.length === 0
      ? []
      : [...new Map(present.map((target) => [targetKey(target), target])).values()].map((target) => ({
          items: weatherItems,
          key: `weather:${targetKey(target)}`,
          target,
        }))),
  ]
  const clusterOf = new Map(
    clusterDays(present.map((target) => target.day)).flatMap((cluster) =>
      cluster.map((day) => [day, cluster]),
    ),
  )
  const trendReads = new Map<string, Promise<Map<string, number> | undefined>>()
  const trends = (item: ItemOf<'trend'>, day: string) => {
    const cluster = clusterOf.get(day) ?? [day]
    const key = `${item.id}|${cluster[0]}`
    const known = trendReads.get(key)
    if (known) return known
    const read = deps.trendValues({ customMetrics, tz, user }, item, cluster).catch((error: unknown) => {
      console.warn(`Journal context trend ${item.id} from ${cluster[0]} failed:`, error)
      return undefined
    })
    trendReads.set(key, read)
    return read
  }
  const computed = await mapWithConcurrency(tasks, JOURNAL_CONTEXTS_CONCURRENCY, async (task) => {
    const values = await itemValues(task.items, { customMetrics, trends, tz, user, ...task.target }, deps)
    return [task.key, new Map(task.items.map((item, i) => [item.id, values[i]]))] as const
  })
  const byKey = new Map(computed)
  return notes.map((note, i) => {
    const target = targets[i]
    if (target === undefined) return note
    const days = byKey.get(`day:${target.day}`)
    const weather = byKey.get(`weather:${targetKey(target)}`)
    const values = items.map((item) => (isWeatherItem(item) ? weather : days)?.get(item.id))
    return { ...note, context: contextOf(target, values) }
  })
}

/** `note` with its journal context line, when it is a journal entry and the user configured one. */
export const withJournalContext = async <T extends JournalEntryLike>(
  user: string,
  note: T,
  tz: string,
  deps: JournalContextDeps = defaultJournalContextDeps,
): Promise<T & { context?: JournalContext }> => {
  const [result] = await withJournalContexts(user, [note], tz, deps)
  return result ?? note
}
