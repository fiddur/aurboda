import { describe, expect, test } from 'vitest'

import { measureChartTitle } from './chartTitle'

describe('measureChartTitle', () => {
  test('names the exercise and the measure', () => {
    expect(
      measureChartTitle({
        filter_value: 'Dumbbell Bench Press',
        measure: 'e1rm',
        pattern: 'strength_training',
        source_type: 'activity_type',
      }),
    ).toBe('Dumbbell Bench Press · Best e1RM')
  })

  test('falls back to the activity type name without an item filter', () => {
    expect(
      measureChartTitle({ measure: 'volume', pattern: 'strength_training', source_type: 'activity_type' }),
    ).toBe('Strength Training · Volume')
  })

  test('is undefined for sources without a measure or item filter', () => {
    expect(measureChartTitle({ pattern: 'running', source_type: 'activity_type' })).toBeUndefined()
    expect(measureChartTitle({ pattern: 'hrv', source_type: 'metric' })).toBeUndefined()
  })
})
