import { describe, expect, test } from 'vitest'

import { TIMELINE_METRICS } from './timelineMetrics'

describe('TIMELINE_METRICS', () => {
  test('names exactly the metrics the Timeline tracks, sparklines and sleep tooltips read', () => {
    expect([...TIMELINE_METRICS].sort()).toEqual(
      [
        'calories_active',
        'heart_rate',
        'hrv_rmssd',
        'sleep_deep_score',
        'sleep_efficiency',
        'sleep_rem_score',
        'sleep_restfulness',
        'sleep_score',
        'steps',
        'stress_level',
      ].sort(),
    )
  })
})
