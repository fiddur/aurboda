import { describe, expect, test, vi } from 'vitest'

import type { SegmentLine, SegmentRecord, TimingTrack } from '../db/segments.ts'

import {
  createSegment,
  getSegmentDetail,
  matchActivitySegments,
  matchSegment,
  rematchActivitySegments,
  type SegmentDeps,
  segmentName,
} from './segments.ts'

vi.mock('./audit-log.ts', () => ({ auditError: vi.fn(), auditInfo: vi.fn(), auditWarn: vi.fn() }))

const LAT0 = 59.3
const LON0 = 18.07
const M_PER_DEG_LAT = 111_195
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180)
const at = (x: number) => ({ lat: LAT0, lon: LON0 + x / M_PER_DEG_LON })

const SEGMENT_POINTS = [at(0), at(500)]
const START = new Date('2026-06-01T07:00:00Z')

/** A run from 200 m before the segment to 200 m after it at 4 m/s: the pass starts at 50 s and takes 125 s. */
const track = (overrides: Partial<TimingTrack> = {}): TimingTrack => ({
  activity_id: 'a1',
  full_resolution: true,
  points: Array.from({ length: 226 }, (_, t) => ({ ...at(-200 + 4 * t), t })),
  source: 'garmin',
  start_time: START,
  ...overrides,
})

const line: SegmentLine = {
  activity_type: 'running',
  end: at(500),
  length_m: 500,
  start: at(0),
  wkt: 'LINESTRING(18.07 59.3, 18.079 59.3)',
}

const record: SegmentRecord = {
  activity_type: 'running',
  best_elapsed_s: 125,
  created_at: START,
  created_from_activity_id: 'a1',
  created_from_route_id: null,
  effort_count: 1,
  id: 's1',
  last_effort_at: START,
  length_m: 500,
  name: 'Hill · 0.5 km',
  updated_at: START,
}

const makeDeps = (overrides: Partial<SegmentDeps> = {}): SegmentDeps => ({
  findNearbyNamedLocation: vi.fn(async () => null),
  findSegmentCandidatesForActivity: vi.fn(async () => []),
  findTrackCandidatesForSegment: vi.fn(async () => []),
  getMetricMeansForWindows: vi.fn(async (_u: string, _m: string, windows: unknown[]) =>
    windows.map(() => 150.04),
  ),
  getSegmentById: vi.fn(async () => record),
  getSegmentLine: vi.fn(async () => ({ length_m: 500, points: SEGMENT_POINTS })),
  getTimingTrack: vi.fn(async () => track()),
  insertSegment: vi.fn(async () => 's1'),
  listSegmentEfforts: vi.fn(async () => []),
  replaceSegmentEfforts: vi.fn(async () => undefined),
  segmentLineFromActivity: vi.fn(async () => ({ line, ok: true as const })),
  segmentLineFromRoute: vi.fn(async () => ({ line, ok: true as const })),
  ...overrides,
})

describe('segmentName', () => {
  test('the nearby place and the length, else "Segment"', () => {
    expect(segmentName({ name: 'Hammarbybacken' }, 812)).toBe('Hammarbybacken · 0.8 km')
    expect(segmentName(null, 1250)).toBe('Segment · 1.3 km')
  })
})

