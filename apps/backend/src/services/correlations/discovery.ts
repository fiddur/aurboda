/**
 * Selector discovery — lists the data dimensions available to correlate, used
 * to populate the explore UI's trigger/outcome pickers.
 */

import type { CorrelationSelectorsData } from '@aurboda/api-spec'

import { nutrientKeySchema } from '@aurboda/api-spec'

import { getActivityTypeDefinitions, getDistinctMetrics, getScreentimeCategories } from '../../db/index.ts'

/** How far back to look for metrics that actually have data. */
const METRIC_LOOKBACK_DAYS = 365

export const getCorrelationSelectors = async (user: string): Promise<CorrelationSelectorsData> => {
  const end = new Date()
  const start = new Date(end.getTime() - METRIC_LOOKBACK_DAYS * 86_400_000)

  const [metrics, activityTypes, categories] = await Promise.all([
    getDistinctMetrics(user, start, end),
    getActivityTypeDefinitions(user),
    getScreentimeCategories(user),
  ])

  return {
    activity_types: activityTypes.map((t) => ({ label: t.display_name, value: t.name })),
    metrics: metrics.map((m) => ({ label: m, value: m })),
    nutrients: nutrientKeySchema.options.map((n) => ({ label: n, value: n })),
    productivity_categories: categories.map((c) => {
      const path = c.name.join(' > ')
      return { label: path, value: path }
    }),
    // Tags are user-defined (non-builtin) activity types.
    tags: activityTypes.filter((t) => !t.is_builtin).map((t) => ({ label: t.display_name, value: t.name })),
  }
}
