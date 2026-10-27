import type { ActivityFeatures } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { runFeatureRows } from './runFeatures'

describe('runFeatureRows', () => {
  test('lists the non-null features with their units', () => {
    const features = {
      activity_id: '00000000-0000-4000-8000-000000000001',
      computed_at: '2026-10-01T00:00:00Z',
      elapsed_s: 3600,
      elevation_gain_m: 42.4,
      elevation_oscillation: 12.34,
      hr_drift_pct: 3.21,
      interval_count: 6,
      low_hr_fraction: 0.875,
      zone2_fraction: null,
    } as unknown as ActivityFeatures

    expect(runFeatureRows(features).map((r) => [r.label, r.value])).toEqual([
      ['Elapsed', '60.0 min'],
      ['Time at low HR', '88%'],
      ['HR drift', '3.2%'],
      ['Intervals', '6'],
      ['Elevation gain', '42 m'],
      ['Climb + descent', '12.3 m/km'],
    ])
  })

  test('nothing without features', () => {
    expect(runFeatureRows(undefined)).toEqual([])
  })
})