describe('createSegment', () => {
  test('cuts the line from the activity, names it after the nearby place and times history on it', async () => {
    const deps = makeDeps({
      findNearbyNamedLocation: vi.fn(async () => ({ name: 'Hammarbybacken' })),
      findTrackCandidatesForSegment: vi.fn(async () => [{ activity_id: 'a1', source: 'garmin' }]),
    })

    const result = await createSegment(
      'alice',
      { activity_id: 'a1', end_offset_s: 175, start_offset_s: 50 },
      deps,
    )

    expect(result.ok).toBe(true)
    expect(deps.segmentLineFromActivity).toHaveBeenCalledWith('alice', 'a1', 50, 175)
    expect(deps.insertSegment).toHaveBeenCalledWith('alice', {
      activity_type: 'running',
      created_from_activity_id: 'a1',
      name: 'Hammarbybacken · 0.5 km',
      wkt: line.wkt,
    })
    expect(deps.replaceSegmentEfforts).toHaveBeenCalledWith('alice', { segment_id: 's1' }, [
      expect.objectContaining({ activity_id: 'a1', approximate: false, segment_id: 's1', source: 'garmin' }),
    ])
    if (result.ok) {
      expect(result.segment.near_named_location).toEqual({ end: 'Hammarbybacken', start: 'Hammarbybacken' })
      expect(result.segment.points).toEqual(SEGMENT_POINTS)
    }
  })

  test('refuses a near-closed loop: start and end under 50 m apart cannot be timed', async () => {
    const loop = { ...line, end: { lat: LAT0 + 40 / M_PER_DEG_LAT, lon: LON0 }, length_m: 900 }
    const deps = makeDeps({ segmentLineFromActivity: vi.fn(async () => ({ line: loop, ok: true as const })) })

    expect(
      await createSegment('alice', { activity_id: 'a1', end_offset_s: 300, start_offset_s: 0 }, deps),
    ).toEqual({
      error: "A segment's start and end must be at least 50 m apart: a closed loop cannot be timed.",
      ok: false,
    })
    expect(deps.insertSegment).not.toHaveBeenCalled()
  })

  test('from a route km range, with the given name', async () => {
    const deps = makeDeps()
    const result = await createSegment(
      'alice',
      { end_km: 2.5, name: 'Climb', route_id: 'r1', start_km: 2 },
      deps,
    )

    expect(result.ok).toBe(true)
    expect(deps.segmentLineFromRoute).toHaveBeenCalledWith('alice', 'r1', 2, 2.5)
    expect(deps.insertSegment).toHaveBeenCalledWith(
      'alice',
      expect.objectContaining({ created_from_route_id: 'r1', name: 'Climb' }),
    )
    expect(deps.findNearbyNamedLocation).toHaveBeenCalledTimes(2)
  })

  test('refuses a segment under 100 m, a missing track or route and offsets outside them', async () => {
    const short = makeDeps({
      segmentLineFromActivity: vi.fn(async () => ({ line: { ...line, length_m: 80 }, ok: true as const })),
    })
    expect(
      await createSegment('alice', { activity_id: 'a1', end_offset_s: 20, start_offset_s: 0 }, short),
    ).toEqual({
      error: 'A segment must be at least 100 m long (this one is 80 m)',
      ok: false,
    })
    expect(short.insertSegment).not.toHaveBeenCalled()

    const noTrack = makeDeps({
      segmentLineFromActivity: vi.fn(async () => ({ ok: false as const, reason: 'not_found' as const })),
    })
    expect(
      await createSegment('alice', { activity_id: 'a1', end_offset_s: 20, start_offset_s: 0 }, noTrack),
    ).toMatchObject({ error: 'The activity has no GPS track', ok: false })

    const outside = makeDeps({
      segmentLineFromRoute: vi.fn(async () => ({ ok: false as const, reason: 'out_of_range' as const })),
    })
    expect(await createSegment('alice', { end_km: 9, route_id: 'r1', start_km: 8 }, outside)).toMatchObject({
      error: 'start_km and end_km must lie within the route',
      ok: false,
    })

    const deleted = makeDeps({
      segmentLineFromRoute: vi.fn(async () => ({ ok: false as const, reason: 'not_found' as const })),
    })
    expect(await createSegment('alice', { end_km: 2, route_id: 'r1', start_km: 1 }, deleted)).toMatchObject({
      ok: false,
    })
  })

  test('refuses an incomplete body', async () => {
    const deps = makeDeps()
    expect(await createSegment('alice', { activity_id: 'a1', start_offset_s: 3 }, deps)).toMatchObject({
      ok: false,
    })
    expect(deps.insertSegment).not.toHaveBeenCalled()
  })
})

