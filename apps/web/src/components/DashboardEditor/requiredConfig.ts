import type { DashboardWidget } from '@aurboda/api-spec'

type WidgetType = DashboardWidget['type']

const requiredText: Partial<Record<WidgetType, readonly string[]>> = {
  activity_type_card: ['pattern'],
  correlation: ['activity'],
  metric_card: ['metric', 'title'],
  quick_link: ['href', 'label'],
  record_card: ['pattern'],
  sparkline_card: ['metric'],
  trend_chart: ['pattern'],
}

/** A journal trend takes no pattern: the journal is its source. */
const journalTrend = (type: WidgetType, config: Record<string, unknown>): boolean =>
  type === 'trend_chart' && config.source_type === 'journal'

/** The `min(1)` text fields of a widget's config schema that are still blank, which saving the dashboard would reject. */
export const blankRequiredFields = (type: WidgetType, config: Record<string, unknown>): string[] =>
  (journalTrend(type, config) ? [] : (requiredText[type] ?? [])).filter((key) => {
    const value = config[key]
    return typeof value !== 'string' || !value.trim()
  })
