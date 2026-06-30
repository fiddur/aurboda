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
import type { DashboardConfig, DashboardWidget, WidgetData, WidgetDataMap } from '@aurboda/api-spec'

import { hrZoneMetrics, isExerciseActivityType } from '@aurboda/api-spec'

import { getAllActivityTypeNames } from '../db/index.ts'
import { getChartData } from './chart-data.ts'
import { getActivityImpact } from './correlations/activity-impact.ts'
import { getBaseline } from './correlations/baseline.ts'
import { getCustomMetrics } from './custom-metrics.ts'
import { getGoalsProgress } from './goals.ts'
import { getPeriodSummary, queryActivities, queryMetrics } from './queries/index.ts'
import { getEffectiveHrZones } from './settings.ts'
import { getTrend } from './trends.ts'

/** Widget metric names that map to a different stored metric name. */
const metricToApiMetric: Record<string, string> = { zone2_weekly: 'hr_zone_2_sec' }

const baselineMetrics = new Set(['hrv_7day', 'hrv_30day', 'rhr_7day', 'rhr_30day'])

/** A simple lookback window ending now. */
const lookbackRange = (days: number): { start: Date; end: Date } => {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - days)
  return { end, start }
}

const resolveMetricCard = async (
  user: string,
  config: Extract<DashboardWidget, { type: 'metric_card' }>['config'],
): Promise<WidgetData> => {
  const { metric } = config
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
  const { end, start } = lookbackRange(30)
  const summary = await getPeriodSummary(user, [apiMetric], start, end)
  const stats = summary.metrics.find((m) => m.metric === apiMetric)
  const hasData = stats !== undefined && stats.count > 0
  return {
    data: {
      count: stats?.count ?? null,
      max: hasData ? stats.max : null,
      trend_percent: stats?.change_from_previous_period_percent ?? null,
      value: hasData ? stats.avg : null,
    },
    type: 'metric_card',
  }
}

const resolveSparklineCard = async (
  user: string,
  config: Extract<DashboardWidget, { type: 'sparkline_card' }>['config'],
): Promise<WidgetData> => {
  const apiMetric = metricToApiMetric[config.metric] ?? config.metric
  const { end, start } = lookbackRange(config.lookback_days ?? 30)
  const customMetrics = await getCustomMetrics(user)
  const [series, summary] = await Promise.all([
    queryMetrics(user, apiMetric, start, end, customMetrics),
    getPeriodSummary(user, [apiMetric], start, end),
  ])
  const stats = summary.metrics.find((m) => m.metric === apiMetric)
  const hasData = stats !== undefined && stats.count > 0
  return {
    data: {
      count: stats?.count ?? null,
      series: series.data.map((p) => ({ time: p.time, value: p.value })),
      trend_percent: stats?.change_from_previous_period_percent ?? null,
      value: hasData ? stats.avg : null,
    },
    type: 'sparkline_card',
  }
}

const resolveTrendChart = async (
  user: string,
  config: Extract<DashboardWidget, { type: 'trend_chart' }>['config'],
): Promise<WidgetData> => {
  const customMetrics = await getCustomMetrics(user)
  const result = await getTrend(user, {
    aggregation: config.aggregation ?? 'count',
    custom_metrics: customMetrics,
    display_period: config.display_period ?? 'monthly',
    half_life_days: config.half_life_days ?? 15,
    lookback_days: config.lookback_days ?? 90,
    pattern: config.pattern,
    source_type: config.source_type,
  })
  return { data: { current_value: result.current_value, history: result.history }, type: 'trend_chart' }
}

const resolveBarChart = async (
  user: string,
  config: Extract<DashboardWidget, { type: 'bar_chart' }>['config'],
): Promise<WidgetData> => {
  const { end, start } = lookbackRange(config.lookback_days)
  const result = await getChartData(user, {
    activity_type_id: config.tag_definition_id,
    aggregation: config.aggregation ?? 'count',
    bucket_size: config.bucket_size,
    end: end.toISOString(),
    pattern: config.pattern,
    source_type: config.source_type,
    start: start.toISOString(),
  })
  // Drop breakdown buckets — bar widgets only render simple {bucket_start, value}.
  const buckets = result.buckets.flatMap((b) =>
    'value' in b ? [{ bucket_start: b.bucket_start, value: b.value }] : [],
  )
  return { data: { buckets }, type: 'bar_chart' }
}

