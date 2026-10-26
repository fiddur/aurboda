import type { ActivityMeasure, MeasureGoal, MeasureGoalAggregation } from '@aurboda/api-spec'

import { defaultAggregation } from '../utils/measures'

type FilterlessGoal = Omit<MeasureGoal, 'filter_field' | 'filter_value'>

const withoutFilter = ({
  filter_field: _field,
  filter_value: _value,
  ...goal
}: MeasureGoal): FilterlessGoal => goal

/** A new goal on the best e1RM over 30 days, of strength training when it is among the measurable types. */
export const newMeasureGoal = (measurableTypes: { name: string }[], id: string): MeasureGoal | undefined => {
  const type = measurableTypes.find((t) => t.name === 'strength_training') ?? measurableTypes[0]
  return (
    type && {
      activity_type: type.name,
      aggregation: 'max',
      goal_type: 'measure',
      id,
      measure: 'e1rm',
      window: '30d',
    }
  )
}

export const setActivityType = (goal: MeasureGoal, activity_type: string): MeasureGoal => ({
  ...withoutFilter(goal),
  activity_type,
})

/** An empty value is the "All" choice. */
export const setExerciseFilter = (goal: MeasureGoal, path: string | undefined, value: string): MeasureGoal =>
  path && value ? { ...goal, filter_field: path, filter_value: value } : withoutFilter(goal)

export const setMeasure = (goal: MeasureGoal, measure: ActivityMeasure): MeasureGoal => ({
  ...goal,
  aggregation: defaultAggregation(measure),
  measure,
})

export const setAggregation = (goal: MeasureGoal, aggregation: MeasureGoalAggregation): MeasureGoal => ({
  ...goal,
  aggregation,
})
