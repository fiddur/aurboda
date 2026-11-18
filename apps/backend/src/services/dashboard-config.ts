import { type BarChartConfig, chartFilterError, type DashboardConfig } from '@aurboda/api-spec'

type BarsFilter = Pick<BarChartConfig, 'breakdown_fields' | 'filter_field' | 'filter_value' | 'measure'>

const barsFilterError = (bars: BarsFilter): string | undefined =>
  chartFilterError(bars.filter_field, bars.filter_value, bars.breakdown_fields, bars.measure)

/** Not a refinement of `barChartConfigSchema`: the combined chart's bars layer `.omit()`s and `.extend()`s it. */
export const dashboardConfigError = (config: DashboardConfig): string | undefined => {
  for (const widget of config.sections.flatMap((section) => section.widgets)) {
    const bars =
      widget.type === 'bar_chart'
        ? [widget.config]
        : widget.type === 'combined_chart'
          ? widget.config.layers.filter((layer) => layer.kind === 'bars')
          : []
    for (const layer of bars) {
      const error = barsFilterError(layer)
      if (error) return error
    }
  }
  return undefined
}

/**
 * Strip viewer-useless / internal fields from a config before exposing it.
 * Quick links point into the owner's private app, so neutralize their hrefs.
 * A day overview shows a whole day hour by hour, more than a shared dashboard
 * exposes, so it is left out.
 */
export const sanitizeConfig = (config: DashboardConfig): DashboardConfig => ({
  // Author prose is meant for public viewers — preserve it (section descriptions
  // survive via the section spread below).
  description: config.description,
  ...(config.period ? { period: config.period } : {}),
  sections: config.sections.map((section) => ({
    ...section,
    widgets: section.widgets
      .filter((widget) => widget.type !== 'day_overview')
      .map((widget) =>
        widget.type === 'quick_link' ? { ...widget, config: { ...widget.config, href: '#' } } : widget,
      ),
  })),
  version: config.version,
})
