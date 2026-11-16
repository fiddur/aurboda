import type { SegmentEffort } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import {
  formatEffortCount,
  formatMatchResult,
  formatPassedOn,
  formatScanTotals,
  lengthKm,
  promoteTrim,
  searchFromSegmentsQuery,
  segmentEffortSeries,
  segmentsQueryFromParams,
  shouldScanAgain,
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

describe('suggested segments', () => {
  it('says how many activities pass it', () => {
    expect(formatPassedOn(5)).toBe('passed on 5 activities')
    expect(formatPassedOn(1)).toBe('passed on 1 activity')
  })

  it('sends the km only when they differ from the whole line', () => {
    expect(lengthKm(1234)).toBe(1.3)
    expect(promoteTrim(1234, 0, 1.3)).toEqual({})
    expect(promoteTrim(1200, 0, 1.2)).toEqual({})
    expect(promoteTrim(1234, 0.2, 1.3)).toEqual({ end_km: 1.3, start_km: 0.2 })
    expect(promoteTrim(1234, 0, 1.2)).toEqual({ end_km: 1.2, start_km: 0 })
  })

  it('scans again while something is left and the last run got through some', () => {
    expect(shouldScanAgain({ remaining: 4, scanned: 10, suggested: 0 })).toBe(true)
    expect(shouldScanAgain({ remaining: 0, scanned: 10, suggested: 0 })).toBe(false)
    expect(shouldScanAgain({ remaining: 4, scanned: 0, suggested: 0 })).toBe(false)
  })

  it('sums up the scan in one sentence', () => {
    expect(formatScanTotals({ scanned: 0, suggested: 0 })).toBe('Nothing new to look through.')
    expect(formatScanTotals({ scanned: 12, suggested: 1 })).toBe(
      'Looked through 12 activities and found 1 new suggestion.',
    )
    expect(formatScanTotals({ scanned: 1, suggested: 3 })).toBe(
      'Looked through 1 activity and found 3 new suggestions.',
    )
  })
})
