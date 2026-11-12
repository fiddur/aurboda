/**
 * Shared dashboard data resolver — the security boundary for public dashboards.
 *
 * Given a stored `DashboardConfig`, this resolves the data each widget renders
 * by calling the SAME user-scoped services the authenticated dashboard uses,
 * with parameters taken EXCLUSIVELY from the stored widget config. No viewer
 * input ever reaches these calls, and each resolver returns only the minimal
 * fields the widget renders (never raw rows with notes, titles, or locations).
 *
 * The result is keyed by widget id so a public viewer (and, later, a single
 * embeddable chart) can match data to the widget it belongs to.
 */
import type {
  ActivitySummaryData,
  CombinedChartLayerData,
  DashboardConfig,
  DashboardWidget,
  PeriodWindow,
  TopListFigures,
  TrendHistoryPoint,
  WidgetData,
  WidgetDataMap,
} from '@aurboda/api-spec'

import {
  hrZoneMetrics,
  metricCardLookbackDays,
  percentChange,
  periodGranularityOf,
  topListFromApps,
  topListFromMedia,
  topListFromPlaces,
  windowDays,
} from '@aurboda/api-spec'

import { getActivityRecords, publicRecord } from './activity-records.ts'
import { maskBreakdownNames } from './breakdown-mask.ts'
import { getChartData } from './chart-data.ts'
import { getActivityImpact } from './correlations/activity-impact.ts'
import { getBaseline } from './correlations/baseline.ts'
import { getCustomMetrics } from './custom-metrics.ts'
import { dayKey, dayStartInTz } from './day-keys.ts'
import { getGoalsProgress } from './goals.ts'
import { getLatestSleep } from './latest-sleep.ts'
import {
  isFinishedPeriod,
  latestFinishedPeriodKey,
  PeriodError,
  periodDays,
  periodWindow,
  previousWindow,
} from './periods.ts'
import {
  getActivityTypeSummary,
  getPeriodSummary,
  getPlacesSummary,
  getTopApps,
  getTopMedia,
  queryMetrics,
} from './queries/index.ts'
import { getEffectiveHrZones, getUserTimezone } from './settings.ts'
import { getTrend } from './trends.ts'

/** Widget metric names that map to a different stored metric name. */
const metricToApiMetric: Record<string, string> = { zone2_weekly: 'hr_zone_2_sec' }

const baselineMetrics = new Set(['hrv_7day', 'hrv_30day', 'rhr_7day', 'rhr_30day'])

/** In a window, a baseline card is the window average of the metric it is a baseline of. */
const baselineWindowMetric: Record<string, string> = {
  hrv_30day: 'hrv_rmssd',
  hrv_7day: 'hrv_rmssd',
  rhr_30day: 'resting_heart_rate',
  rhr_7day: 'resting_heart_rate',
}

/** A calendar window; `end` is exclusive. */
export interface ResolveWindow {
  end: Date
  start: Date
}

/**
 * With `window`, every widget resolves over it instead of its own lookback; with `previous` too, the
 * figure widgets also resolve the previous window and report how they compare.
 */
export interface ResolveOptions {
  previous?: ResolveWindow
  window?: ResolveWindow
}

interface Range {
  end: Date
  start: Date
}

/** A simple lookback window ending now. */
const lookbackRange = (days: number): Range => {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - days)
  return { end, start }
}

/** The inclusive query range of an exclusive-end window. */
const inclusiveRange = (window: ResolveWindow): Range => ({
  end: new Date(window.end.getTime() - 1),
  start: window.start,
})

const windowOf = (options: ResolveOptions, lookbackDays: number): Range =>
  options.window ? inclusiveRange(options.window) : lookbackRange(lookbackDays)

/** A stored `since` can be later than today (saved through the API); it then starts today. */
const clampSince = (since: string, tz: string, now: Date): string => {
  const today = dayKey(now, tz)
  return since > today ? today : since
}

/** Whole calendar days in `tz` from a chart's fixed `since` date to today, at least one: a trend's lookback. */
export const sinceLookbackDays = (since: string, tz: string, now: Date = new Date()): number =>
  Math.max(
    1,
    Temporal.PlainDate.from(clampSince(since, tz, now)).until(Temporal.PlainDate.from(dayKey(now, tz))).days,
  )

