import { describe, expect, test } from 'vitest'

import {
  FIXTURE_POOLED_MEAN,
  FIXTURE_TIME_WEIGHTED_MEAN,
  unevenlySampledDay,
} from '../test/time-weighted-fixture.ts'
import { sampleMean } from './time-weighted-mean.ts'

const series = (metric: string): [Date, number][] => unevenlySampledDay(metric).map((p) => [p.time, p.value])

describe('sampleMean', () => {
  test('an hour at 1 Hz in a day at one sample per 3 minutes weighs as one hour', () => {
    expect(sampleMean('heart_rate', series('heart_rate'))).toBeCloseTo(FIXTURE_TIME_WEIGHTED_MEAN, 9)
    expect(sampleMean('stress_level', series('stress_level'))).toBeCloseTo(FIXTURE_TIME_WEIGHTED_MEAN, 9)
  })

  test('other metrics keep the plain mean', () => {
    expect(sampleMean('weight', series('weight'))).toBeCloseTo(FIXTURE_POOLED_MEAN, 9)
  })

  test('is null without samples', () => {
    expect(sampleMean('heart_rate', [])).toBeNull()
  })
})
