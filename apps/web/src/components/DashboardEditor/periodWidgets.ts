import type { DashboardWidget } from '@aurboda/api-spec'

const periodlessWidgetTypes: ReadonlySet<DashboardWidget['type']> = new Set([
  'day_overview',
  'goal_progress',
  'last_sleep',
  'sleep_debt',
])

/** Types a shared dashboard leaves out (the backend's sanitizeConfig drops them), so its editor does not offer them. */
const unsharedWidgetTypes: ReadonlySet<DashboardWidget['type']> = new Set(['day_overview'])

/** Whether a widget type means anything for a past calendar period. */
export const appliesToPeriod = (type: DashboardWidget['type']): boolean => !periodlessWidgetTypes.has(type)

/** Whether a widget type is shown on a shared dashboard. */
export const appliesToSharedBoard = (type: DashboardWidget['type']): boolean => !unsharedWidgetTypes.has(type)

/**
 * The widget types offered for a section: those of its kind, on a period dashboard only those with a
 * period meaning, and on a shared dashboard only those it shows.
 */
export const offeredWidgetTypes = <T extends { type: DashboardWidget['type'] }>(
  templates: T[],
  periodMode: boolean,
  sharedBoard = false,
): T[] =>
  templates.filter(
    (t) => (!periodMode || appliesToPeriod(t.type)) && (!sharedBoard || appliesToSharedBoard(t.type)),
  )
