import { beforeEach, describe, expect, test, vi } from 'vitest'

import type * as MergeModule from '../../db/activities/merge.ts'
import type { Activity } from '../../db/types.ts'

vi.mock('../../db/index.ts', async () => ({
  getActivityTrack: vi.fn(),
  getDistinctMetrics: vi.fn(),
  getLocations: vi.fn(),
  getOverlappingActivities: vi.fn(),
  getTimeSeries: vi.fn(),
  getTimeSeriesMultiMetric: vi.fn(),
  pickOverrideWinner: (await vi.importActual<typeof MergeModule>('../../db/activities/merge.ts'))
    .pickOverrideWinner,
}))
vi.mock('../settings.ts', () => ({ computeHrZoneSecs: vi.fn(), getEffectiveHrZones: vi.fn() }))

const db = await import('../../db/index.ts')
const { getActivityFullDetail, resolveActivityWindow } = await import('./activity-detail.ts')

const start = new Date('2026-06-08T10:00:00Z')
const end = new Date('2026-06-08T11:00:00Z')

describe('getActivityFullDetail GPS', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getLocations).mockResolvedValue({
      locations: [{ coordinates: [18.5, 59.5], time: new Date('2026-06-08T10:30:00Z') }],
    } as unknown as Awaited<ReturnType<typeof db.getLocations>>)
  })

  test('uses the stored track, timed from the activity start', async () => {
    vi.mocked(db.getActivityTrack).mockResolvedValue({
      activity_id: 'a1',
      full_resolution: true,
      length_m: 1112,
      point_count: 2,
      points: [
        { alt: 0, lat: 59, lon: 18, t: 0 },
        { alt: 0, lat: 59.01, lon: 18, t: 1.5 },
      ],
      source: 'garmin',
      start_time: start,
    })

    const result = await getActivityFullDetail('u', { end_time: end, id: 'a1', start_time: start }, {})

    expect(result.gps).toEqual([
      { lat: 59, lon: 18, time: '2026-06-08T10:00:00.000Z' },
      { lat: 59.01, lon: 18, time: '2026-06-08T10:00:01.500Z' },
    ])
    expect(db.getLocations).not.toHaveBeenCalled()
  })

  const shapeOnlyTrack = {
    activity_id: 'a1',
    full_resolution: false,
    length_m: 1112,
    point_count: 2,
    points: [
      { alt: 0, lat: 59, lon: 18, t: 0 },
      { alt: 0, lat: 59.01, lon: 18, t: 3600 },
    ],
    source: 'strava',
    start_time: start,
  }

  test('prefers locations with real timestamps over a shape-only track', async () => {
    vi.mocked(db.getActivityTrack).mockResolvedValue(shapeOnlyTrack)

    const result = await getActivityFullDetail('u', { end_time: end, id: 'a1', start_time: start }, {})

    expect(result.gps).toEqual([{ lat: 59.5, lon: 18.5, time: '2026-06-08T10:30:00.000Z' }])
  })

  test('uses a shape-only track when the window has no locations', async () => {
    vi.mocked(db.getActivityTrack).mockResolvedValue(shapeOnlyTrack)
    vi.mocked(db.getLocations).mockResolvedValue({ locations: [] } as unknown as Awaited<
      ReturnType<typeof db.getLocations>
    >)

    const result = await getActivityFullDetail('u', { end_time: end, id: 'a1', start_time: start }, {})

    expect(result.gps).toEqual([
      { lat: 59, lon: 18, time: '2026-06-08T10:00:00.000Z' },
      { lat: 59.01, lon: 18, time: '2026-06-08T11:00:00.000Z' },
    ])
  })

  test('falls back to locations in the time range without a track', async () => {
    vi.mocked(db.getActivityTrack).mockResolvedValue(null)

    const result = await getActivityFullDetail('u', { end_time: end, id: 'a1', start_time: start }, {})

    expect(result.gps).toEqual([{ lat: 59.5, lon: 18.5, time: '2026-06-08T10:30:00.000Z' }])
  })

  test('reads no GPS at all when not asked for it', async () => {
    const result = await getActivityFullDetail(
      'u',
      { end_time: end, id: 'a1', start_time: start },
      { includeGps: false },
    )

    expect(result.gps).toBeUndefined()
    expect(db.getActivityTrack).not.toHaveBeenCalled()
    expect(db.getLocations).not.toHaveBeenCalled()
  })
})

describe('resolveActivityWindow', () => {
  const garmin: Activity = {
    activity_type: 'yoga',
    data: { garmin_field: 1, shared: 'garmin' },
    end_time: new Date('2026-06-08T10:30:00Z'),
    id: 'garmin-id',
    source: 'garmin',
    start_time: start,
    title: 'Yoga',
  }

  beforeEach(() => vi.clearAllMocks())

  test('spans the union of the group and blends its data', async () => {
    const healthConnect: Activity = {
      ...garmin,
      data: { hc_field: 2, shared: 'hc' },
      end_time: new Date('2026-06-08T10:35:00Z'),
      id: 'hc-id',
      source: 'health_connect',
      start_time: new Date('2026-06-08T09:55:00Z'),
    }
    vi.mocked(db.getOverlappingActivities).mockResolvedValue([garmin, healthConnect])

    const result = await resolveActivityWindow('u', garmin, true)

    expect(result).toEqual({
      data: { garmin_field: 1, hc_field: 2, shared: 'garmin' },
      end_time: new Date('2026-06-08T10:35:00Z'),
      start_time: new Date('2026-06-08T09:55:00Z'),
    })
  })

  test('an aurboda override winner keeps its own window and data', async () => {
    const override: Activity = {
      ...garmin,
      data: { shared: 'override' },
      end_time: new Date('2026-06-08T10:20:00Z'),
      id: 'override-id',
      override_target_ids: ['garmin-id'],
      source: 'aurboda',
      start_time: new Date('2026-06-08T10:05:00Z'),
      title: 'Hand typed',
    }
    vi.mocked(db.getOverlappingActivities).mockResolvedValue([garmin, override])

    const result = await resolveActivityWindow('u', garmin, true)

    expect(result).toEqual({
      data: { shared: 'override' },
      end_time: new Date('2026-06-08T10:20:00Z'),
      start_time: new Date('2026-06-08T10:05:00Z'),
    })
  })
})
