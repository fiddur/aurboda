import type { ActivityImpactData, ImpactBucket, ImpactTimeline, WindowEffect } from '@aurboda/api-spec'

const stats = (mean: number | null) => ({
  mean,
  occurrences: mean == null ? 0 : 3,
  sample_count: mean == null ? 0 : 6,
  stddev: null,
})

export const impactBucket = (
  phase: ImpactBucket['phase'],
  start: number,
  end: number,
  mean: number | null,
): ImpactBucket => ({
  end_offset_minutes: end,
  hr: stats(mean == null ? null : mean + 20),
  hrv: stats(mean),
  phase,
  start_offset_minutes: start,
  stress: stats(mean == null ? null : mean / 2),
})

const effect: WindowEffect = {
  after_mean: 50,
  before_mean: 45,
  change: 5,
  change_stddev: 1,
  p_value: 0.02,
  paired_occurrences: 3,
}

const legacy = { mean: null, occurrences: 0, sample_count: 0, stddev: null }
const legacyTimeline: ImpactTimeline = {
  after15min: legacy,
  after30min: legacy,
  before15min: legacy,
  before30min: legacy,
  during: legacy,
}

/** A drawable impact result for yoga: three sessions and five buckets with data. */
export const impactData = (overrides: Partial<ActivityImpactData> = {}): ActivityImpactData => ({
  activity: 'yoga',
  activity_type: 'activity_type',
  avg_duration_min: 45,
  hr_effect: effect,
  hr_timeline: legacyTimeline,
  hrv_effect: effect,
  hrv_timeline: legacyTimeline,
  occurrences: 3,
  stress_effect: effect,
  stress_timeline: legacyTimeline,
  timeline: [
    impactBucket('before', -30, -15, 44),
    impactBucket('before', -15, 0, 46),
    impactBucket('during', 0, 0, 40),
    impactBucket('after', 0, 15, 50),
    impactBucket('after', 15, 30, 52),
  ],
  window_minutes: 30,
  ...overrides,
})
