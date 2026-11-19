import type { DashboardConfig } from '@aurboda/api-spec'

/** The config with one day overview's `visible_to_visitors` set; any other widget id leaves it as it is. */
export const setVisibleToVisitors = (
  config: DashboardConfig,
  widgetId: string,
  visible: boolean,
): DashboardConfig => ({
  ...config,
  sections: config.sections.map((section) => ({
    ...section,
    widgets: section.widgets.map((widget) =>
      widget.id === widgetId && widget.type === 'day_overview'
        ? { ...widget, config: { ...widget.config, visible_to_visitors: visible } }
        : widget,
    ),
  })),
})