/** A bar chart's range from its fixed `since` date's midnight in `tz` to now. */
export const sinceRange = (since: string, tz: string, now: Date = new Date()): Range => ({
  end: now,
  start: dayStartInTz(clampSince(since, tz, now), tz),
})

const chartWindowOf = (
  options: ResolveOptions,
  config: { lookback_days: number; since?: string },
  tz: string,
) =>
  !options.window && config.since ? sinceRange(config.since, tz) : windowOf(options, config.lookback_days)

const trendLookbackDays = (
  options: ResolveOptions,
  config: { lookback_days?: number; since?: string },
  tz: string,
): number => {
  if (options.window) return periodDays(options.window) - 1
  return config.since ? sinceLookbackDays(config.since, tz) : (config.lookback_days ?? 90)
}

const summaryFigures = async (user: string, apiMetric: string, range: Range) => {
  const summary = await getPeriodSummary(user, [apiMetric], range.start, range.end)
  const stats = summary.metrics.find((m) => m.metric === apiMetric)
  const hasData = stats !== undefined && stats.count > 0
  return {
    count: stats?.count ?? null,
    max: hasData ? stats.max : null,
    trend: stats?.change_from_previous_period_percent ?? null,
    value: hasData ? stats.avg : null,
  }
}

type SummaryFigures = Awaited<ReturnType<typeof summaryFigures>>

const previousFigures = async (
  user: string,
  apiMetric: string,
  previous: ResolveWindow | undefined,
): Promise<SummaryFigures | undefined> =>
  previous ? summaryFigures(user, apiMetric, inclusiveRange(previous)) : undefined

const compareWithPrevious = (
  value: number | null,
  previous: SummaryFigures | undefined,
): { previous_value: number | null; trend_percent: number | null } | undefined =>
  previous
    ? { previous_value: previous.value, trend_percent: percentChange(value, previous.value) }
    : undefined

const resolveMetricCard = async (
  user: string,
  config: Extract<DashboardWidget, { type: 'metric_card' }>['config'],
  options: ResolveOptions,
): Promise<WidgetData> => {
  const { metric } = config
  if (options.window) {
    const apiMetric = baselineWindowMetric[metric] ?? metricToApiMetric[metric] ?? metric
    const [current, previous] = await Promise.all([
      summaryFigures(user, apiMetric, inclusiveRange(options.window)),
      previousFigures(user, apiMetric, options.previous),
    ])
    const comparison = compareWithPrevious(current.value, previous)
    return {
      data: {
        count: current.count,
        max: current.max,
        trend_percent: current.trend,
        value: current.value,
        ...comparison,
      },
      type: 'metric_card',
    }
  }
  if (baselineMetrics.has(metric)) {
    const baseline = await getBaseline(user)
    const pick =
      metric === 'hrv_7day'
        ? { trend: baseline.hrv.trend_percent, value: baseline.hrv.avg7day }
        : metric === 'hrv_30day'
          ? { trend: null, value: baseline.hrv.avg30day }
          : metric === 'rhr_7day'
            ? { trend: baseline.resting_hr.trend_percent, value: baseline.resting_hr.avg7day }
            : { trend: null, value: baseline.resting_hr.avg30day }
    return {
      data: { count: null, max: null, trend_percent: pick.trend, value: pick.value },
      type: 'metric_card',
    }
  }

  const apiMetric = metricToApiMetric[metric] ?? metric
  const current = await summaryFigures(user, apiMetric, lookbackRange(metricCardLookbackDays(metric)))
  return {
    data: { count: current.count, max: current.max, trend_percent: current.trend, value: current.value },
    type: 'metric_card',
  }
}

