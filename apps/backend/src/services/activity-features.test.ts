import type { HrZoneThresholds } from '@aurboda/api-spec'

import { describe, expect, test, vi } from 'vitest'

import type { ActivityFeatureValues } from '../db/activity-features.ts'
import type { ActivityTrackRecord } from '../db/tracks.ts'

import {
  type ActivityFeatureDeps,
  computeAndStoreActivityFeatures,
  type FeatureActivity,
} from './activity-features.ts'

const zones: HrZoneThresholds = { 1: 95, 2: 114, 3: 133, 4: 152, 5: 171 }
const start = new Date('2026-06-01T06:00:00Z')
const end = new Date('2026-06-01T07:00:00Z')

const series = (value: number): [Date, number][] =>
  Array.from({ length: 720 }, (_, i) => [new Date(start.getTime() + i * 5000), value])

const track: ActivityTrackRecord = {
  activity_id: 'a1',
  full_resolution: true,
  length_m: 10_000,
  point_count: 2,
  points: [
    { alt: 10, lat: 59.3, lon: 18.07, t: 0 },
    { alt: 10, lat: 59.31, lon: 18.07, t: 3600 },
  ],
  source: 'strava',
  start_time: start,
}

const makeDeps = (overrides: Partial<ActivityFeatureDeps> = {}) => {
  const stored = new Map<string, ActivityFeatureValues>()
  const activity: FeatureActivity = {
    activity_type: 'running',
    end_time: end,
    id: 'a1',
    source: 'garmin',
    start_time: start,
  }
  const deps: ActivityFeatureDeps = {
    expandActivityTypes: vi.fn(async (_user: string, types: string[]) => [...types, 'running_treadmill']),
    getActivity: vi.fn(async () => activity),
    getActivityFeatures: vi.fn(async (_user: string, id: string) => {
      const features = stored.get(id)
      return features ? { ...features, activity_id: id, computed_at: '2026-06-01T08:00:00.000Z' } : null
    }),
    getActivityTrack: vi.fn(async () => track),
    getEffectiveActivityType: vi.fn(async () => 'running'),
    getEffectiveHrZones: vi.fn(async () => ({ source: 'custom' as const, zones })),
    getMedianDurationBefore: vi.fn(async () => 1800),
    getSettings: vi.fn(async () => ({ maf_hr: 145 })),
    getTimeSeries: vi.fn(async (_user: string, metric: string) =>
      metric === 'heart_rate' ? series(150) : [],
    ),
    getTimeSeriesBySource: vi.fn(async (_user: string, metric: string) =>
      metric === 'speed' ? series(3) : [],
    ),
    upsertActivityFeatures: vi.fn(async (_user: string, id: string, features: ActivityFeatureValues) => {
      stored.set(id, features)
    }),
    ...overrides,
  }
  return deps
}

describe('computeAndStoreActivityFeatures', () => {
  test('samples come from the track source first, falling back to any source', async () => {
    const deps = makeDeps()
    const result = await computeAndStoreActivityFeatures('u', 'a1', deps)

    expect(deps.getTimeSeriesBySource).toHaveBeenCalledWith('u', 'heart_rate', 'strava', start, end)
    expect(deps.getTimeSeriesBySource).toHaveBeenCalledWith('u', 'speed', 'strava', start, end)
    expect(deps.getTimeSeries).toHaveBeenCalledWith('u', 'heart_rate', start, end)
    expect(deps.getTimeSeries).not.toHaveBeenCalledWith('u', 'speed', start, end)
    expect(result).toMatchObject({
      activity_id: 'a1',
      duration_vs_median_90d: 2,
      elapsed_s: 3600,
      low_hr_ceiling_bpm: 145,
      low_hr_fraction: 0,
    })
    expect(result?.pace_cv).toBeCloseTo(0)
    expect(result?.zone3_fraction).toBeCloseTo(1)
    expect(deps.upsertActivityFeatures).toHaveBeenCalledOnce()
  })

  test("without a track, the activity's own source is tried first and HR features still compute", async () => {
    const deps = makeDeps({ getActivityTrack: vi.fn(async () => null) })
    const result = await computeAndStoreActivityFeatures('u', 'a1', deps)

    expect(deps.getTimeSeriesBySource).toHaveBeenCalledWith('u', 'heart_rate', 'garmin', start, end)
    expect(result?.elevation_gain_m).toBeNull()
    expect(result?.zone3_fraction).toBeCloseTo(1)
  })

  test('the median is asked for the type and its descendants before the start', async () => {
    const deps = makeDeps()
    await computeAndStoreActivityFeatures('u', 'a1', deps)

    expect(deps.expandActivityTypes).toHaveBeenCalledWith('u', ['running'])
    expect(deps.getMedianDurationBefore).toHaveBeenCalledWith('u', ['running', 'running_treadmill'], start)
  })

  test("an overridden activity's median and returned type follow the override's type", async () => {
    const deps = makeDeps({ getEffectiveActivityType: vi.fn(async () => 'walking') })
    const result = await computeAndStoreActivityFeatures('u', 'a1', deps)

    expect(deps.getEffectiveActivityType).toHaveBeenCalledWith('u', 'a1')
    expect(deps.expandActivityTypes).toHaveBeenCalledWith('u', ['walking'])
    expect(deps.getMedianDurationBefore).toHaveBeenCalledWith('u', ['walking', 'running_treadmill'], start)
    expect(result?.activity_type).toBe('walking')
  })

  test('the zone-2 upper bound is the ceiling without a MAF setting', async () => {
    const deps = makeDeps({ getSettings: vi.fn(async () => ({})) })
    const result = await computeAndStoreActivityFeatures('u', 'a1', deps)

    expect(result?.low_hr_ceiling_bpm).toBe(133)
  })

  test('null without an end time or without the activity, nothing stored', async () => {
    const untimed = makeDeps({
      getActivity: vi.fn(async () => ({
        activity_type: 'running',
        id: 'a1',
        source: 'garmin',
        start_time: start,
      })),
    })
    expect(await computeAndStoreActivityFeatures('u', 'a1', untimed)).toBeNull()
    expect(untimed.upsertActivityFeatures).not.toHaveBeenCalled()

    const missing = makeDeps({ getActivity: vi.fn(async () => null) })
    expect(await computeAndStoreActivityFeatures('u', 'a1', missing)).toBeNull()
  })
})
