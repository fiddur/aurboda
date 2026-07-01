/**
 * Pure helpers for updating an existing board chart widget in place from the
 * chart page. Kept separate from the component so they can be unit-tested.
 */
import type { DashboardConfig, DashboardWidget } from '@aurboda/api-spec'

import type { ChartOrigin } from '../../utils/chart-url'

/** Read the origin of a board chart from the chart page's query params. */
export function parseChartOrigin(query: Record<string, string>): ChartOrigin | null {
  const { board_id, section_id, widget_id } = query
  if (!board_id || !section_id || !widget_id) return null
  return { board_id, section_id, widget_id }
}

/**
 * App path of the board a chart update should return to: the home dashboard at
 * `/`, or the owner's shared dashboard at `/u/<username>/<slug>`.
 */
export function boardReturnPath(
  origin: ChartOrigin,
  username: string | undefined,
  slug: string | undefined,
): string {
  if (origin.board_id === 'home') return '/'
  return `/u/${encodeURIComponent(username ?? '')}/${slug ?? ''}`
}

/** Existing display title of a chart widget, if any (used to pre-fill the update form). */
export function chartWidgetTitle(widget: DashboardWidget): string | undefined {
  if (widget.type === 'trend_chart' || widget.type === 'bar_chart') return widget.config.title
  return undefined
}

/**
 * Return a new config with the widget matching `widgetId` in section `sectionId`
 * replaced by `widget`. Other sections and widgets are left untouched.
 */
export function replaceWidgetInConfig(
  config: DashboardConfig,
  sectionId: string,
  widgetId: string,
  widget: DashboardWidget,
): DashboardConfig {
  return {
    ...config,
    sections: config.sections.map((section) =>
      section.id === sectionId
        ? { ...section, widgets: section.widgets.map((w) => (w.id === widgetId ? widget : w)) }
        : section,
    ),
  }
}
