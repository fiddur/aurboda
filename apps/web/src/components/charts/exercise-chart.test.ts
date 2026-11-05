import type { SharedExerciseData } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { exerciseChartTitle, exerciseLineTrend } from './exercise-chart'

const perWeek = (measure: 'e1rm' | 'volume'): NonNullable<SharedExerciseData['per_week']> => ({
  aggregation: 'max',
  buckets: [{ bucket_start: '2026-01-05T00:00:00Z', value: 40 }],
  end: '2026-02-01T00:00:00Z',
  measure,
  start: '2026-01-01T00:00:00Z',
})

const trend: NonNullable<SharedExerciseData['trend']> = {
  half_life_days: 30,
  history: [{ date: '2026-01-05', value: 40 }],
  measure: 'e1rm',
}

describe('exerciseChartTitle', () => {
  test('names the per-week measure when there are bars', () => {
    expect(exerciseChartTitle(perWeek('e1rm'), trend)).toBe('Best e1RM')
  })

  test('is Trend when only the trend is there', () => {
    expect(exerciseChartTitle(null, trend)).toBe('Trend')
  })

  test('is null with neither', () => {
    expect(exerciseChartTitle(null, null)).toBeNull()
  })
})

describe('exerciseLineTrend', () => {
  test('draws the line when the measures match', () => {
    expect(exerciseLineTrend(perWeek('e1rm'), trend)).toBe(trend)
  })

  test('draws no line when the measures differ', () => {
    expect(exerciseLineTrend(perWeek('volume'), trend)).toBeUndefined()
  })

  test('draws no line without bars', () => {
    expect(exerciseLineTrend(null, trend)).toBeUndefined()
  })
})
