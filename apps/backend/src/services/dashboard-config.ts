import {
  type BarChartConfig,
  chartFilterError,
  type CombinedChartLayer,
  type DashboardConfig,
  type DashboardWidget,
  journalChartError,
  type TrendChartConfig,
} from '@aurboda/api-spec'

type BarsFilter = Pick<BarChartConfig, 'breakdown_fields' | 'filter_field' | 'filter_value' | 'measure'>

const barsFilterError = (bars: BarsFilter): string | undefined =>
  chartFilterError(bars.filter_field, bars.filter_value, bars.breakdown_fields, bars.measure)

type ChartSource =
  | ({ kind: 'bars' } & (BarChartConfig | Extract<CombinedChartLayer, { kind: 'bars' }>))
  | ({ kind: 'trend' } & (TrendChartConfig | Extract<CombinedChartLayer, { kind: 'trend' }>))

const chartSources = (widget: DashboardWidget): ChartSource[] => {
  if (widget.type === 'bar_chart') return [{ ...widget.config, kind: 'bars' }]
  if (widget.type === 'trend_chart') return [{ ...widget.config, kind: 'trend' }]
  if (widget.type === 'combined_chart') return widget.config.layers
  return []
}

const chartSourceError = (source: ChartSource): string | undefined =>
  journalChartError(source) ?? (source.kind === 'bars' ? barsFilterError(source) : undefined)

/**
 * The first rule a stored chart breaks, with the message the chart endpoints give. Not a refinement of
 * the chart config schemas: the combined chart's layers `.omit()` and `.extend()` them.
 */
export const dashboardConfigError = (config: DashboardConfig): string | undefined =>
  config.sections
    .flatMap((section) => section.widgets)
    .flatMap(chartSources)
    .map(chartSourceError)
    .find((error) => error !== undefined)

/**
 * A day overview and a latest activities card show what the owner did and when, so visitors see them
 * only when the owner opted in; a stored config without the flag keeps them private. The owner's own
 * reads always get the latest activities card, and a day overview only with its flag.
 */
export const isShownToVisitors = (widget: DashboardWidget): boolean =>
  (widget.type !== 'day_overview' && widget.type !== 'recent_activities') ||
  widget.config.visible_to_visitors === true

export type DashboardViewer = 'owner' | 'visitor'

export const isResolvedFor = (widget: DashboardWidget, viewer: DashboardViewer): boolean =>
  isShownToVisitors(widget) || (viewer === 'owner' && widget.type === 'recent_activities')

/**
 * Strip viewer-useless / internal fields from a config before exposing it.
 * Quick links point into the owner's private app, so neutralize their hrefs.
 * Widgets not shown to visitors are left out.
 */
export const sanitizeConfig = (config: DashboardConfig): DashboardConfig => ({
  // Author prose is meant for public viewers — preserve it (section descriptions
  // survive via the section spread below).
  description: config.description,
  ...(config.period ? { period: config.period } : {}),
  sections: config.sections.map((section) => ({
    ...section,
    widgets: section.widgets
      .filter(isShownToVisitors)
      .map((widget) =>
        widget.type === 'quick_link' ? { ...widget, config: { ...widget.config, href: '#' } } : widget,
      ),
  })),
  version: config.version,
})