const resolveSparklineCard = async (
  user: string,
  config: Extract<DashboardWidget, { type: 'sparkline_card' }>['config'],
  options: ResolveOptions,
): Promise<WidgetData> => {
  const apiMetric = metricToApiMetric[config.metric] ?? config.metric
  const range = windowOf(options, config.lookback_days ?? 30)
  const customMetrics = await getCustomMetrics(user)
  const [series, current, previous] = await Promise.all([
    queryMetrics(user, apiMetric, range.start, range.end, customMetrics),
    summaryFigures(user, apiMetric, range),
    previousFigures(user, apiMetric, options.previous),
  ])
  const comparison = compareWithPrevious(current.value, previous)
  return {
    data: {
      count: current.count,
      series: series.data.map((p) => ({ time: p.time, value: p.value })),
      trend_percent: current.trend,
      value: current.value,
      ...comparison,
    },
    type: 'sparkline_card',
  }
}

const resolveTrendChart = async (
  user: string,
  config: Extract<DashboardWidget, { type: 'trend_chart' }>['config'],
  tz: string,
  options: ResolveOptions,
): Promise<WidgetData> => {
  const customMetrics = await getCustomMetrics(user)
  const result = await getTrend(user, {
    aggregation: config.aggregation,
    custom_metrics: customMetrics,
    display_period: config.display_period ?? 'monthly',
    filter_field: config.filter_field,
    filter_value: config.filter_value,
    half_life_days: config.half_life_days ?? 15,
    lookback_days: trendLookbackDays(options, config, tz),
    measure: config.measure,
    missing_days: config.missing_days,
    pattern: config.pattern,
    source_type: config.source_type,
    tz,
    ...(options.window ? { end: inclusiveRange(options.window).end } : {}),
    ...(config.breakdown_fields?.length ? { breakdown_fields: config.breakdown_fields } : {}),
  })
  if (result.breakdown_series?.length) {
    const nameFor = maskBreakdownNames(
      result.breakdown_series,
      config.breakdown_fields ?? [],
      config.masked_breakdown_fields ?? [],
    )
    const mask = (name: string) => nameFor.get(name) ?? name
    const breakdown_histories: Record<string, TrendHistoryPoint[]> = {}
    for (const name of result.breakdown_series) {
      breakdown_histories[mask(name)] = result.breakdown_histories?.[name] ?? []
    }
    return {
      data: {
        breakdown_histories,
        breakdown_series: result.breakdown_series.map(mask),
        current_value: result.current_value,
        history: result.history,
      },
      type: 'trend_chart',
    }
  }

  return {
    data: { current_value: result.current_value, history: result.history },
    type: 'trend_chart',
  }
}

const resolveBarChart = async (
  user: string,
  config: Extract<DashboardWidget, { type: 'bar_chart' }>['config'],
  tz: string,
  options: ResolveOptions,
): Promise<WidgetData> => {
  const { end, start } = chartWindowOf(options, config, tz)
  const result = await getChartData(user, {
    activity_type_id: config.tag_definition_id,
    aggregation: config.aggregation ?? 'count',
    bucket_size: config.bucket_size,
    end: end.toISOString(),
    filter_field: config.filter_field,
    filter_value: config.filter_value,
    measure: config.measure,
    pattern: config.pattern,
    source_type: config.source_type,
    start: start.toISOString(),
    tz,
    ...(config.breakdown_fields?.length ? { breakdown_fields: config.breakdown_fields } : {}),
  })

  if (result.breakdown_series?.length) {
    const nameFor = maskBreakdownNames(
      result.breakdown_series,
      config.breakdown_fields ?? [],
      config.masked_breakdown_fields ?? [],
    )
    const mask = (name: string) => nameFor.get(name) ?? name
    const breakdown_buckets = result.buckets.flatMap((b) =>
      'series' in b
        ? [
            {
              bucket_start: b.bucket_start,
              series: Object.fromEntries(
                Object.entries(b.series).map(([name, value]) => [mask(name), value]),
              ),
            },
          ]
        : [],
    )
    return {
      data: { breakdown_buckets, breakdown_series: result.breakdown_series.map(mask), buckets: [] },
      type: 'bar_chart',
    }
  }

  const buckets = result.buckets.flatMap((b) =>
    'value' in b ? [{ bucket_start: b.bucket_start, value: b.value }] : [],
  )
  return { data: { buckets }, type: 'bar_chart' }
}

