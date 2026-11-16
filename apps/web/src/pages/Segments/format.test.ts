import type { SegmentEffort } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import {
  formatEffortCount,
  formatMatchResult,
  searchFromSegmentsQuery,
  segmentEffortSeries,
  segmentsQueryFromParams,
} from './format'

describe('segmentsQueryFromParams', () => {
  it('reads the type and a non-default sort', () => {
    expect(segmentsQueryFromParams({ sort: 'efforts', type: 'running' })).toEqual({
      activity_type: 'running',
      sort: 'efforts',
    })
  })

  it('drops the default and unknown sorts', () => {
    expect(segmentsQueryFromParams({ sort: 'last_effort' })).toEqual({})
    expect(segmentsQueryFromParams({ sort: 'fastest' })).toEqual({})
  })
})

describe('searchFromSegmentsQuery', () => {
  it('writes the type and a non-default sort', () => {
    expect(searchFromSegmentsQuery({ activity_type: 'cycling', sort: 'length' })).toBe(
      '?type=cycling&sort=length',
    )
  })

  it('is empty for the defaults', () => {
    expect(searchFromSegmentsQuery({})).toBe('')
    expect(searchFromSegmentsQuery({ sort: 'last_effort' })).toBe('')
  })

  it('round-trips through the params', () => {
    const query = { activity_type: 'running', sort: 'alphabetical' as const }
    const params = Object.fromEntries(new URLSearchParams(searchFromSegmentsQuery(query).slice(1)))
    expect(segmentsQueryFromParams(params)).toEqual(query)
  })
})

describe('segmentEffortSeries', () => {
  const effort = (activity_start_time: string, elapsed_s: number, approximate = false): SegmentEffort => ({
    activity_id: activity_start_time,
    activity_start_time,
    approximate,
    avg_hr: null,
    elapsed_s,
    is_best: false,
    pace_s_per_km: 300,
    start_offset_s: 0,
  })

  it('charts minutes oldest first, leaving approximate efforts out when there are timed ones', () => {
    expect(
      segmentEffortSeries([
        effort('2026-06-08T07:00:00.000Z', 240),
        effort('2026-06-05T07:00:00.000Z', 200, true),
        effort('2026-06-01T07:00:00.000Z', 270),
      ]),
    ).toEqual([
      { date: '2026-06-01T07:00:00.000Z', value: 4.5 },
      { date: '2026-06-08T07:00:00.000Z', value: 4 },
    ])
  })

  it('charts approximate efforts when they are all there is', () => {
    expect(segmentEffortSeries([effort('2026-06-05T07:00:00.000Z', 90, true)])).toEqual([
      { date: '2026-06-05T07:00:00.000Z', value: 1.5 },
    ])
  })
})

describe('formatMatchResult', () => {
  it('counts efforts and activities', () => {
    expect(formatMatchResult({ activities: 3, efforts: 5 })).toBe('Timed 5 efforts on 3 activities')
    expect(formatMatchResult({ activities: 1, efforts: 1 })).toBe('Timed 1 effort on 1 activity')
    expect(formatEffortCount(0)).toBe('0 efforts')
  })
})
