import type { DashboardWidget } from '@aurboda/api-spec'

type WidgetType = DashboardWidget['type']

const requiredText: Partial<Record<WidgetType, readonly string[]>> = {
  correlation: ['activity'],
  metric_card: ['metric', 'title'],
  quick_link: ['href', 'label'],
  record_card: ['pattern'],
  sparkline_card: ['metric'],
  trend_chart: ['pattern'],
}

/** The `min(1)` text fields of a widget's config schema that are still blank, which saving the dashboard would reject. */
export const blankRequiredFields = (type: WidgetType, config: Record<string, unknown>): string[] =>
  (requiredText[type] ?? []).filter((key) => {
    const value = config[key]
    return typeof value !== 'string' || !value.trim()
  })