const resolveCombinedLayer = async (
  user: string,
  layer: Extract<DashboardWidget, { type: 'combined_chart' }>['config']['layers'][number],
  lookback_days: number,
  tz: string,
  options: ResolveOptions,
): Promise<CombinedChartLayerData> => {
  if (layer.kind === 'bars') {
    const { kind, ...source } = layer
    const resolved = await resolveBarChart(user, { ...source, lookback_days }, tz, options)
    return { data: resolved.type === 'bar_chart' ? resolved.data : null, kind }
  }
  const { color: _color, kind, ...source } = layer
  const resolved = await resolveTrendChart(user, { ...source, lookback_days }, tz, options)
  return { data: resolved.type === 'trend_chart' ? resolved.data : null, kind }
}

const resolveCombinedChart = async (
  user: string,
  config: Extract<DashboardWidget, { type: 'combined_chart' }>['config'],
  tz: string,
  options: ResolveOptions,
): Promise<WidgetData> => {
  const layers = await Promise.all(
    config.layers.map((layer) =>
      resolveCombinedLayer(user, layer, config.lookback_days, tz, options).catch(
        (error: unknown): CombinedChartLayerData => {
          console.warn(`Failed to resolve a ${layer.kind} layer of a combined chart:`, error)
          return layer.kind === 'bars' ? { data: null, kind: 'bars' } : { data: null, kind: 'trend' }
        },
      ),
    ),
  )
  return { data: { layers }, type: 'combined_chart' }
}

const resolveRecordCard = async (
  user: string,
  config: Extract<DashboardWidget, { type: 'record_card' }>['config'],
  options: ResolveOptions,
): Promise<WidgetData> => {
  const { filter_field, filter_value, lookback_days } = config
  const range = options.window ? inclusiveRange(options.window) : undefined
  const { records } = await getActivityRecords(user, config.pattern, {
    ...(filter_field !== undefined && filter_value !== undefined ? { filter_field, filter_value } : {}),
    ...(range
      ? { end: range.end.toISOString(), start: range.start.toISOString() }
      : lookback_days !== undefined
        ? { start: lookbackRange(lookback_days).start.toISOString() }
        : {}),
  })
  const record = records.find((r) => r.measure === config.measure)
  return { data: { record: record ? publicRecord(record) : null }, type: 'record_card' }
}

const resolveActivityTypeCard = async (
  user: string,
  config: Extract<DashboardWidget, { type: 'activity_type_card' }>['config'],
  options: ResolveOptions,
): Promise<WidgetData> => {
  const { filter_field, filter_value } = config
  const summarize = (range: Range) =>
    getActivityTypeSummary(user, config.pattern, {
      end: range.end.toISOString(),
      start: range.start.toISOString(),
      ...(filter_field !== undefined && filter_value !== undefined ? { filter_field, filter_value } : {}),
    })
  const [current, previous] = await Promise.all([
    summarize(windowOf(options, config.lookback_days ?? 30)),
    options.previous ? summarize(inclusiveRange(options.previous)) : undefined,
  ])
  return {
    data: previous
      ? {
          ...current,
          previous_count: previous.count,
          previous_distance_km: previous.distance_km,
          previous_sleep_avg_minutes: previous.sleep?.avg_minutes ?? null,
          previous_total_minutes: previous.total_minutes,
        }
      : current,
    type: 'activity_type_card',
  }
}

const mediaGrouping = { media_album: 'album', media_artist: 'artist', media_track: 'track' } as const

const topListFigures = async (
  user: string,
  config: Extract<DashboardWidget, { type: 'top_list_card' }>['config'],
  range: Range,
  tz: string,
): Promise<TopListFigures> => {
  const { limit, media_source, source } = config
  switch (source) {
    case 'media_artist':
    case 'media_album':
    case 'media_track':
      return topListFromMedia(await getTopMedia(user, range, mediaGrouping[source], limit, media_source))
    case 'screentime_app':
      return topListFromApps(await getTopApps(user, range, limit), windowDays(range.start, range.end))
    case 'place':
      return topListFromPlaces(
        await getPlacesSummary(user, { end: range.end, start: range.start, tz }),
        limit,
      )
  }
}

