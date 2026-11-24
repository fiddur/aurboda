import { describe, expect, test } from 'vitest'

import { journalChartTitle, measureChartTitle } from './chartTitle'

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

  test('names the muscle group by its display name for a muscle filter', () => {
    expect(
      measureChartTitle({
        filter_field: 'sets.exercise.muscle_group',
        filter_value: 'middle_back',
        measure: 'set_count',
        pattern: 'strength_training',
        source_type: 'activity_type',
      }),
    ).toBe('Middle back · Sets')
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

describe('journalChartTitle', () => {
  test('counts entries by default and sums words', () => {
    expect(journalChartTitle({ source_type: 'journal' })).toBe('Journal entries')
    expect(journalChartTitle({ aggregation: 'count', source_type: 'journal' })).toBe('Journal entries')
    expect(journalChartTitle({ aggregation: 'sum', source_type: 'journal' })).toBe('Journal words')
  })

  test('names the tags it is filtered by', () => {
    expect(journalChartTitle({ journal_tags: 'travel,work', source_type: 'journal' })).toBe(
      'Journal entries · #travel #work',
    )
  })

  test('is undefined for any other source', () => {
    expect(journalChartTitle({ source_type: 'activity_type' })).toBeUndefined()
  })
})
