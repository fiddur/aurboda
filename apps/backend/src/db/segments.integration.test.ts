import type { DataSource } from '@aurboda/api-spec'

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import {
  createSegment,
  defaultSegmentDeps,
  defaultSegmentOps,
  getSegmentDetail,
  matchActivitySegments,
  rematchActivitySegments,
} from '../services/segments.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { insertActivity, insertOverride } from './activities/index.ts'
import { query } from './connection.ts'
import { insertNamedLocation } from './locations.ts'
import { createRouteWithPair, deleteRoute } from './routes.ts'
import {
  deleteSegment,
  findSegmentCandidatesForActivity,
  findTrackCandidatesForSegment,
  getSegmentById,
  getSegmentLine,
  getTimingTrack,
  insertSegment,
  listActivitySegmentEfforts,
  listSegmentEfforts,
  listSegments,
  replaceSegmentEfforts,
  segmentLineFromActivity,
  segmentLineFromRoute,
  updateSegment,
} from './segments.ts'
import { upsertActivityTrack } from './tracks.ts'

const CONTAINER_TIMEOUT = 120_000

const LAT0 = 59.3
const LON0 = 18.07
const M_PER_DEG_LAT = 111_195
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180)

type Xy = [number, number]

const toLonLat = ([x, y]: Xy): Xy => [LON0 + x / M_PER_DEG_LON, LAT0 + y / M_PER_DEG_LAT]

/** Points every 20 m along straight legs between the corners. */
const densify = (corners: Xy[], step = 20): Xy[] => {
  const out: Xy[] = [corners[0]!]
  for (let i = 1; i < corners.length; i++) {
    const [x0, y0] = corners[i - 1]!
    const [x1, y1] = corners[i]!
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step))
    for (let k = 1; k <= n; k++) out.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n])
  }
  return out
}

/** One point per 20 m at 4 m/s: M = 5 s per point. */
const ewkt = (points: Xy[]): string =>
  `SRID=4326;LINESTRING ZM(${points
    .map(toLonLat)
    .map(([lon, lat], i) => `${lon.toFixed(7)} ${lat.toFixed(7)} 0 ${i * 5}`)
    .join(', ')})`

/** A 2 km L: 1 km east, then 1 km north. */
const L_SHAPE = densify([
  [0, 0],
  [1000, 0],
  [1000, 1000],
])
const REVERSED = [...L_SHAPE].reverse()
/** Twice east along the first leg, back 60 m north of it. */
const REPEATS = densify([
  [0, 0],
  [600, 0],
  [600, 60],
  [0, 60],
  [0, 0],
  [600, 0],
  [600, 60],
])

let day = 0

const addTrackedActivity = async (
  points: Xy[],
  {
    activityType = 'running',
    source = 'garmin',
    fullResolution = true,
    start,
  }: { activityType?: string; source?: DataSource; fullResolution?: boolean; start?: Date } = {},
): Promise<string> => {
  const user = getTestUser()
  day++
  const startTime = start ?? new Date(Date.UTC(2026, 5, day, 7))
  const id = await insertActivity(user, {
    activity_type: activityType,
    end_time: new Date(startTime.getTime() + points.length * 5000),
    external_id: `ext-${day}-${source}`,
    source,
    start_time: startTime,
  })
  await upsertActivityTrack(user, {
    activity_id: id,
    ewkt: ewkt(points),
    full_resolution: fullResolution,
    source,
  })
  return id
}

/** The first leg's 200–600 m: entered at 50 s, left at 150 s on an L_SHAPE run. */
const cutFirstLeg = async (activityId: string) => {
  const result = await createSegment(
    getTestUser(),
    { activity_id: activityId, end_offset_s: 150, start_offset_s: 50 },
    defaultSegmentDeps,
  )
  if (!result.ok) throw new Error(result.error)
  return result.segment
}