const resolveTopListCard = async (
  user: string,
  config: Extract<DashboardWidget, { type: 'top_list_card' }>['config'],
  tz: string,
  options: ResolveOptions,
): Promise<WidgetData> => {
  const [current, previous] = await Promise.all([
    topListFigures(user, config, windowOf(options, config.lookback_days ?? 30), tz),
    options.previous ? topListFigures(user, config, inclusiveRange(options.previous), tz) : undefined,
  ])
  return {
    data: previous ? { ...current, previous_total: previous.total } : current,
    type: 'top_list_card',
  }
}

const resolvePlacesCard = async (
  user: string,
  config: Extract<DashboardWidget, { type: 'places_card' }>['config'],
  tz: string,
  options: ResolveOptions,
): Promise<WidgetData> => {
  const summarize = (range: Range) =>
    getPlacesSummary(user, { end: range.end, homeName: config.home_location, start: range.start, tz })
  const [current, previous] = await Promise.all([
    summarize(windowOf(options, config.lookback_days ?? 30)),
    options.previous ? summarize(inclusiveRange(options.previous)) : undefined,
  ])
  return {
    data: previous
      ? {
          ...current,
          previous_distinct_places: previous.distinct_places,
          previous_nights_away: previous.nights_away,
          previous_nights_by_place: previous.nights_by_place,
          previous_nights_elsewhere: previous.nights_elsewhere,
          previous_visits: previous.visits,
        }
      : current,
    type: 'places_card',
  }
}

const resolveCorrelation = async (
  user: string,
  config: Extract<DashboardWidget, { type: 'correlation' }>['config'],
  options: ResolveOptions,
): Promise<WidgetData> => {
  const result = await getActivityImpact(
    user,
    config.activity,
    config.activity_type,
    config.window_minutes ?? 30,
    options.window ? periodDays(options.window) : (config.period_days ?? 90),
    undefined,
    options.window?.end,
    options.window?.start,
  )
  return {
    data: {
      hrv_after30: result.hrv_timeline.after30min.mean,
      hrv_before30: result.hrv_timeline.before30min.mean,
      hrv_during: result.hrv_timeline.during.mean,
      occurrences: result.occurrences,
    },
    type: 'correlation',
  }
}

interface SummaryVisibility {
  showMeditation: boolean
  showSleep: boolean
  showWorkouts: boolean
}

/** The same roll-up as an activity type card over the window, so the two always agree. */
const summarizeActivities = async (
  user: string,
  range: Range,
  visibility: SummaryVisibility,
): Promise<ActivitySummaryData> => {
  const rollUp = (type: string, visible: boolean) =>
    visible
      ? getActivityTypeSummary(user, type, { end: range.end.toISOString(), start: range.start.toISOString() })
      : null
  const [exercise, meditation, sleep] = await Promise.all([
    rollUp('exercise', visibility.showWorkouts),
    rollUp('meditation', visibility.showMeditation),
    rollUp('sleep', visibility.showSleep),
  ])
  return {
    exercise: exercise && { count: exercise.count, total_minutes: exercise.total_minutes },
    meditation: meditation && { count: meditation.count, total_minutes: meditation.total_minutes },
    sleep: sleep && {
      avg_hours: sleep.sleep ? sleep.sleep.avg_minutes / 60 : null,
      count: sleep.count,
    },
  }
}

type SessionFigures = NonNullable<ActivitySummaryData['exercise']>
type SleepFigures = NonNullable<ActivitySummaryData['sleep']>

const sessionsWithPrevious = (current: SessionFigures | null, previous: SessionFigures | null) =>
  current && {
    ...current,
    previous_count: previous?.count ?? null,
    previous_total_minutes: previous?.total_minutes ?? null,
  }

const sleepWithPrevious = (current: SleepFigures | null, previous: SleepFigures | null) =>
  current && {
    ...current,
    previous_avg_hours: previous?.avg_hours ?? null,
    previous_count: previous?.count ?? null,
  }

const withPrevious = (current: ActivitySummaryData, previous: ActivitySummaryData): ActivitySummaryData => ({
  exercise: sessionsWithPrevious(current.exercise, previous.exercise),
  meditation: sessionsWithPrevious(current.meditation, previous.meditation),
  sleep: sleepWithPrevious(current.sleep, previous.sleep),
})

