import type { ActivitySegmentEffort } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { formatElapsed, segmentEffortRows } from './segmentEfforts'

const effort = (overrides: Partial<ActivitySegmentEffort> = {}): ActivitySegmentEffort => ({
  approximate: false,
  avg_hr: 151.4,
  elapsed_s: 182.4,
  is_best: false,
  pace_s_per_km: 228,
  rank: 2,
  segment_id: '00000000-0000-4000-8000-000000000001',
  segment_name: 'Hammarbybacken · 0.8 km',
  start_offset_s: 640,
  ...overrides,
})

describe('formatElapsed', () => {
  test('m:ss, and h:mm:ss from an hour', () => {
    expect(formatElapsed(59.6)).toBe('1:00')
    expect(formatElapsed(182.4)).toBe('3:02')
    expect(formatElapsed(3725)).toBe('1:02:05')
  })
})

describe('segmentEffortRows', () => {
  test('one row per effort with time, pace, heart rate and the best and approximate marks', () => {
    expect(
      segmentEffortRows([
        effort(),
        effort({ approximate: true, avg_hr: null, is_best: true, start_offset_s: 900 }),
      ]),
    ).toEqual([
      {
        approximate: false,
        avg_hr: '151 bpm',
        best: false,
        key: '00000000-0000-4000-8000-000000000001:640',
        name: 'Hammarbybacken · 0.8 km',
        pace: '3:48 /km',
        segment_id: '00000000-0000-4000-8000-000000000001',
        time: '3:02',
      },
      {
        approximate: true,
        best: true,
        key: '00000000-0000-4000-8000-000000000001:900',
        name: 'Hammarbybacken · 0.8 km',
        pace: '3:48 /km',
        segment_id: '00000000-0000-4000-8000-000000000001',
        time: '3:02',
      },
    ])
  })

  test('nothing without efforts', () => {
    expect(segmentEffortRows(undefined)).toEqual([])
  })
})
