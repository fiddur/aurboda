import { describe, expect, test } from 'vitest'

import {
  averagePerWeek,
  isMuscleGroup,
  lastTrainedLabel,
  muscleGroupChart,
  muscleGroupExploreHref,
  muscleGroupPeriod,
  muscleGroupWidgetConfig,
  recruitmentLabel,
  setsThisWeek,
} from './muscleGroupView'

const local = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h)

describe('isMuscleGroup', () => {
  test('accepts catalogue group keys only', () => {
    expect(isMuscleGroup('chest')).toBe(true)
    expect(isMuscleGroup('middle_back')).toBe(true)
    expect(isMuscleGroup('front_delts')).toBe(false)
    expect(isMuscleGroup('Chest')).toBe(false)
  })
})

describe('setsThisWeek', () => {
  const now = local(2026, 11, 18)
  const session = (start: Date, set_count?: number) => ({
    measures: set_count === undefined ? {} : { set_count },
    start_time: start.toISOString(),
  })

  test('sums the weighted sets since Monday 00:00 local time', () => {
    expect(
      setsThisWeek(
        [
          session(local(2026, 11, 18), 2.5),
          session(local(2026, 11, 16, 0), 3),
          session(local(2026, 11, 17)),
          session(local(2026, 11, 15, 23), 10),
        ],
        now,
      ),
    ).toBe(5.5)
  })

  test('does not count last Sunday', () => {
    expect(setsThisWeek([session(local(2026, 11, 15, 20), 4)], now)).toBe(0)
  })
})

describe('averagePerWeek', () => {
  test('divides the total by the period in weeks', () => {
    expect(averagePerWeek(26, 91)).toBe(2)
    expect(averagePerWeek(0, 90)).toBe(0)
  })

  test('counts a period shorter than a week as one week', () => {
    expect(averagePerWeek(3, 2)).toBe(3)
  })
})

describe('lastTrainedLabel', () => {
  const now = local(2026, 11, 18, 9)

  test('reads today, yesterday and days ago', () => {
    expect(lastTrainedLabel(local(2026, 11, 18, 7).toISOString(), now)).toBe('Today')
    expect(lastTrainedLabel(local(2026, 11, 17, 22).toISOString(), now)).toBe('Yesterday')
    expect(lastTrainedLabel(local(2026, 11, 6).toISOString(), now)).toBe('12 days ago')
  })

  test('reads never for a group never trained', () => {
    expect(lastTrainedLabel(null, now)).toBe('Never')
    expect(lastTrainedLabel(null, now, 'short')).toBe('Never')
  })

  test('has short forms for narrow screens', () => {
    expect(lastTrainedLabel(local(2026, 11, 18, 7).toISOString(), now, 'short')).toBe('Today')
    expect(lastTrainedLabel(local(2026, 11, 17).toISOString(), now, 'short')).toBe('1 d ago')
    expect(lastTrainedLabel(local(2026, 11, 15).toISOString(), now, 'short')).toBe('3 d ago')
  })

  test('reads a time later today as today', () => {
    expect(lastTrainedLabel(local(2026, 11, 18, 20).toISOString(), now)).toBe('Today')
  })
})

describe('muscleGroupPeriod', () => {
  const now = local(2026, 11, 18, 9)

  test('runs from the start of the day the period ago to the end of today, in weeks up to a year', () => {
    const period = muscleGroupPeriod(90, now)
    expect(period.bucket_size).toBe('1w')
    expect(new Date(period.start)).toEqual(local(2026, 8, 20, 0))
    expect(new Date(period.end)).toEqual(new Date(2026, 10, 18, 23, 59, 59, 999))
    expect(new Date(period.axis_end)).toEqual(new Date(2026, 10, 22, 23, 59, 59, 999))
    expect(muscleGroupPeriod(365, now).bucket_size).toBe('1w')
  })

  test('takes monthly buckets for two years, the axis to the end of the month', () => {
    const period = muscleGroupPeriod(730, now)
    expect(period.bucket_size).toBe('1M')
    expect(new Date(period.axis_end)).toEqual(new Date(2026, 10, 30, 23, 59, 59, 999))
  })
})

describe('recruitmentLabel', () => {
  test('is a plain number', () => {
    expect(recruitmentLabel(1)).toBe('1')
    expect(recruitmentLabel(0.5)).toBe('0.5')
    expect(recruitmentLabel(0.25)).toBe('0.25')
    expect(recruitmentLabel(1 / 3)).toBe('0.33')
  })
})

describe('the chart config', () => {
  const chart = muscleGroupChart({
    bucket_size: '1w',
    field: 'sets.exercise',
    group: 'chest',
    measure: 'set_count',
    name: 'strength_training',
  })

  test('filters to the muscle group and breaks down by exercise', () => {
    expect(chart).toEqual({
      aggregation: 'sum',
      breakdown_fields: ['sets.exercise'],
      bucket_size: '1w',
      filter_field: 'sets.exercise.muscle_group',
      filter_value: 'chest',
      measure: 'set_count',
      pattern: 'strength_training',
      source_type: 'activity_type',
    })
  })

  test('opens in the Chart Explorer as bars with the filter, the breakdown and the lookback', () => {
    const params = new URLSearchParams(muscleGroupExploreHref(chart, 90).split('?')[1])
    expect(Object.fromEntries(params)).toEqual({
      aggregation: 'sum',
      breakdown_fields: 'sets.exercise',
      bucket_size: '1w',
      chart_type: 'bar',
      filter_field: 'sets.exercise.muscle_group',
      filter_value: 'chest',
      lookback_days: '90',
      measure: 'set_count',
      pattern: 'strength_training',
      source_type: 'activity_type',
    })
  })

  test('adds to a dashboard as a bar chart with the lookback and an optional title', () => {
    expect(muscleGroupWidgetConfig(chart, 365, '')).toEqual({ ...chart, lookback_days: 365 })
    expect(muscleGroupWidgetConfig(chart, 365, 'Chest')).toEqual({
      ...chart,
      lookback_days: 365,
      title: 'Chest',
    })
  })
})