const resolveActivitySummary = async (
  user: string,
  config: Extract<DashboardWidget, { type: 'activity_summary' }>['config'],
  options: ResolveOptions,
): Promise<WidgetData> => {
  const visibility: SummaryVisibility = {
    showMeditation: config.show_meditation ?? true,
    showSleep: config.show_sleep ?? true,
    showWorkouts: config.show_workouts ?? true,
  }

  // Nothing visible → emit nothing (no DB read, no exposure).
  if (!visibility.showWorkouts && !visibility.showSleep && !visibility.showMeditation) {
    return { data: { exercise: null, meditation: null, sleep: null }, type: 'activity_summary' }
  }

  const summarize = (range: Range) => summarizeActivities(user, range, visibility)
  const [current, previous] = await Promise.all([
    summarize(windowOf(options, config.lookback_days ?? 7)),
    options.previous ? summarize(inclusiveRange(options.previous)) : undefined,
  ])
  return { data: previous ? withPrevious(current, previous) : current, type: 'activity_summary' }
}

const resolveHrZones = async (
  user: string,
  config: Extract<DashboardWidget, { type: 'hr_zones' }>['config'],
  options: ResolveOptions,
): Promise<WidgetData> => {
  const { end, start } = windowOf(options, config.lookback_days ?? 7)
  const previousRange = options.previous ? inclusiveRange(options.previous) : undefined
  const [summary, previousSummary, hr] = await Promise.all([
    getPeriodSummary(user, [...hrZoneMetrics], start, end),
    previousRange
      ? getPeriodSummary(user, [...hrZoneMetrics], previousRange.start, previousRange.end)
      : undefined,
    getEffectiveHrZones(user),
  ])
  const avgOf = (metrics: { avg: number; count: number; metric: string }[], metric: string) => {
    const stats = metrics.find((m) => m.metric === metric)
    return stats !== undefined && stats.count > 0 ? stats.avg : null
  }
  const zones = hrZoneMetrics.map((metric) => ({
    avg_seconds: avgOf(summary.metrics, metric),
    metric,
    ...(previousSummary ? { previous_avg_seconds: avgOf(previousSummary.metrics, metric) } : {}),
  }))
  const hrZoneStart = [hr.zones[1], hr.zones[2], hr.zones[3], hr.zones[4], hr.zones[5]]
  return { data: { hr_zone_start: hrZoneStart, zones }, type: 'hr_zones' }
}

const resolveGoalProgress = async (user: string): Promise<WidgetData> => {
  const goals = await getGoalsProgress(user)
  return { data: { goals }, type: 'goal_progress' }
}

/** Resolve one widget to its minimal data payload. */
// eslint-disable-next-line complexity -- one arm per widget type
const resolveWidget = async (
  user: string,
  widget: DashboardWidget,
  tz: string,
  options: ResolveOptions,
): Promise<WidgetData> => {
  switch (widget.type) {
    case 'metric_card':
      return resolveMetricCard(user, widget.config, options)
    case 'sparkline_card':
      return resolveSparklineCard(user, widget.config, options)
    case 'trend_chart':
      return resolveTrendChart(user, widget.config, tz, options)
    case 'bar_chart':
      return resolveBarChart(user, widget.config, tz, options)
    case 'correlation':
      return resolveCorrelation(user, widget.config, options)
    case 'activity_summary':
      return resolveActivitySummary(user, widget.config, options)
    case 'hr_zones':
      return resolveHrZones(user, widget.config, options)
    case 'goal_progress':
      return options.window ? { data: null, type: 'goal_progress' } : resolveGoalProgress(user)
    case 'last_sleep':
      return { data: options.window ? null : await getLatestSleep(user), type: 'last_sleep' }
    case 'combined_chart':
      return resolveCombinedChart(user, widget.config, tz, options)
    case 'record_card':
      return resolveRecordCard(user, widget.config, options)
    case 'activity_type_card':
      return resolveActivityTypeCard(user, widget.config, options)
    case 'top_list_card':
      return resolveTopListCard(user, widget.config, tz, options)
    case 'places_card':
      return resolvePlacesCard(user, widget.config, tz, options)
    case 'quick_link':
      return { data: null, type: 'quick_link' }
  }
}

