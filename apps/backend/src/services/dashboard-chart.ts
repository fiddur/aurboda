/**
 * The chart a public dashboard's link-preview card draws: its first trend chart or sparkline card
 * whose data draws a line, resolved by the same shared-dashboard resolver its public page uses and
 * drawn by the feed's line renderer (`buildChartSvg`).
 */
import type { DashboardConfig, DashboardSection, DashboardWidget, WidgetData } from '@aurboda/api-spec'

import { getMetricDisplayName, measureGoalTitle } from '@aurboda/api-spec'

import type { SharedDashboardRecord } from '../db/index.ts'
import type { DashboardView } from './shared-dashboard-data.ts'

import { isDrawablePostChart, type PostChart } from './charts/post-chart-svg.ts'
import { publicPeriodFor } from './period-lock.ts'
import { PeriodError } from './periods.ts'

/** The web's colours: `CHART_PRIMARY` for a trend, the sparkline card's default blue. */
const TREND_COLOR = '#2b9ea7'
const SPARKLINE_COLOR = '#3b82f6'

/** Each try resolves a widget's data; a card for a board of empty charts should not resolve them all. */
const MAX_WIDGET_TRIES = 3

type ChartableWidget = Extract<DashboardWidget, { type: 'sparkline_card' | 'trend_chart' }>

const isChartable = (widget: DashboardWidget): widget is ChartableWidget =>
  widget.type === 'trend_chart' || widget.type === 'sparkline_card'

/** The colour lands in an SVG attribute, so only a plain hex colour is taken from the config. */
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

const lineColor = (color: string | undefined, fallback: string): string =>
  color !== undefined && HEX_COLOR.test(color) ? color : fallback

/** The widgets a card tries, in board order, each with the section it sits in. */
export const chartableWidgets = (
  config: DashboardConfig,
): { section: DashboardSection; widget: ChartableWidget }[] =>
  config.sections
    .flatMap((section) => section.widgets.filter(isChartable).map((widget) => ({ section, widget })))
    .slice(0, MAX_WIDGET_TRIES)

/**
 * A widget's resolved data as a line, captioned with the title the web widget shows; null for data
 * of another widget, none at all, a broken-down trend (its lines are per series, its `history`
 * empty) or under two points.
 */
export const widgetChart = (widget: ChartableWidget, data: WidgetData | undefined): PostChart | null => {
  const chart = ((): PostChart | null => {
    if (widget.type === 'trend_chart' && data?.type === 'trend_chart' && data.data) {
      const { filter_value, measure, pattern, title } = widget.config
      return {
        opts: {
          color: TREND_COLOR,
          label: title ?? (measure ? measureGoalTitle(measure, filter_value, pattern) : `${pattern} trend`),
        },
        series: data.data.history.map((p): [Date, number] => [new Date(p.date), p.value]),
        type: 'line',
      }
    }
    if (widget.type === 'sparkline_card' && data?.type === 'sparkline_card' && data.data) {
      const { color, metric, title } = widget.config
      return {
        opts: { color: lineColor(color, SPARKLINE_COLOR), label: title ?? getMetricDisplayName(metric) },
        series: data.data.series.map((p): [Date, number] => [new Date(p.time), p.value]),
        type: 'line',
      }
    }
    return null
  })()
  return chart != null && isDrawablePostChart(chart) ? chart : null
}

/** The board cut down to one widget, so only that widget's data is resolved. */
const singleWidgetConfig = (
  config: DashboardConfig,
  section: DashboardSection,
  widget: DashboardWidget,
): DashboardConfig => ({ ...config, sections: [{ ...section, widgets: [widget] }] })

export interface DashboardChartDeps {
  getDashboard: (user: string, slug: string) => Promise<SharedDashboardRecord | null>
  getTimezone: (user: string) => Promise<string>
  /** `resolveDashboardView`: a period board over the given period, a rolling one as it stands. */
  resolveView: (user: string, config: DashboardConfig, periodKey?: string) => Promise<DashboardView>
  now?: () => Date
}

/**
 * The card chart of a public dashboard, over the period its lock shows a visitor on a period board;
 * null for a board that is not public, or has no widget that draws. A widget whose resolver failed
 * resolves to null data and is passed over like an empty one.
 */
export const loadPublicDashboardChartWith =
  (deps: DashboardChartDeps) =>
  async (user: string, slug: string): Promise<PostChart | null> => {
    const dashboard = await deps.getDashboard(user, slug)
    if (!dashboard?.is_public) return null
    const candidates = chartableWidgets(dashboard.config)
    if (candidates.length === 0) return null
    const now = deps.now?.() ?? new Date()
    try {
      const period = dashboard.config.period
        ? publicPeriodFor(dashboard, undefined, now, await deps.getTimezone(user))
        : undefined
      for (const { section, widget } of candidates) {
        const view = await deps.resolveView(
          user,
          singleWidgetConfig(dashboard.config, section, widget),
          period,
        )
        const chart = widgetChart(widget, view.widget_data[widget.id])
        if (chart) return chart
      }
      return null
    } catch (error) {
      if (error instanceof PeriodError) return null
      throw error
    }
  }
