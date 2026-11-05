import { type ActivityMeasure, measureGoalTitle } from '@aurboda/api-spec'

import { toDisplayName } from '../../utils/displayName'

interface ChartSource {
  filter_value?: string
  measure?: ActivityMeasure
  pattern?: string
  source_type: string
}

/** `Bench Press · Best e1RM` for an activity-measure chart; undefined for any other source. */
export const measureChartTitle = ({
  filter_value,
  measure,
  pattern,
  source_type,
}: ChartSource): string | undefined => {
  if (source_type !== 'activity_type' || (measure === undefined && filter_value === undefined))
    {return undefined}
  const typeName = pattern ? toDisplayName(pattern) : undefined
  return measure ? measureGoalTitle(measure, filter_value, typeName) : (filter_value ?? typeName)
}
