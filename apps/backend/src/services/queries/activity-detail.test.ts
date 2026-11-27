import { beforeEach, describe, expect, test, vi } from 'vitest'

import type * as MergeModule from '../../db/activities/merge.ts'
import type { Activity } from '../../db/types.ts'

vi.mock('../../db/index.ts', async () => ({
  getActivityTrack: vi.fn(),
  getDistinctMetrics: vi.fn(),
  getHealthConnectStepRecords: vi.fn(),
  getLocations: vi.fn(),
  getOverlappingActivities: vi.fn(),
  getTimeSeries: vi.fn(),
  getTimeSeriesMultiMetric: vi.fn(),
  pickOverrideWinner: (await vi.importActual<typeof MergeModule>('../../db/activities/merge.ts'))
    .pickOverrideWinner,
  blendGroupData: (await vi.importActual<typeof MergeModule>('../../db/activities/merge.ts')).blendGroupData,
}))
vi.mock('../settings.ts', () => ({ computeHrZoneSecs: vi.fn(), getEffectiveHrZones: vi.fn() }))

const db = await import('../../db/index.ts')
const settings = await import('../settings.ts')
const { computeActivityDetailMetrics, getActivityFullDetail, resolveActivityWindow } =
  await import('./activity-detail.ts')

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

  test("an override shows the track of the row it overrides, timed from that row's start", async () => {
    vi.mocked(db.getActivityTrack).mockResolvedValue({
      activity_id: 'synced',
      full_resolution: true,
      length_m: 1112,
      point_count: 1,
      points: [{ alt: 0, lat: 59, lon: 18, t: 60 }],
      source: 'garmin',
      start_time: new Date('2026-06-08T09:55:00Z'),
    })

    const result = await getActivityFullDetail(
      'u',
      { end_time: end, id: 'override', override_target_ids: ['synced'], start_time: start },
      {},
    )

    expect(db.getActivityTrack).toHaveBeenCalledWith('u', ['override', 'synced'])
    expect(result.gps).toEqual([{ lat: 59, lon: 18, time: '2026-06-08T09:56:00.000Z' }])
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

  test('sets logged in Aurboda win over the watch sets of a session started later (#1777)', async () => {
    const loggedSets = [
      { exercise: 'Bench Press', reps: 8, weight: 60 },
      { exercise: 'Squat', reps: 5, weight: 100 },
    ]
    const logged: Activity = {
      activity_type: 'strength_training',
      data: { in_progress: false, sets: loggedSets },
      end_time: new Date('2026-06-08T10:22:00Z'),
      id: 'logged-id',
      source: 'aurboda',
      start_time: start,
    }
    const watch: Activity = {
      activity_type: 'strength_training',
      data: {
        average_hr: 100,
        garmin_activity_id: 1,
        sets: [{ exercise: 'Unknown exercise', reps: 24 }],
        sets_source: 'garmin',
      },
      end_time: new Date('2026-06-08T10:22:04Z'),
      id: 'watch-id',
      source: 'garmin',
      start_time: new Date('2026-06-08T10:00:04Z'),
    }
    vi.mocked(db.getOverlappingActivities).mockResolvedValue([logged, watch])

    const result = await resolveActivityWindow('u', logged, true)

    expect(result.data?.sets).toEqual(loggedSets)
    expect(result.data).not.toHaveProperty('sets_source')
    expect(result.data).toMatchObject({ average_hr: 100, garmin_activity_id: 1 })
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

describe('computeActivityDetailMetrics steps', () => {
  const GARMIN = 'com.garmin.android.apps.connectmobile'
  const viaHealthConnect = (data: Record<string, unknown> = {}) => ({
    data: { metadata: { dataOrigin: GARMIN }, ...data },
    end_time: end,
    start_time: start,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(settings.getEffectiveHrZones).mockResolvedValue({ zones: [] } as never)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({})
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getHealthConnectStepRecords).mockResolvedValue([
      { count: 100, end: new Date('2026-06-08T10:11:00Z'), start: new Date('2026-06-08T10:10:00Z') },
      { count: 120, end: new Date('2026-06-08T10:31:00Z'), start: new Date('2026-06-08T10:30:00Z') },
    ])
  })

  test('a stored step count wins, even 0, and is not flagged', async () => {
    for (const steps of [3360, 0]) {
      const result = await computeActivityDetailMetrics('u', viaHealthConnect({ steps }))
      expect(result.steps).toBe(steps)
      expect(result.steps_estimated).toBeUndefined()
    }
    expect(db.getHealthConnectStepRecords).not.toHaveBeenCalled()
  })

  test('an activity without a Health Connect origin queries nothing', async () => {
    const result = await computeActivityDetailMetrics('u', { data: {}, end_time: end, start_time: start })

    expect(result.steps).toBeUndefined()
    expect(result.steps_estimated).toBeUndefined()
    expect(db.getHealthConnectStepRecords).not.toHaveBeenCalled()
  })

  test('sums the origin’s step records and flags them estimated', async () => {
    const result = await computeActivityDetailMetrics('u', viaHealthConnect())

    expect(db.getHealthConnectStepRecords).toHaveBeenCalledWith('u', GARMIN, start, end)
    expect(result.steps).toBe(220)
    expect(result.steps_estimated).toBe(true)
  })

  test('without step records neither field is set', async () => {
    vi.mocked(db.getHealthConnectStepRecords).mockResolvedValue([])

    const result = await computeActivityDetailMetrics('u', viaHealthConnect())

    expect(result).not.toHaveProperty('steps')
    expect(result).not.toHaveProperty('steps_estimated')
  })
})
