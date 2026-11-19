import type { DashboardWidget } from '@aurboda/api-spec'

const periodlessWidgetTypes: ReadonlySet<DashboardWidget['type']> = new Set([
  'day_overview',
  'goal_progress',
  'last_sleep',
  'sleep_debt',
])

/** Whether a widget type means anything for a past calendar period. */
export const appliesToPeriod = (type: DashboardWidget['type']): boolean => !periodlessWidgetTypes.has(type)

/** The widget types offered for a section: those of its kind, on a period dashboard only those with a period meaning. */
export const offeredWidgetTypes = <T extends { type: DashboardWidget['type'] }>(
  templates: T[],
  periodMode: boolean,
): T[] => templates.filter((t) => !periodMode || appliesToPeriod(t.type))
