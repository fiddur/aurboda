import type { SharedExerciseData } from '@aurboda/api-spec'

import { activityMeasureLabels } from '@aurboda/api-spec'

type PerWeek = SharedExerciseData['per_week']
type Trend = SharedExerciseData['trend']

export const exerciseChartTitle = (perWeek: PerWeek, trend: Trend): string | null => {
  if (perWeek) return activityMeasureLabels[perWeek.measure]
  return trend ? 'Trend' : null
}

/** The trend drawn as a line over the weekly bars: only when both track the same measure. */
export const exerciseLineTrend = (perWeek: PerWeek, trend: Trend): NonNullable<Trend> | undefined =>
  trend && perWeek && trend.measure === perWeek.measure ? trend : undefined