/** Null-data fallback for a widget whose resolver threw. */
// eslint-disable-next-line complexity -- one arm per widget type
const nullData = (type: DashboardWidget['type']): WidgetData => {
  switch (type) {
    case 'metric_card':
      return { data: null, type }
    case 'sparkline_card':
      return { data: null, type }
    case 'trend_chart':
      return { data: null, type }
    case 'bar_chart':
      return { data: null, type }
    case 'correlation':
      return { data: null, type }
    case 'activity_summary':
      return { data: null, type }
    case 'hr_zones':
      return { data: null, type }
    case 'goal_progress':
      return { data: null, type }
    case 'last_sleep':
      return { data: null, type }
    case 'combined_chart':
      return { data: null, type }
    case 'record_card':
      return { data: null, type }
    case 'activity_type_card':
      return { data: null, type }
    case 'top_list_card':
      return { data: null, type }
    case 'places_card':
      return { data: null, type }
    case 'quick_link':
      return { data: null, type }
  }
}

/**
 * Upper bound on widgets resolved for a single public dashboard. Bounds the
 * fan-out of unauthenticated, cached public requests against the owner's
 * per-user DB. Real dashboards are far smaller; excess widgets are dropped with
 * a logged warning rather than silently.
 */
const MAX_RESOLVED_WIDGETS = 60

/**
 * Resolve all widget data for a stored dashboard config, keyed by widget id.
 * Each widget resolves independently; a failure yields a null-data entry rather
 * than failing the whole dashboard.
 */
export const resolveDashboardData = async (
  user: string,
  config: DashboardConfig,
  options: ResolveOptions = {},
): Promise<WidgetDataMap> => {
  const allWidgets = config.sections.flatMap((section) => section.widgets)
  if (allWidgets.length > MAX_RESOLVED_WIDGETS) {
    console.warn(
      `Dashboard for ${user} has ${allWidgets.length} widgets; resolving only the first ${MAX_RESOLVED_WIDGETS}.`,
    )
  }
  const widgets = allWidgets.slice(0, MAX_RESOLVED_WIDGETS)
  const tz = await getUserTimezone(user)
  const entries = await Promise.all(
    widgets.map(async (widget): Promise<[string, WidgetData]> => {
      try {
        return [widget.id, await resolveWidget(user, widget, tz, options)]
      } catch (error) {
        console.warn(`Failed to resolve widget ${widget.id} (${widget.type}):`, error)
        return [widget.id, nullData(widget.type)]
      }
    }),
  )
  return Object.fromEntries(entries)
}

export interface PeriodDashboardData {
  period: string
  widget_data: WidgetDataMap
  window: PeriodWindow
}

export const resolvePeriodDashboard = async (
  user: string,
  config: DashboardConfig,
  periodKey?: string,
  now: Date = new Date(),
): Promise<PeriodDashboardData> => {
  if (!config.period) throw new Error('resolvePeriodDashboard needs a period dashboard')
  const { granularity } = config.period
  const tz = await getUserTimezone(user)
  const period = periodKey ?? latestFinishedPeriodKey(granularity, now, tz)
  const periodGranularity = periodGranularityOf(period)
  if (periodGranularity === null) throw new PeriodError('invalid')
  if (periodGranularity !== granularity) throw new PeriodError('granularity_mismatch')
  if (!isFinishedPeriod(period, now, tz)) throw new PeriodError('not_finished')

  const window = periodWindow(period, tz)
  const widget_data = await resolveDashboardData(user, config, {
    previous: previousWindow(period, tz),
    window,
  })
  return {
    period,
    widget_data,
    window: { end: window.end.toISOString(), start: window.start.toISOString() },
  }
}

export interface DashboardView {
  period: string | null
  widget_data: WidgetDataMap
  window: PeriodWindow | null
}

/** A period dashboard over `periodKey` (or its latest finished period); a rolling one as it stands. */
export const resolveDashboardView = async (
  user: string,
  config: DashboardConfig,
  periodKey?: string,
): Promise<DashboardView> =>
  config.period
    ? resolvePeriodDashboard(user, config, periodKey)
    : { period: null, widget_data: await resolveDashboardData(user, config), window: null }
