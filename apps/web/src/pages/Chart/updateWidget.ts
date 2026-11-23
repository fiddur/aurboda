/**
 * Pure helpers for updating an existing board chart widget in place from the
 * chart page. Kept separate from the component so they can be unit-tested.
 */
import {
  type DashboardConfig,
  type DashboardWidget,
  isPeopleBreakdownField,
  measureGoalTitle,
} from '@aurboda/api-spec'

import type { ChartOrigin } from '../../utils/chart-url'

import { filterSubject } from '../../components/widgets/chartTitle'

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
  return `/u/${encodeURIComponent(username ?? '')}/${encodeURIComponent(slug ?? '')}`
}

/** Display title of a chart widget, if any (used to pre-fill the update form); a measure trend has a default. */
export function chartWidgetTitle(widget: DashboardWidget): string | undefined {
  if (widget.type === 'trend_chart') {
    const { filter_field, filter_value, measure, pattern, title } = widget.config
    return (
      title ??
      (measure ? measureGoalTitle(measure, filterSubject(filter_field, filter_value), pattern) : undefined)
    )
  }
  if (widget.type === 'bar_chart') return widget.config.title
  return undefined
}

/** Breakdown fields the widget currently masks on public boards (used to pre-fill the update form). */
export function chartWidgetMaskedFields(widget: DashboardWidget): string[] {
  if (widget.type === 'trend_chart' || widget.type === 'bar_chart') {
    return widget.config.masked_breakdown_fields ?? []
  }
  return []
}

/** Whether a chart saved with this mask would show the names of who its activities were with. */
export const showsPeopleNames = (breakdownFields: string[], masked: string[]): boolean =>
  breakdownFields.some((f) => isPeopleBreakdownField(f) && !masked.includes(f))

const chartWidgetBreakdownFields = (widget: DashboardWidget): string[] =>
  widget.type === 'trend_chart' || widget.type === 'bar_chart' ? (widget.config.breakdown_fields ?? []) : []

/**
 * The masked fields a save form starts with: `@people` when the breakdown has it, so names stay off
 * public boards unless the owner unticks it. Updating a widget keeps its own mask, adding `@people`
 * only when the widget did not already break down by it.
 */
export function initialMaskedFields(breakdownFields: string[], existing?: DashboardWidget): string[] {
  const people = breakdownFields.filter(isPeopleBreakdownField)
  if (!existing) return people
  const masked = chartWidgetMaskedFields(existing)
  const hadPeople = chartWidgetBreakdownFields(existing).some(isPeopleBreakdownField)
  return hadPeople ? masked : [...new Set([...masked, ...people])]
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
