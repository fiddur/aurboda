import type { DashboardConfig, DashboardSection, DashboardWidget, DataPresence } from '@aurboda/api-spec'

import { contextualHrvMetrics, hrZoneMetrics } from '@aurboda/api-spec'

export interface WidgetSources {
  metrics: string[]
  activity_types: string[]
}

const derivedMetrics: Record<string, string> = {
  hrv_7day: 'hrv_rmssd',
  hrv_30day: 'hrv_rmssd',
  rhr_7day: 'resting_heart_rate',
  rhr_30day: 'resting_heart_rate',
  zone2_weekly: 'heart_rate',
}

/** The metric a widget's metric is read from: zones come from heart rate, contextual HRV from hrv_rmssd. */
export const storedMetric = (metric: string): string => {
  if ((hrZoneMetrics as readonly string[]).includes(metric)) return 'heart_rate'
  if ((contextualHrvMetrics as readonly string[]).includes(metric)) return 'hrv_rmssd'
  return derivedMetrics[metric] ?? metric
}

const metricSource = (metric: string): WidgetSources => ({
  activity_types: [],
  metrics: [storedMetric(metric)],
})
const typeSource = (...types: string[]): WidgetSources => ({ activity_types: types, metrics: [] })

const chartSource = (sourceType: string, pattern: string | undefined): WidgetSources | null => {
  if (!pattern) return null
  if (sourceType === 'metric') return metricSource(pattern)
  if (sourceType === 'activity_type') return typeSource(pattern)
  return null
}

const merge = (sources: (WidgetSources | null)[]): WidgetSources | null =>
  sources.some((s) => s === null)
    ? null
    : {
        activity_types: sources.flatMap((s) => s!.activity_types),
        metrics: sources.flatMap((s) => s!.metrics),
      }

/** The metrics and activity types a widget draws from; null for one whose source cannot be told (tags, places, links), which is always shown. */
// eslint-disable-next-line complexity -- one arm per widget type
export const widgetSources = (widget: DashboardWidget): WidgetSources | null => {
  switch (widget.type) {
    case 'metric_card':
    case 'sparkline_card':
      return metricSource(widget.config.metric)
    case 'hr_zones':
      return metricSource('heart_rate')
    case 'trend_chart':
    case 'bar_chart':
      return chartSource(widget.config.source_type, widget.config.pattern)
    case 'combined_chart':
      return merge(widget.config.layers.map((layer) => chartSource(layer.source_type, layer.pattern)))
    case 'record_card':
    case 'activity_type_card':
      return typeSource(widget.config.pattern)
    case 'last_sleep':
      return typeSource('sleep')
    case 'activity_summary': {
      const { show_meditation = true, show_sleep = true, show_workouts = true } = widget.config
      const types = [show_workouts && 'exercise', show_sleep && 'sleep', show_meditation && 'meditation']
      const shown = types.filter((t): t is string => Boolean(t))
      return shown.length > 0 ? typeSource(...shown) : null
    }
    default:
      return null
  }
}

const allWidgets = (config: DashboardConfig): DashboardWidget[] => config.sections.flatMap((s) => s.widgets)

/** Every source the dashboard's widgets draw from, sorted and without duplicates, for one existence query. */
export const dashboardSources = (config: DashboardConfig): WidgetSources => {
  const all = allWidgets(config).flatMap((w) => {
    const sources = widgetSources(w)
    return sources ? [sources] : []
  })
  return {
    activity_types: [...new Set(all.flatMap((s) => s.activity_types))].sort(),
    metrics: [...new Set(all.flatMap((s) => s.metrics))].sort(),
  }
}

/** Widgets none of whose sources has ever delivered anything. A source missing from `presence` counts as delivered. */
export const waitingWidgetIds = (config: DashboardConfig, presence: DataPresence): Set<string> =>
  new Set(
    allWidgets(config)
      .filter((w) => {
        const sources = widgetSources(w)
        if (!sources) return false
        return (
          sources.metrics.every((m) => presence.metrics[m] === false) &&
          sources.activity_types.every((t) => presence.activity_types[t] === false)
        )
      })
      .map((w) => w.id),
  )

/** Each section without its waiting widgets; a section left with none goes, while one that was empty stays. */
export const visibleSections = (
  sections: DashboardSection[],
  waiting: ReadonlySet<string>,
): DashboardSection[] =>
  waiting.size === 0
    ? sections
    : sections.flatMap((section) => {
        const widgets = section.widgets.filter((w) => !waiting.has(w.id))
        return section.widgets.length > 0 && widgets.length === 0 ? [] : [{ ...section, widgets }]
      })
