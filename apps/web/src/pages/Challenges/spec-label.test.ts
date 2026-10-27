import type { ChallengeSpec } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { describeSpec, formatTotal, totalHeader } from './spec-label'

const spec = (overrides: Partial<ChallengeSpec>): ChallengeSpec => ({
  aggregation: 'sum',
  bucket_size: 'auto',
  pattern: 'steps',
  source_type: 'metric',
  unit: 'steps',
  ...overrides,
})

const pushUps = spec({
  aggregation: 'max',
  filter_field: 'sets.exercise',
  filter_value: 'Push-ups',
  measure: 'max_reps',
  pattern: 'strength_training',
  source_type: 'activity_type',
  unit: 'reps',
})

describe('describeSpec', () => {
  test('a metric or an activity type without a measure: pattern and aggregation', () => {
    expect(describeSpec(spec({}))).toBe('steps · sum')
    expect(
      describeSpec(spec({ aggregation: 'count', pattern: 'running', source_type: 'activity_type' })),
    ).toBe('running · count')
  })

  test('a measure of one exercise, best session', () => {
    expect(describeSpec(pushUps)).toBe('Push-ups · most reps in a set (best session)')
  })

  test('a measure summed over all items names the type, the leaderboard header says total', () => {
    expect(
      describeSpec(
        spec({
          measure: 'total_reps',
          pattern: 'strength_training',
          source_type: 'activity_type',
          unit: 'reps',
        }),
      ),
    ).toBe('strength_training · total reps')
  })

  test('keeps the casing after the first letter', () => {
    expect(
      describeSpec(
        spec({
          aggregation: 'max',
          measure: 'e1rm',
          pattern: 'strength_training',
          source_type: 'activity_type',
        }),
      ),
    ).toBe('strength_training · best e1RM (best session)')
  })
})

describe('totalHeader', () => {
  test('Best for a max challenge, Total with the unit otherwise', () => {
    expect(totalHeader(pushUps)).toBe('Best')
    expect(totalHeader({ ...pushUps, aggregation: 'sum', measure: 'total_reps' })).toBe('Total')
    expect(totalHeader(spec({}))).toBe('Total (steps)')
  })
})

describe('formatTotal', () => {
  test('a measure is formatted with its unit', () => {
    expect(formatTotal(pushUps, 41.6)).toBe('42 reps')
    expect(formatTotal({ ...pushUps, measure: 'max_time' }, 90)).toBe('1:30')
  })

  test('a unitless measure falls back to the spec unit', () => {
    expect(formatTotal({ ...pushUps, aggregation: 'sum', measure: 'set_count', unit: 'sets' }, 12)).toBe(
      '12 sets',
    )
    expect(formatTotal({ ...pushUps, aggregation: 'sum', measure: 'set_count', unit: '' }, 12)).toBe('12')
  })

  test('otherwise a rounded, locale-grouped number', () => {
    expect(formatTotal(spec({}), 12345.6)).toBe((12346).toLocaleString())
  })
})
