import {
  type ActivityMeasure,
  exerciseMuscleInfo,
  measureGoalTitle,
  muscleGroupFilter,
} from '@aurboda/api-spec'

import { toDisplayName } from '../../utils/displayName'

interface ChartSource {
  filter_field?: string
  filter_value?: string
  measure?: ActivityMeasure
  pattern?: string
  source_type: string
}

/** What a chart's filter reads as: the exercise, or a muscle group's display name. */
export const filterSubject = (filter_field?: string, filter_value?: string): string | undefined => {
  const muscle = muscleGroupFilter(filter_field, filter_value)
  return muscle ? exerciseMuscleInfo[muscle.group].name : filter_value
}

/** `Bench Press · Best e1RM` or `Chest · Sets` for an activity-measure chart; undefined for any other source. */
export const measureChartTitle = ({
  filter_field,
  filter_value,
  measure,
  pattern,
  source_type,
}: ChartSource): string | undefined => {
  if (source_type !== 'activity_type' || (measure === undefined && filter_value === undefined)) {
    return undefined
  }
  const typeName = pattern ? toDisplayName(pattern) : undefined
  const subject = filterSubject(filter_field, filter_value)
  return measure ? measureGoalTitle(measure, subject, typeName) : (subject ?? typeName)
}
