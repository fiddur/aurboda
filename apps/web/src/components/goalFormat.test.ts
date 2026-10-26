import type { GoalProgress } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { goalFormat, goalLabel, goalValueFormat } from './goalFormat'

const THIN = '\u2009'
const ID = 'a0000001-0000-4000-8000-000000000001'

const metric: GoalProgress = {
  current: 5400,
  goal_type: 'metric',
  id: ID,
  losing_tomorrow: 1800,
  metric: 'hr_zone_2_sec',
  min: 9000,
  unit: 'sec',
  window: '7d',
}

const trend: GoalProgress = {
  current: 0.5,
  display_period: 'monthly',
  display_unit: 'per month',
  goal_type: 'trend',
  id: ID,
  max: 0.7,
  pattern: 'coffee',
  source_type: 'activity_type',
}

const measure: GoalProgress = {
  activity_type: 'strength_training',
  activity_type_name: 'Strength training',
  aggregation: 'max',
  current: 102.5,
  filter_value: 'Bench Press',
  goal_type: 'measure',
  id: ID,
  losing_tomorrow: 2.5,
  measure: 'e1rm',
  min: 110,
  unit: 'kg',
  window: '30d',
}

describe('goalFormat', () => {
  test('metric goals use the metric label, its window and unit', () => {
    const f = goalFormat(metric)
    expect(f.label).toBe('Zone 2')
    expect(f.windowLabel).toBe('7d')
    expect(f.format(5400)).toBe('1h 30m')
    expect(f.losingTomorrow).toBe('-30m')
    expect(goalFormat({ ...metric, losing_tomorrow: 0 }).losingTomorrow).toBe('')
  })

  test('trend goals use the pattern, display period and display unit, and lose nothing', () => {
    const f = goalFormat(trend)
    expect(f.label).toBe('coffee')
    expect(f.windowLabel).toBe('monthly')
    expect(f.format(0.5)).toBe('0.50 per month')
    expect(f.losingTomorrow).toBe('')
  })

  test('measure goals use the exercise and measure, formatted like the measure', () => {
    const f = goalFormat(measure)
    expect(f.label).toBe('Bench Press · Best e1RM')
    expect(f.windowLabel).toBe('30d')
    expect(f.format(102.5)).toBe('102.5 kg')
    expect(f.losingTomorrow).toBe('-2.5 kg')
    expect(goalFormat({ ...measure, losing_tomorrow: 0 }).losingTomorrow).toBe('')
  })

  test('a volume goal groups thousands', () => {
    const f = goalFormat({ ...measure, aggregation: 'sum', current: 12_000, measure: 'volume' })
    expect(f.format(12_000)).toBe(`12${THIN}000 kg`)
  })
})

describe('goalLabel', () => {
  test('per goal type', () => {
    expect(goalLabel({ goal_type: 'metric', id: ID, metric: 'steps', min: 1, window: '7d' })).toBe('Steps')
    expect(
      goalLabel({
        display_period: 'monthly',
        goal_type: 'trend',
        half_life_days: 15,
        id: ID,
        pattern: 'coffee',
        source_type: 'activity_type',
      }),
    ).toBe('coffee')
    expect(
      goalLabel({
        activity_type: 'strength_training',
        aggregation: 'max',
        goal_type: 'measure',
        id: ID,
        measure: 'max_time',
        min: 60,
        window: '30d',
      }),
    ).toBe('strength_training · Longest hold')
  })
})

describe('goalValueFormat', () => {
  test('trend values carry the history unit', () => {
    const f = goalValueFormat(
      {
        display_period: 'monthly',
        goal_type: 'trend',
        half_life_days: 15,
        id: ID,
        pattern: 'coffee',
        source_type: 'activity_type',
      },
      'per month',
    )
    expect(f(0.456)).toBe('0.46 per month')
  })

  test('metric and measure values', () => {
    expect(
      goalValueFormat({ goal_type: 'metric', id: ID, metric: 'steps', min: 1, window: '7d' })(7000),
    ).toBe((7000).toLocaleString())
    expect(
      goalValueFormat({
        activity_type: 'strength_training',
        aggregation: 'max',
        goal_type: 'measure',
        id: ID,
        measure: 'max_time',
        min: 60,
        window: '30d',
      })(90),
    ).toBe('1:30')
  })
})
