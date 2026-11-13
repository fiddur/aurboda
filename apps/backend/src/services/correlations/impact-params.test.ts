import {
  activityImpactQuerySchema,
  formatImpactFilters,
  IMPACT_NO_VALUE_KEY,
  impactDurationBucketsError,
  impactFieldPath,
  impactTimeBucketsError,
  isImpactDimension,
  MAX_IMPACT_FILTERS,
  parseImpactBucketLimits,
  parseImpactFilters,
} from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

describe('isImpactDimension and impactFieldPath', () => {
  test('the fixed dimensions and well-formed field paths', () => {
    for (const dimension of [
      'duration',
      'time_of_day',
      'sleep',
      'field:session_name',
      'field:sets.exercise',
    ]) {
      expect(isImpactDimension(dimension)).toBe(true)
    }
    for (const dimension of ['weather', 'field:', 'field:Session', 'field:a.b.c', 'field:session name', '']) {
      expect(isImpactDimension(dimension)).toBe(false)
    }
    expect(impactFieldPath('field:sets.exercise')).toBe('sets.exercise')
    expect(impactFieldPath('duration')).toBeNull()
  })

  test('the query schema rejects an unknown breakdown', () => {
    expect(activityImpactQuerySchema.safeParse({ activity_type: 'tag', breakdown: 'sleep' }).success).toBe(
      true,
    )
    expect(activityImpactQuerySchema.safeParse({ activity_type: 'tag', breakdown: 'weather' }).success).toBe(
      false,
    )
  })
})

describe('parseImpactBucketLimits', () => {
  test('blank is null, numbers are trimmed, anything else fails validation', () => {
    expect(parseImpactBucketLimits(undefined)).toBeNull()
    expect(parseImpactBucketLimits(' ')).toBeNull()
    expect(parseImpactBucketLimits(' 15, 30 ,60')).toEqual([15, 30, 60])
    expect(parseImpactBucketLimits('15,,30')).toEqual([Number.NaN])
    expect(parseImpactBucketLimits('15,abc')).toEqual([Number.NaN])
    expect(impactDurationBucketsError([Number.NaN])).not.toBeNull()
  })
})

describe('bucket limit validation', () => {
  test('duration limits are 1 to 6 ascending whole minutes from 1 to 1440', () => {
    expect(impactDurationBucketsError([15, 30, 60])).toBeNull()
    expect(impactDurationBucketsError([1440])).toBeNull()
    expect(impactDurationBucketsError([])).toMatch(/1 to 6/)
    expect(impactDurationBucketsError([1, 2, 3, 4, 5, 6, 7])).toMatch(/1 to 6/)
    expect(impactDurationBucketsError([0, 30])).toMatch(/from 1 to 1440/)
    expect(impactDurationBucketsError([15.5])).toMatch(/whole numbers/)
    expect(impactDurationBucketsError([30, 30])).toMatch(/strictly ascending/)
  })

  test('time limits are ascending whole hours from 0 to 23', () => {
    expect(impactTimeBucketsError([0, 6, 12, 18])).toBeNull()
    expect(impactTimeBucketsError([22])).toBeNull()
    expect(impactTimeBucketsError([6, 24])).toMatch(/from 0 to 23/)
    expect(impactTimeBucketsError([22, 6])).toMatch(/strictly ascending/)
  })
})

describe('impact filter strings', () => {
  test('format and parse round-trip awkward keys', () => {
    const filters = [
      { dimension: 'duration', keys: ['15-30', '30-60'] },
      { dimension: 'sleep', keys: ['none'] },
      { dimension: 'field:session_name', keys: ['Morning flow', 'a,b;c:d%e', IMPACT_NO_VALUE_KEY] },
    ]
    const raw = formatImpactFilters(filters)
    expect(raw).toBe(
      'duration:15-30,30-60;sleep:none;field:session_name:Morning%20flow,a%2Cb%3Bc%3Ad%25e,(none)',
    )
    expect(parseImpactFilters(raw)).toEqual(filters)
  })

  test('blank is no filters; the same dimension twice merges its keys', () => {
    expect(parseImpactFilters(undefined)).toEqual([])
    expect(parseImpactFilters('  ')).toEqual([])
    expect(parseImpactFilters('sleep:none;sleep:after,none')).toEqual([
      { dimension: 'sleep', keys: ['none', 'after'] },
    ])
  })

  test('malformed strings are null', () => {
    expect(parseImpactFilters('weather:sunny')).toBeNull()
    expect(parseImpactFilters('duration')).toBeNull()
    expect(parseImpactFilters('duration:')).toBeNull()
    expect(parseImpactFilters('duration:15-30,')).toBeNull()
    expect(parseImpactFilters('field:session_name')).toBeNull()
    expect(parseImpactFilters('field:session_name:%E0%A4%A')).toBeNull()
    const tooMany = Array.from({ length: MAX_IMPACT_FILTERS + 1 }, (_, i) => `field:f${i}:x`).join(';')
    expect(parseImpactFilters(tooMany)).toBeNull()
  })
})
