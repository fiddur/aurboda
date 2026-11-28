/**
 * Pure helpers for updating an existing board chart widget in place from the
 * chart page. Kept separate from the component so they can be unit-tested.
 */
import {
  type DashboardConfig,
  type DashboardWidget,
  isPeopleBreakdownField,
  type JournalChartFilters,
  isTagsBreakdownField,
  measureGoalTitle,
} from '@aurboda/api-spec'

import type { ChartOrigin } from '../../utils/chart-url'

import { filterSubject } from '../../components/widgets/chartTitle'
import { tagList } from '../Journal/journal-list'

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

const isNamesField = (field: string): boolean => isPeopleBreakdownField(field) || isTagsBreakdownField(field)

/** What visitors of a shared board would see of a chart saved with this mask: the tag names, the people's names, or neither. */
export const unmaskedNamesWarning = (breakdownFields: string[], masked: string[]): string | undefined => {
  const shown = breakdownFields.filter((f) => isNamesField(f) && !masked.includes(f))
  const tags = shown.some(isTagsBreakdownField)
  const people = shown.some(isPeopleBreakdownField)
  if (!tags && !people) return undefined
  const what = [tags ? 'the tag names' : '', people ? 'the names of the people' : '']
    .filter(Boolean)
    .join(' and ')
  return `Visitors of a shared board with this chart will see ${what}.`
}

/**
 * What visitors of a shared board would see of a journal chart's filters: a shared board's public
 * config carries them, and the generated title names the tags.
 */
export const journalFiltersWarning = ({
  journal_q,
  journal_tags,
  source_type,
}: Pick<JournalChartFilters, 'journal_q' | 'journal_tags'> & { source_type: string }): string | undefined => {
  if (source_type !== 'journal') return undefined
  const what = [
    tagList(journal_tags).length > 0 ? 'the tags it is filtered by (its default title names them)' : '',
    journal_q?.trim() ? 'its search text' : '',
  ]
    .filter(Boolean)
    .join(' and ')
  return what ? `Visitors of a shared board with this chart will see ${what}.` : undefined
}

const chartWidgetBreakdownFields = (widget: DashboardWidget): string[] =>
  widget.type === 'trend_chart' || widget.type === 'bar_chart' ? (widget.config.breakdown_fields ?? []) : []

/**
 * The masked fields a save form starts with: `@people` and `@tags` when the breakdown has them, so
 * names stay off public boards unless the owner unticks them. Updating a widget keeps its own mask,
 * adding each of them only when the widget did not already break down by it.
 */
export function initialMaskedFields(breakdownFields: string[], existing?: DashboardWidget): string[] {
  const names = breakdownFields.filter(isNamesField)
  if (!existing) return names
  const had = chartWidgetBreakdownFields(existing)
  const added = names.filter((f) => !had.includes(f))
  return [...new Set([...chartWidgetMaskedFields(existing), ...added])]
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