const resolveCorrelation = async (
  user: string,
  config: Extract<DashboardWidget, { type: 'correlation' }>['config'],
): Promise<WidgetData> => {
  const result = await getActivityImpact(
    user,
    config.activity,
    config.activity_type,
    config.window_minutes ?? 30,
    config.period_days ?? 90,
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

const resolveActivitySummary = async (
  user: string,
  config: Extract<DashboardWidget, { type: 'activity_summary' }>['config'],
): Promise<WidgetData> => {
  const showWorkouts = config.show_workouts ?? true
  const showSleep = config.show_sleep ?? true
  const showMeditation = config.show_meditation ?? true

  // Nothing visible → emit nothing (no DB read, no exposure).
  if (!showWorkouts && !showSleep && !showMeditation) {
    return { data: { exercise: null, meditation: null, sleep: null }, type: 'activity_summary' }
  }

  const { end, start } = lookbackRange(config.lookback_days ?? 7)
  const types = await getAllActivityTypeNames(user)
  const activities = await queryActivities(user, types, start, end)

  // Aggregate to exactly the figures the widget renders — never the raw list.
  const durationMinutes = (a: { start_time: string; end_time?: string }): number =>
    a.end_time ? (new Date(a.end_time).getTime() - new Date(a.start_time).getTime()) / 60000 : 0

  const exercise = activities.filter((a) => isExerciseActivityType(a.activity_type))
  const sleep = activities.filter((a) => a.activity_type === 'sleep')
  const meditation = activities.filter((a) => a.activity_type === 'meditation')

  return {
    data: {
      exercise: showWorkouts
        ? {
            count: exercise.length,
            total_minutes: exercise.reduce((sum, a) => sum + durationMinutes(a), 0),
          }
        : null,
      meditation: showMeditation
        ? {
            count: meditation.length,
            total_minutes: meditation.reduce((sum, a) => sum + durationMinutes(a), 0),
          }
        : null,
      sleep: showSleep
        ? {
            avg_hours:
              sleep.length > 0
                ? sleep.reduce((sum, a) => sum + durationMinutes(a) / 60, 0) / sleep.length
                : null,
            count: sleep.length,
          }
        : null,
    },
    type: 'activity_summary',
  }
}

const resolveHrZones = async (user: string): Promise<WidgetData> => {
  const { end, start } = lookbackRange(7)
  const [summary, hr] = await Promise.all([
    getPeriodSummary(user, [...hrZoneMetrics], start, end),
    getEffectiveHrZones(user),
  ])
  const zones = hrZoneMetrics.map((metric) => {
    const stats = summary.metrics.find((m) => m.metric === metric)
    return { avg_seconds: stats !== undefined && stats.count > 0 ? stats.avg : null, metric }
  })
  const hrZoneStart = [hr.zones[1], hr.zones[2], hr.zones[3], hr.zones[4], hr.zones[5]]
  return { data: { hr_zone_start: hrZoneStart, zones }, type: 'hr_zones' }
}

const resolveGoalProgress = async (user: string): Promise<WidgetData> => {
  const goals = await getGoalsProgress(user)
  return { data: { goals }, type: 'goal_progress' }
}

/** Resolve one widget to its minimal data payload. */
const resolveWidget = async (user: string, widget: DashboardWidget): Promise<WidgetData> => {
  switch (widget.type) {
    case 'metric_card':
      return resolveMetricCard(user, widget.config)
    case 'sparkline_card':
      return resolveSparklineCard(user, widget.config)
    case 'trend_chart':
      return resolveTrendChart(user, widget.config)
    case 'bar_chart':
      return resolveBarChart(user, widget.config)
    case 'correlation':
      return resolveCorrelation(user, widget.config)
    case 'activity_summary':
      return resolveActivitySummary(user, widget.config)
    case 'hr_zones':
      return resolveHrZones(user)
    case 'goal_progress':
      return resolveGoalProgress(user)
    case 'quick_link':
      return { data: null, type: 'quick_link' }
  }
}

/** Null-data fallback for a widget whose resolver threw. */
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
export const resolveDashboardData = async (user: string, config: DashboardConfig): Promise<WidgetDataMap> => {
  const allWidgets = config.sections.flatMap((section) => section.widgets)
  if (allWidgets.length > MAX_RESOLVED_WIDGETS) {
    console.warn(
      `Dashboard for ${user} has ${allWidgets.length} widgets; resolving only the first ${MAX_RESOLVED_WIDGETS}.`,
    )
  }
  const widgets = allWidgets.slice(0, MAX_RESOLVED_WIDGETS)
  const entries = await Promise.all(
    widgets.map(async (widget): Promise<[string, WidgetData]> => {
      try {
        return [widget.id, await resolveWidget(user, widget)]
      } catch (error) {
        console.warn(`Failed to resolve widget ${widget.id} (${widget.type}):`, error)
        return [widget.id, nullData(widget.type)]
      }
    }),
  )
  return Object.fromEntries(entries)
}
