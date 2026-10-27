import type { ChallengeDataResponse } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import type { ChallengeSpecFields } from '../db/index.ts'

import {
  effectiveBucketSize,
  memberEchoMatches,
  scoreBuckets,
  specToApi,
  toSpecFields,
} from './challenge-spec.ts'

const start = new Date('2026-07-01T00:00:00.000Z')
const after = (d: number) => new Date(start.getTime() + d * 24 * 60 * 60 * 1000)

describe('effectiveBucketSize', () => {
  it('uses a fixed creator choice as-is (override for long challenges)', () => {
    expect(effectiveBucketSize('1d', start, after(365))).toBe('1d')
    expect(effectiveBucketSize('1w', start, after(1))).toBe('1w')
    expect(effectiveBucketSize('1M', start, after(3))).toBe('1M')
  })

  it('adapts "auto" to the window: finer for short, coarser for long', () => {
    expect(effectiveBucketSize('auto', start, after(1))).toBe('5m') // <= 1 day
    expect(effectiveBucketSize('auto', start, after(2))).toBe('15m') // <= 3 days
    expect(effectiveBucketSize('auto', start, after(3))).toBe('15m')
    expect(effectiveBucketSize('auto', start, after(7))).toBe('1h') // <= 14 days
    expect(effectiveBucketSize('auto', start, after(14))).toBe('1h')
    expect(effectiveBucketSize('auto', start, after(30))).toBe('1d') // <= 120 days
    expect(effectiveBucketSize('auto', start, after(120))).toBe('1d')
    expect(effectiveBucketSize('auto', start, after(200))).toBe('1w') // > 120 days
  })

  it('treats a sub-day window as the finest bucket', () => {
    // Fixed dates only: `effectiveBucketSize` derives everything from `end -
    // start`, so a wall-clock window bought nothing here and its two `Date.now()`
    // reads straddled the `days <= 1` boundary. The exact-1-day boundary is
    // already pinned by the `after(1)` case above.
    expect(effectiveBucketSize('auto', start, new Date(start.getTime() + 13 * 60 * 60 * 1000))).toBe('5m')
  })
})

const hoursSpec: ChallengeSpecFields = {
  activity_type_id: null,
  aggregation: 'sum',
  bucket_size: 'auto',
  filter_field: null,
  filter_value: null,
  measure: null,
  pattern: 'strength_training',
  source_type: 'activity_type',
  unit: 'hours',
}

const bestSetSpec: ChallengeSpecFields = {
  ...hoursSpec,
  aggregation: 'max',
  filter_field: 'sets.exercise',
  filter_value: 'Push-ups',
  measure: 'max_reps',
  unit: 'reps',
}

describe('specToApi / toSpecFields', () => {
  it('omits null optionals and restores them as nulls', () => {
    expect(specToApi(hoursSpec)).toEqual({
      aggregation: 'sum',
      bucket_size: 'auto',
      pattern: 'strength_training',
      source_type: 'activity_type',
      unit: 'hours',
    })
    expect(toSpecFields(specToApi(hoursSpec))).toEqual(hoursSpec)
  })

  it('carries a measure and its item filter both ways', () => {
    expect(specToApi(bestSetSpec)).toMatchObject({
      aggregation: 'max',
      filter_field: 'sets.exercise',
      filter_value: 'Push-ups',
      measure: 'max_reps',
    })
    expect(toSpecFields(specToApi(bestSetSpec))).toEqual(bestSetSpec)
  })
})

describe('scoreBuckets', () => {
  const buckets = [{ value: 20 }, { value: 35 }, { value: 10 }]

  it('sums for sum and count', () => {
    expect(scoreBuckets(buckets, 'sum')).toBe(65)
    expect(scoreBuckets(buckets, 'count')).toBe(65)
  })

  it('takes the best bucket for max, 0 with none', () => {
    expect(scoreBuckets(buckets, 'max')).toBe(35)
    expect(scoreBuckets([], 'max')).toBe(0)
  })
})

describe('memberEchoMatches', () => {
  const echo: ChallengeDataResponse = {
    aggregation: 'max',
    filter_field: 'sets.exercise',
    filter_value: 'Push-ups',
    measure: 'max_reps',
    success: true,
  }

  it('a spec without a measure accepts any response, an old instance included', () => {
    expect(memberEchoMatches(hoursSpec, { success: true, total: 3 })).toBe(true)
  })

  it('accepts the same measure, aggregation and filter, the value compared normalised', () => {
    expect(memberEchoMatches(bestSetSpec, echo)).toBe(true)
    expect(memberEchoMatches(bestSetSpec, { ...echo, filter_value: ' push-UPS ' })).toBe(true)
  })

  it('refuses an instance that omits the measure (too old to know it)', () => {
    expect(memberEchoMatches(bestSetSpec, { success: true, total: 2 })).toBe(false)
  })

  it('refuses a different measure, aggregation or filter', () => {
    expect(memberEchoMatches(bestSetSpec, { ...echo, measure: 'total_reps' })).toBe(false)
    expect(memberEchoMatches(bestSetSpec, { ...echo, aggregation: 'sum' })).toBe(false)
    expect(memberEchoMatches(bestSetSpec, { ...echo, filter_value: 'Pull-ups' })).toBe(false)
    expect(
      memberEchoMatches(bestSetSpec, {
        aggregation: 'max',
        measure: 'max_reps',
        success: true,
      }),
    ).toBe(false)
    expect(memberEchoMatches({ ...bestSetSpec, filter_field: null, filter_value: null }, echo)).toBe(false)
  })
})
