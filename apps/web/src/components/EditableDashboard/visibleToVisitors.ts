import type { DashboardConfig } from '@aurboda/api-spec'

export const setVisibleToVisitors = (
  config: DashboardConfig,
  widgetId: string,
  visible: boolean,
): DashboardConfig => ({
  ...config,
  sections: config.sections.map((section) => ({
    ...section,
    widgets: section.widgets.map((widget) => {
      if (widget.id !== widgetId) return widget
      if (widget.type === 'day_overview') {
        return { ...widget, config: { ...widget.config, visible_to_visitors: visible } }
      }
      if (widget.type === 'recent_activities') {
        return { ...widget, config: { ...widget.config, visible_to_visitors: visible } }
      }
      return widget
    }),
  })),
})