describe('matchActivitySegments', () => {
  test('times each covering track on each segment and replaces all of the activity efforts', async () => {
    const deps = makeDeps({
      findSegmentCandidatesForActivity: vi.fn(async () => [
        { segment_id: 's1', source: 'garmin' },
        { segment_id: 's1', source: 'strava' },
      ]),
      getTimingTrack: vi.fn(async (_u: string, _a: string, source: string) =>
        track({ full_resolution: source === 'garmin', source }),
      ),
    })

    expect(await matchActivitySegments('alice', 'a1', deps)).toEqual({ efforts: 2 })

    const [, scope, rows] = vi.mocked(deps.replaceSegmentEfforts).mock.calls[0]!
    expect(scope).toEqual({ activity_id: 'a1' })
    expect(rows.map((r) => [r.source, r.approximate])).toEqual([
      ['garmin', false],
      ['strava', true],
    ])
    expect(rows[0]!.start_offset_s).toBeCloseTo(50, 0)
    expect(rows[0]!.elapsed_s).toBeCloseTo(125, 0)
    expect(rows[0]!.pace_s_per_km).toBeCloseTo(250, 0)
    expect(rows[0]!.avg_hr).toBe(150)
    expect(deps.getSegmentLine).toHaveBeenCalledTimes(1)
    const [, metric, windows] = vi.mocked(deps.getMetricMeansForWindows).mock.calls[0]!
    expect(metric).toBe('heart_rate')
    expect(windows[0]!.start.getTime()).toBeCloseTo(START.getTime() + 50_000, -3)
  })

  test('an activity that covers no segment loses its efforts', async () => {
    const deps = makeDeps()
    await matchActivitySegments('alice', 'a1', deps)
    expect(deps.replaceSegmentEfforts).toHaveBeenCalledWith('alice', { activity_id: 'a1' }, [])
  })

  test('a heart rate gap leaves avg_hr null', async () => {
    const deps = makeDeps({
      findSegmentCandidatesForActivity: vi.fn(async () => [{ segment_id: 's1', source: 'garmin' }]),
      getMetricMeansForWindows: vi.fn(async () => [undefined]),
    })
    await matchActivitySegments('alice', 'a1', deps)
    expect(vi.mocked(deps.replaceSegmentEfforts).mock.calls[0]![2][0]!.avg_hr).toBeNull()
  })
})

describe('matchSegment', () => {
  test('replaces the segment efforts with every covering track and counts them', async () => {
    const deps = makeDeps({
      findTrackCandidatesForSegment: vi.fn(async () => [
        { activity_id: 'a1', source: 'garmin' },
        { activity_id: 'a2', source: 'garmin' },
        { activity_id: 'a3', source: 'garmin' },
      ]),
      getTimingTrack: vi.fn(async (_u: string, activityId: string) =>
        activityId === 'a3'
          ? track({ activity_id: 'a3', points: track().points.slice(0, 60) })
          : track({ activity_id: activityId }),
      ),
    })

    expect(await matchSegment('alice', 's1', deps)).toEqual({ activities: 2, efforts: 2 })
    expect(vi.mocked(deps.replaceSegmentEfforts).mock.calls[0]![1]).toEqual({ segment_id: 's1' })
  })

  test('null for an unknown segment', async () => {
    const deps = makeDeps({ getSegmentLine: vi.fn(async () => null) })
    expect(await matchSegment('alice', 's9', deps)).toBeNull()
    expect(deps.replaceSegmentEfforts).not.toHaveBeenCalled()
  })
})

describe('rematchActivitySegments', () => {
  test('re-matches each activity and keeps going after a failure', async () => {
    const deps = makeDeps({
      findSegmentCandidatesForActivity: vi.fn(async (_u: string, id: string) =>
        id === 'a1' ? Promise.reject(new Error('locked')) : [],
      ),
    })
    await rematchActivitySegments('alice', ['a1', 'a2'], deps)
    expect(deps.replaceSegmentEfforts).toHaveBeenCalledWith('alice', { activity_id: 'a2' }, [])
  })
})

describe('getSegmentDetail', () => {
  test('the segment with its line, efforts and the named places near its ends', async () => {
    const deps = makeDeps({
      findNearbyNamedLocation: vi.fn(async (_u: string, _lat: number, lon: number) =>
        lon === SEGMENT_POINTS[0]!.lon ? { name: 'Home' } : null,
      ),
      listSegmentEfforts: vi.fn(async () => [
        {
          activity_id: 'a1',
          activity_start_time: START,
          approximate: false,
          avg_hr: 150,
          elapsed_s: 125,
          is_best: true,
          pace_s_per_km: 250,
          rank: 1,
          segment_id: 's1',
          source: 'garmin',
          start_offset_s: 50,
        },
      ]),
    })

    const detail = await getSegmentDetail('alice', 's1', deps)

    expect(detail).toMatchObject({
      best_elapsed_s: 125,
      created_at: START.toISOString(),
      efforts: [
        {
          activity_id: 'a1',
          activity_start_time: START.toISOString(),
          approximate: false,
          avg_hr: 150,
          elapsed_s: 125,
          is_best: true,
          pace_s_per_km: 250,
          start_offset_s: 50,
        },
      ],
      near_named_location: { end: null, start: 'Home' },
    })
    expect(
      await getSegmentDetail('alice', 's9', makeDeps({ getSegmentById: vi.fn(async () => null) })),
    ).toBeNull()
  })
})
