import type { MeasureGoal } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  newMeasureGoal,
  setActivityType,
  setAggregation,
  setExerciseFilter,
  setMeasure,
} from './measureGoalEdits'

const ID = 'a0000001-0000-4000-8000-000000000001'

const goal: MeasureGoal = {
  activity_type: 'strength_training',
  aggregation: 'max',
  filter_field: 'sets.exercise',
  filter_value: 'Squat',
  goal_type: 'measure',
  id: ID,
  measure: 'e1rm',
  min: 100,
  window: '30d',
}

describe('newMeasureGoal', () => {
  test('strength training when it is measurable, best e1RM over 30 days', () => {
    expect(newMeasureGoal([{ name: 'climbing' }, { name: 'strength_training' }], ID)).toEqual({
      activity_type: 'strength_training',
      aggregation: 'max',
      goal_type: 'measure',
      id: ID,
      measure: 'e1rm',
      window: '30d',
    })
  })

  test('else the first measurable type', () => {
    expect(newMeasureGoal([{ name: 'climbing' }, { name: 'rowing' }], ID)?.activity_type).toBe('climbing')
  })

  test('none without a measurable type', () => {
    expect(newMeasureGoal([], ID)).toBeUndefined()
  })
})

describe('setActivityType', () => {
  test('changes the type and drops the item filter, which belonged to the old one', () => {
    const next = setActivityType(goal, 'climbing')
    expect(next.activity_type).toBe('climbing')
    expect(next).not.toHaveProperty('filter_field')
    expect(next).not.toHaveProperty('filter_value')
    expect(next.min).toBe(100)
  })
})

describe('setExerciseFilter', () => {
  test('sets the path and the value together', () => {
    const next = setExerciseFilter(
      { ...goal, filter_field: undefined, filter_value: undefined },
      'sets.exercise',
      'Bench',
    )
    expect(next).toMatchObject({ filter_field: 'sets.exercise', filter_value: 'Bench' })
  })

  test('All, or no path, clears both', () => {
    for (const next of [
      setExerciseFilter(goal, 'sets.exercise', ''),
      setExerciseFilter(goal, undefined, 'Bench'),
    ]) {
      expect(next).not.toHaveProperty('filter_field')
      expect(next).not.toHaveProperty('filter_value')
    }
  })
})

describe('setMeasure', () => {
  test("resets the aggregation to the measure's default", () => {
    expect(setMeasure(goal, 'volume')).toMatchObject({ aggregation: 'sum', measure: 'volume' })
    expect(setMeasure({ ...goal, aggregation: 'sum' }, 'max_time')).toMatchObject({
      aggregation: 'max',
      measure: 'max_time',
    })
  })
})

describe('setAggregation', () => {
  test('keeps the measure', () => {
    expect(setAggregation(goal, 'sum')).toMatchObject({ aggregation: 'sum', measure: 'e1rm' })
  })
})