describe('Segments integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
    day = 0
  })

  describe('cutting the line', () => {
    test('from an activity: the part of the track between two offsets, across a corner too', async () => {
      const user = getTestUser()
      const activityId = await addTrackedActivity(L_SHAPE)

      const straight = await segmentLineFromActivity(user, activityId, 50, 150)
      expect(straight.ok).toBe(true)
      if (!straight.ok) return
      expect(straight.line.activity_type).toBe('running')
      expect(straight.line.length_m).toBeCloseTo(400, -1)
      expect(straight.line.start.lon).toBeCloseTo(LON0 + 200 / M_PER_DEG_LON, 5)
      expect(straight.line.end.lon).toBeCloseTo(LON0 + 600 / M_PER_DEG_LON, 5)
      expect(straight.line.wkt).toMatch(/^LINESTRING\(/)

      const corner = await segmentLineFromActivity(user, activityId, 200, 300)
      expect(corner.ok && corner.line.length_m).toBeCloseTo(400, -1)
      expect(corner.ok && corner.line.end.lat).toBeCloseTo(LAT0 + 200 / M_PER_DEG_LAT, 5)
    })

    test('from an activity: refuses offsets outside the track and an activity without one', async () => {
      const user = getTestUser()
      const activityId = await addTrackedActivity(L_SHAPE)
      expect(await segmentLineFromActivity(user, activityId, 100, 9999)).toEqual({
        ok: false,
        reason: 'out_of_range',
      })
      const bare = await insertActivity(user, {
        activity_type: 'running',
        source: 'aurboda',
        start_time: new Date(Date.UTC(2026, 0, 1)),
      })
      expect(await segmentLineFromActivity(user, bare, 0, 10)).toEqual({ ok: false, reason: 'not_found' })
    })

    test('from a route: a km range measured in metres, not degrees; refuses past the end and a deleted route', async () => {
      const user = getTestUser()
      const activityId = await addTrackedActivity(L_SHAPE)
      const routeId = (await createRouteWithPair(user, {
        canonical: { activity_id: activityId, name: 'L' },
      }))!

      const cut = await segmentLineFromRoute(user, routeId, 0.8, 1.2)
      expect(cut.ok).toBe(true)
      if (!cut.ok) return
      expect(cut.line.length_m).toBeCloseTo(400, -1)
      expect(cut.line.start.lon).toBeCloseTo(LON0 + 800 / M_PER_DEG_LON, 4)
      expect(cut.line.end.lat).toBeCloseTo(LAT0 + 200 / M_PER_DEG_LAT, 4)

      expect(await segmentLineFromRoute(user, routeId, 1, 2.5)).toEqual({ ok: false, reason: 'out_of_range' })
      expect((await segmentLineFromRoute(user, routeId, 1, 2.02)).ok).toBe(true)

      await deleteRoute(user, routeId)
      expect(await segmentLineFromRoute(user, routeId, 0.8, 1.2)).toEqual({ ok: false, reason: 'not_found' })
    })
  })

  describe('createSegment', () => {
    test('times every covering track of the type, one way only, and names it', async () => {
      const user = getTestUser()
      const first = await addTrackedActivity(L_SHAPE)
      const second = await addTrackedActivity(L_SHAPE)
      await addTrackedActivity(REVERSED)
      await addTrackedActivity(L_SHAPE, { activityType: 'walking' })
      await insertNamedLocation(user, { lat: LAT0, lon: LON0 + 210 / M_PER_DEG_LON, name: 'The gate' })

      const segment = await cutFirstLeg(first)

      expect(segment).toMatchObject({
        activity_type: 'running',
        created_from_activity_id: first,
        created_from_route_id: null,
        effort_count: 2,
        name: 'The gate · 0.4 km',
        near_named_location: { end: 'The gate', start: 'The gate' },
      })
      expect(segment.best_elapsed_s).toBeCloseTo(100, 0)
      expect(segment.efforts.map((e) => e.activity_id)).toEqual([second, first])
      expect(segment.efforts[0]).toMatchObject({ approximate: false, avg_hr: null })
      expect(segment.efforts[0]!.start_offset_s).toBeCloseTo(50, 0)
      expect(segment.efforts[0]!.pace_s_per_km).toBeCloseTo(250, -1)
      expect(segment.efforts.filter((e) => e.is_best)).toHaveLength(1)
      expect(segment.points.length).toBeGreaterThanOrEqual(2)
    })

    test('refuses a segment shorter than 100 m', async () => {
      const activityId = await addTrackedActivity(L_SHAPE)
      const result = await createSegment(
        getTestUser(),
        { activity_id: activityId, end_offset_s: 60, start_offset_s: 50 },
        defaultSegmentDeps,
      )
      expect(result).toMatchObject({ ok: false })
      expect(await listSegments(getTestUser())).toEqual([])
    })
  })

  describe('matching', () => {
    test('candidates both ways: a covering track of the type, not a track elsewhere', async () => {
      const user = getTestUser()
      const first = await addTrackedActivity(L_SHAPE)
      const segment = await cutFirstLeg(first)
      const elsewhere = await addTrackedActivity(
        densify([
          [0, 500],
          [1000, 500],
        ]),
      )
      const reversed = await addTrackedActivity(REVERSED, { source: 'strava' })

      expect(await findSegmentCandidatesForActivity(user, first)).toEqual([
        { segment_id: segment.id, source: 'garmin' },
      ])
      expect(await findSegmentCandidatesForActivity(user, elsewhere)).toEqual([])
      expect(await findTrackCandidatesForSegment(user, segment.id)).toEqual(
        [
          { activity_id: first, source: 'garmin' },
          { activity_id: reversed, source: 'strava' },
        ].sort((a, b) => a.activity_id.localeCompare(b.activity_id)),
      )
    })

    test('a new track is timed against existing segments, idempotently; repeats give one effort per pass', async () => {
      const user = getTestUser()
      const segment = await cutFirstLeg(await addTrackedActivity(L_SHAPE))
      const repeats = await addTrackedActivity(REPEATS)

      expect(await matchActivitySegments(user, repeats, defaultSegmentDeps)).toEqual({ efforts: 2 })
      expect(await matchActivitySegments(user, repeats, defaultSegmentDeps)).toEqual({ efforts: 2 })

      const efforts = await listActivitySegmentEfforts(user, [repeats])
      expect(efforts).toHaveLength(2)
      expect(efforts.map((e) => e.segment_name)).toEqual([segment.name, segment.name])
      expect(efforts[0]!.start_offset_s).toBeLessThan(efforts[1]!.start_offset_s)
      for (const effort of efforts) expect(effort.rank).toBeLessThanOrEqual(3)
      expect((await getSegmentById(user, segment.id))!.effort_count).toBe(3)
    })

    test('a retype re-matches: a walk leaves the running segment', async () => {
      const user = getTestUser()
      const first = await addTrackedActivity(L_SHAPE)
      const segment = await cutFirstLeg(first)
      const second = await addTrackedActivity(L_SHAPE)
      await matchActivitySegments(user, second, defaultSegmentDeps)
      const { start_time, end_time } = (
        await query(user, `SELECT start_time, end_time FROM activities WHERE id = $1`, [second])
      ).rows[0] as { start_time: Date; end_time: Date }
      await insertOverride(user, [second], { activity_type: 'walking', end_time, start_time })

      await rematchActivitySegments(user, [second], defaultSegmentDeps)

      expect(await listActivitySegmentEfforts(user, [second])).toEqual([])
      expect((await getSegmentById(user, segment.id))!.effort_count).toBe(1)
    })
  })

  describe('efforts', () => {
    test('one session recorded by two sources counts once, the full-resolution row kept', async () => {
      const user = getTestUser()
      const garmin = await addTrackedActivity(L_SHAPE)
      const start = (await query(user, `SELECT start_time FROM activities WHERE id = $1`, [garmin])).rows[0]
        .start_time as Date
      const strava = await addTrackedActivity(L_SHAPE, {
        fullResolution: false,
        source: 'strava',
        start: new Date(start.getTime() + 2000),
      })
      const segment = await cutFirstLeg(strava)

      const efforts = await listSegmentEfforts(user, segment.id)
      expect(efforts).toHaveLength(1)
      expect(efforts[0]).toMatchObject({ activity_id: garmin, approximate: false, is_best: true, rank: 1 })
      expect((await getSegmentById(user, segment.id))!.effort_count).toBe(1)
      expect(await listActivitySegmentEfforts(user, [strava])).toEqual([])
    })

    test('the best effort is the fastest non-approximate one; rank counts every kept effort', async () => {
      const user = getTestUser()
      const segment = await cutFirstLeg(await addTrackedActivity(L_SHAPE))
      const other = await addTrackedActivity(L_SHAPE, { fullResolution: false, source: 'strava' })
      const base = {
        approximate: false,
        avg_hr: 150,
        pace_s_per_km: 250,
        segment_id: segment.id,
        source: 'strava',
      }
      await replaceSegmentEfforts(user, { activity_id: other, segment_id: segment.id }, [
        { ...base, activity_id: other, approximate: true, elapsed_s: 80, start_offset_s: 50 },
        { ...base, activity_id: other, approximate: true, elapsed_s: 90, start_offset_s: 400 },
      ])

      const efforts = await listSegmentEfforts(user, segment.id)
      expect(efforts.map((e) => [e.elapsed_s, e.rank, e.is_best])).toEqual([
        [90, 2, false],
        [80, 1, false],
        [expect.closeTo(100, 0), 3, true],
      ])
      expect((await getSegmentById(user, segment.id))!.best_elapsed_s).toBeCloseTo(100, 0)
    })

    test('writing is scoped and idempotent', async () => {
      const user = getTestUser()
      const first = await addTrackedActivity(L_SHAPE)
      const segment = await cutFirstLeg(first)
      const row = {
        activity_id: first,
        approximate: false,
        avg_hr: null,
        elapsed_s: 100,
        pace_s_per_km: 250,
        segment_id: segment.id,
        source: 'garmin',
        start_offset_s: 50,
      }
      await replaceSegmentEfforts(user, { activity_id: first }, [row, row])
      await replaceSegmentEfforts(user, { activity_id: first }, [row])
      expect(await listSegmentEfforts(user, segment.id)).toHaveLength(1)
      await replaceSegmentEfforts(user, { segment_id: segment.id }, [])
      expect(await listSegmentEfforts(user, segment.id)).toEqual([])
      await expect(replaceSegmentEfforts(user, {}, [])).rejects.toThrow()
    })

    test('the timing track carries every point with its offset', async () => {
      const first = await addTrackedActivity(L_SHAPE, { fullResolution: false })
      const track = await getTimingTrack(getTestUser(), first, 'garmin')
      expect(track).toMatchObject({ activity_id: first, full_resolution: false, source: 'garmin' })
      expect(track!.points).toHaveLength(L_SHAPE.length)
      expect(track!.points[1]!.t).toBe(5)
      expect(await getTimingTrack(getTestUser(), first, 'strava')).toBeNull()
    })
  })

  describe('list, rename and delete', () => {
    test('lists by type and order, renames, and deletes with the efforts', async () => {
      const user = getTestUser()
      const first = await addTrackedActivity(L_SHAPE)
      const segment = await cutFirstLeg(first)
      const wkt = 'LINESTRING(18.2 59.4, 18.21 59.4)'
      const quiet = await insertSegment(user, { activity_type: 'walking', name: 'A walk', wkt })

      expect((await listSegments(user)).map((s) => s.id)).toEqual([segment.id, quiet])
      expect((await listSegments(user, { sort: 'alphabetical' })).map((s) => s.id)).toEqual([
        quiet,
        segment.id,
      ])
      expect((await listSegments(user, { sort: 'length' })).map((s) => s.id)).toEqual([quiet, segment.id])
      expect((await listSegments(user, { activityTypes: ['walking'] })).map((s) => s.id)).toEqual([quiet])
      expect(await listSegments(user, { activityTypes: [] })).toEqual([])
      expect((await getSegmentLine(user, quiet))!.points).toEqual([
        { lat: 59.4, lon: 18.2 },
        { lat: 59.4, lon: 18.21 },
      ])

      expect((await updateSegment(user, segment.id, { name: 'The stretch' }))!.name).toBe('The stretch')
      expect(await updateSegment(user, '00000000-0000-4000-8000-000000000000', { name: 'x' })).toBeNull()

      expect(await deleteSegment(user, segment.id)).toBe(true)
      expect(await deleteSegment(user, segment.id)).toBe(false)
      expect(await getSegmentById(user, segment.id)).toBeNull()
      const left = await query(user, `SELECT COUNT(*)::int AS n FROM segment_efforts`)
      expect(left.rows[0].n).toBe(0)
    })

    test('the ops list filters by a parent type with its descendants', async () => {
      const user = getTestUser()
      await cutFirstLeg(await addTrackedActivity(L_SHAPE))
      expect(
        await defaultSegmentOps.list(user, { activity_type: 'running', sort: 'last_effort' }),
      ).toHaveLength(1)
      expect(await defaultSegmentOps.list(user, { activity_type: 'cycling', sort: 'last_effort' })).toEqual(
        [],
      )
      expect(
        await getSegmentDetail(user, '00000000-0000-4000-8000-000000000000', defaultSegmentDeps),
      ).toBeNull()
    })
  })
})
