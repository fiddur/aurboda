import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { defaultRouteMatchDeps, matchActivityRoute, matchUnroutedTracks } from '../services/routes.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { getActivities, insertActivity } from './activities/index.ts'
import { query } from './connection.ts'
import {
  attachActivityToRoute,
  createRouteFromTrack,
  deleteRoute,
  findRouteCandidates,
  findUnroutedTrackCandidates,
  getRouteById,
  getRouteForActivity,
  getRouteGeometry,
  getTrackedActivity,
  getTrackSummary,
  listRouteEfforts,
  listRoutes,
  listUnroutedTrackedActivities,
  mergeRoutes,
  routeDirectionFractions,
  trackDirectionFractions,
  updateRoute,
} from './routes.ts'
import { upsertActivityTrack } from './tracks.ts'

const CONTAINER_TIMEOUT = 120_000

const LAT0 = 59.3
const LON0 = 18.07
const M_PER_DEG_LAT = 111_320
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180)

type Xy = [number, number]

/** Metres east/north of the origin → [lon, lat]. */
const toLonLat = ([x, y]: Xy): Xy => [LON0 + x / M_PER_DEG_LON, LAT0 + y / M_PER_DEG_LAT]

/** Points every `step` metres along straight legs between the corners. */
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

/** A 2 km L: 1 km east, then 1 km north. */
const L_SHAPE: Xy[] = [
  [0, 0],
  [1000, 0],
  [1000, 1000],
]

/** Deterministic 2–5 m offsets. */
const jitter = (points: Xy[]): Xy[] =>
  points.map(([x, y], i) => {
    const r = 2 + ((i * 7919) % 31) / 10
    const a = (i * 2.399963) % (2 * Math.PI)
    return [x + r * Math.cos(a), y + r * Math.sin(a)]
  })

const ewkt = (points: Xy[]): string =>
  `SRID=4326;LINESTRING ZM(${points
    .map(toLonLat)
    .map(([lon, lat], i) => `${lon.toFixed(7)} ${lat.toFixed(7)} 0 ${i * 5}`)
    .join(', ')})`

const base = densify(L_SHAPE)
const jittered = jitter(base)
const reversed = [...jitter(base)].reverse()
/** A 50 m × 50 m bump off the first leg: 100 m of extra path. */
const detour = densify([
  [0, 0],
  [400, 0],
  [400, 50],
  [450, 50],
  [450, 0],
  [1000, 0],
  [1000, 1000],
])
const parallel = densify([
  [0, 200],
  [800, 200],
  [800, 1000],
])
/** 1 km east and back the same way. */
const outAndBack = densify([
  [0, 0],
  [1000, 0],
  [0, 0],
])

let day = 0

const addTrackedActivity = async (
  points: Xy[],
  { activityType = 'running', source = 'garmin' }: { activityType?: string; source?: string } = {},
): Promise<string> => {
  const user = getTestUser()
  day++
  const start = new Date(Date.UTC(2026, 5, day, 7))
  const id = await insertActivity(user, {
    activity_type: activityType,
    data: { distance: 2000 },
    end_time: new Date(start.getTime() + 600_000),
    external_id: `ext-${day}`,
    source: 'garmin',
    start_time: start,
    title: `Run ${day}`,
  })
  await upsertActivityTrack(user, { activity_id: id, ewkt: ewkt(points), full_resolution: true, source })
  return id
}

describe('Routes integration', () => {
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

  const makeRoute = async (points: Xy[] = base, activityType?: string) => {
    const activityId = await addTrackedActivity(points, { activityType })
    const routeId = await createRouteFromTrack(getTestUser(), { activity_id: activityId, name: 'Test route' })
    await attachActivityToRoute(getTestUser(), activityId, routeId!, 1)
    return { activityId, routeId: routeId! }
  }

  describe('createRouteFromTrack', () => {
    test('builds the route from the track, with its type, length and ends', async () => {
      const { activityId, routeId } = await makeRoute()
      const route = await getRouteById(getTestUser(), routeId)

      expect(route).toMatchObject({
        activity_count: 1,
        activity_type: 'running',
        canonical_activity_id: activityId,
        name: 'Test route',
      })
      expect(route!.length_m).toBeGreaterThan(1990)
      expect(route!.length_m).toBeLessThan(2010)
      expect(route!.start.lat).toBeCloseTo(LAT0, 4)
      expect(route!.end.lon).toBeCloseTo(LON0 + 1000 / M_PER_DEG_LON, 4)
      expect(route!.last_activity_at).toEqual(new Date(Date.UTC(2026, 5, 1, 7)))

      const geometry = await getRouteGeometry(getTestUser(), routeId)
      expect(geometry!.points[0]!.lat).toBeCloseTo(LAT0, 5)
      expect(geometry!.points.length).toBeGreaterThanOrEqual(3)
      const summary = await getTrackSummary(getTestUser(), activityId)
      expect(summary!.start).toEqual(route!.start)
      expect(summary!.length_m).toBeCloseTo(route!.length_m, 3)
      expect(await getTrackedActivity(getTestUser(), activityId)).toEqual({
        activity_id: activityId,
        start_time: new Date(Date.UTC(2026, 5, 1, 7)),
      })
    })

    test('returns null for an activity without a track', async () => {
      const id = await insertActivity(getTestUser(), {
        activity_type: 'running',
        end_time: new Date('2026-06-01T08:00:00Z'),
        source: 'garmin',
        start_time: new Date('2026-06-01T07:00:00Z'),
      })
      expect(await createRouteFromTrack(getTestUser(), { activity_id: id, name: 'x' })).toBeNull()
      expect(await getTrackedActivity(getTestUser(), id)).toBeNull()
      expect(await getTrackSummary(getTestUser(), id)).toBeNull()
    })

    test('stores the buffer of a self-crossing line', async () => {
      const figureEight = densify([
        [0, 0],
        [500, 500],
        [500, 0],
        [0, 500],
        [0, 0],
      ])
      const { routeId } = await makeRoute(figureEight)
      const rows = await query(getTestUser(), `SELECT ST_IsValid(buffer) AS ok FROM routes WHERE id = $1`, [
        routeId,
      ])
      expect(rows.rows[0].ok).toBe(true)
    })

    test('a second route from the same canonical activity is rejected', async () => {
      const { activityId } = await makeRoute()
      await expect(
        createRouteFromTrack(getTestUser(), { activity_id: activityId, name: 'Again' }),
      ).rejects.toThrow()
    })
  })

  describe('findRouteCandidates', () => {
    test('a jittered copy and a copy with a 100 m detour cover the route both ways', async () => {
      const user = getTestUser()
      const { routeId } = await makeRoute()

      for (const points of [jittered, detour]) {
        const id = await addTrackedActivity(points)
        const [candidate] = await findRouteCandidates(user, id)
        expect(candidate!.route_id).toBe(routeId)
        expect(candidate!.coverage_track).toBeGreaterThanOrEqual(0.9)
        expect(candidate!.coverage_route).toBeGreaterThanOrEqual(0.9)
      }
    })

    test('a parallel line 200 m away does not cover it', async () => {
      const user = getTestUser()
      await makeRoute()
      const id = await addTrackedActivity(parallel)
      const candidates = await findRouteCandidates(user, id)
      for (const c of candidates) expect(Math.min(c.coverage_track, c.coverage_route)).toBeLessThan(0.9)
    })

    test('a route of another activity type is not a candidate', async () => {
      await makeRoute()
      const id = await addTrackedActivity(jittered, { activityType: 'walking' })
      expect(await findRouteCandidates(getTestUser(), id)).toEqual([])
    })

    test('a far-away route is not a candidate', async () => {
      await makeRoute()
      const far = base.map(([x, y]): Xy => [x + 10_000, y])
      const id = await addTrackedActivity(far)
      expect(await findRouteCandidates(getTestUser(), id)).toEqual([])
    })
  })

  describe('direction', () => {
    test('a forward copy projects increasingly, a reversed one decreasingly', async () => {
      const user = getTestUser()
      const { routeId } = await makeRoute()
      const forwardId = await addTrackedActivity(jittered)
      const reverseId = await addTrackedActivity(reversed)

      const forward = await routeDirectionFractions(user, forwardId, routeId)
      expect(forward.length).toBeGreaterThanOrEqual(20)
      expect(forward.every((f, i) => i === 0 || f >= forward[i - 1]!)).toBe(true)

      const backward = await routeDirectionFractions(user, reverseId, routeId)
      expect(backward.length).toBeGreaterThanOrEqual(20)
      expect(backward.every((f, i) => i === 0 || f <= backward[i - 1]!)).toBe(true)
    })

    test('against another track', async () => {
      const user = getTestUser()
      const a = await addTrackedActivity(base)
      const b = await addTrackedActivity(reversed)
      const fractions = await trackDirectionFractions(user, b, a)
      expect(fractions.length).toBeGreaterThanOrEqual(20)
      expect(fractions[0]!).toBeGreaterThan(fractions.at(-1)!)
    })
  })

  describe('findUnroutedTrackCandidates', () => {
    test('lists earlier unrouted tracks of the same type with both coverages', async () => {
      const user = getTestUser()
      const first = await addTrackedActivity(base)
      await addTrackedActivity(jittered, { activityType: 'walking' })
      const second = await addTrackedActivity(jittered)

      const candidates = await findUnroutedTrackCandidates(user, second)
      expect(candidates.map((c) => c.activity_id)).toEqual([first])
      expect(candidates[0]!.coverage_track).toBeGreaterThanOrEqual(0.9)
      expect(candidates[0]!.coverage_route).toBeGreaterThanOrEqual(0.9)
      expect(candidates[0]!.start_time).toEqual(new Date(Date.UTC(2026, 5, 1, 7)))
    })

    test('skips routed, deleted and time-overlapping activities', async () => {
      const user = getTestUser()
      await makeRoute()
      const deleted = await addTrackedActivity(base)
      await query(user, `UPDATE activities SET deleted_at = NOW() WHERE id = $1`, [deleted])
      const current = await addTrackedActivity(jittered)
      const sameSession = await insertActivity(user, {
        activity_type: 'running',
        end_time: new Date(Date.UTC(2026, 5, day, 7, 10)),
        external_id: 'strava-copy',
        source: 'strava',
        start_time: new Date(Date.UTC(2026, 5, day, 7, 0, 30)),
      })
      await upsertActivityTrack(user, {
        activity_id: sameSession,
        ewkt: ewkt(base),
        full_resolution: false,
        source: 'strava',
      })

      expect(await findUnroutedTrackCandidates(user, current)).toEqual([])
    })
  })

  describe('attach, efforts, merge, delete', () => {
    test('attach is idempotent, efforts are newest first and a multi-source run counts once', async () => {
      const user = getTestUser()
      const { activityId, routeId } = await makeRoute()
      const second = await addTrackedActivity(jittered)
      await attachActivityToRoute(user, second, routeId, 0.97)
      await attachActivityToRoute(user, second, routeId, 0.5)
      const copy = await insertActivity(user, {
        activity_type: 'running',
        end_time: new Date(Date.UTC(2026, 5, 2, 7, 10)),
        external_id: 'strava-copy',
        source: 'strava',
        start_time: new Date(Date.UTC(2026, 5, 2, 7, 0, 30)),
      })
      await attachActivityToRoute(user, copy, routeId, 0.95)

      const efforts = await listRouteEfforts(user, routeId)
      expect(efforts.map((e) => e.activity_id)).toEqual([second, activityId])
      expect(efforts[0]).toMatchObject({
        coverage: expect.closeTo(0.97, 5),
        data_distance: 2000,
        title: 'Run 2',
      })
      expect((await getRouteById(user, routeId))!.activity_count).toBe(2)
      expect((await getRouteForActivity(user, second))!.id).toBe(routeId)
    })

    test('a deleted activity drops out of the count and its route lookup', async () => {
      const user = getTestUser()
      const { activityId, routeId } = await makeRoute()
      await query(user, `UPDATE activities SET deleted_at = NOW() WHERE id = $1`, [activityId])

      expect((await getRouteById(user, routeId))!.activity_count).toBe(0)
      expect(await getRouteForActivity(user, activityId)).toBeNull()
      expect(await listRouteEfforts(user, routeId)).toEqual([])
    })

    test('rename and merge', async () => {
      const user = getTestUser()
      const a = await makeRoute()
      const b = await makeRoute(jittered)
      const extra = await addTrackedActivity(detour)
      await attachActivityToRoute(user, extra, b.routeId, 0.95)

      expect((await updateRoute(user, a.routeId, { name: 'Renamed' }))!.name).toBe('Renamed')
      expect(await updateRoute(user, '00000000-0000-0000-0000-000000000000', { name: 'x' })).toBeNull()

      expect(await mergeRoutes(user, b.routeId, a.routeId)).toBe(2)
      expect(await getRouteById(user, b.routeId)).toBeNull()
      expect((await getRouteById(user, a.routeId))!.activity_count).toBe(3)
      expect((await getRouteForActivity(user, extra))!.id).toBe(a.routeId)
      expect(await mergeRoutes(user, a.routeId, a.routeId)).toBeNull()
      expect(await mergeRoutes(user, b.routeId, a.routeId)).toBeNull()

      expect((await listRoutes(user)).map((r) => r.id)).toEqual([a.routeId])
      expect(await listUnroutedTrackedActivities(user)).toEqual([])
    })

    test('routes of different types or deleted routes do not merge', async () => {
      const user = getTestUser()
      const running = await makeRoute()
      const walking = await makeRoute(jittered, 'walking')
      expect(await mergeRoutes(user, walking.routeId, running.routeId)).toBeNull()
      expect((await getRouteById(user, walking.routeId))!.activity_count).toBe(1)

      const other = await makeRoute(detour)
      await deleteRoute(user, other.routeId)
      expect(await mergeRoutes(user, other.routeId, running.routeId)).toBeNull()
      expect(await mergeRoutes(user, running.routeId, other.routeId)).toBeNull()
      expect((await getRouteById(user, running.routeId))!.activity_count).toBe(1)
    })

    test('a deleted route is hidden, keeps its runs out of matching and is not revived', async () => {
      const user = getTestUser()
      const { activityId, routeId } = await makeRoute()
      const second = await addTrackedActivity(jittered)
      await attachActivityToRoute(user, second, routeId, 0.97)

      expect(await deleteRoute(user, routeId)).toBe(true)
      expect(await deleteRoute(user, routeId)).toBe(false)
      expect(await getRouteById(user, routeId)).toBeNull()
      expect(await getRouteGeometry(user, routeId)).toBeNull()
      expect(await listRoutes(user)).toEqual([])
      expect(await listRouteEfforts(user, routeId)).toEqual([])
      expect(await updateRoute(user, routeId, { name: 'x' })).toBeNull()
      expect(await getRouteForActivity(user, activityId)).toBeNull()
      expect(await getRouteForActivity(user, second)).toBeNull()
      expect(await listUnroutedTrackedActivities(user)).toEqual([])
      expect(await matchUnroutedTracks(user, defaultRouteMatchDeps)).toEqual({ created: 0, matched: 0 })

      const later = await addTrackedActivity(detour)
      expect(await findRouteCandidates(user, later)).toEqual([])
      expect(await routeDirectionFractions(user, later, routeId)).toEqual([])
      expect(await matchActivityRoute(user, later, defaultRouteMatchDeps)).toBe('unmatched')
      expect(await listRoutes(user)).toEqual([])
    })

    test('getActivities filters to a route', async () => {
      const user = getTestUser()
      const { activityId, routeId } = await makeRoute()
      await addTrackedActivity(jittered)

      const activities = await getActivities(
        user,
        ['running'],
        new Date('2026-05-01T00:00:00Z'),
        new Date('2026-07-01T00:00:00Z'),
        undefined,
        undefined,
        undefined,
        routeId,
      )
      expect(activities.map((a) => a.id)).toEqual([activityId])
    })

    test('lists routes by their latest run', async () => {
      const user = getTestUser()
      const older = await makeRoute()
      const newer = await makeRoute(parallel)
      expect((await listRoutes(user)).map((r) => r.id)).toEqual([newer.routeId, older.routeId])
    })
  })

  describe('matchActivityRoute with the real geometry', () => {
    test('a pair creates a route from the older run, a later copy joins it, a reversed run does not', async () => {
      const user = getTestUser()
      const first = await addTrackedActivity(base)
      expect(await matchActivityRoute(user, first, defaultRouteMatchDeps)).toBe('unmatched')

      const second = await addTrackedActivity(jittered)
      expect(await matchActivityRoute(user, second, defaultRouteMatchDeps)).toBe('created')
      const route = await getRouteForActivity(user, second)
      expect(route).toMatchObject({ activity_count: 2, canonical_activity_id: first, name: 'Route · 2.0 km' })

      const third = await addTrackedActivity(detour)
      expect(await matchActivityRoute(user, third, defaultRouteMatchDeps)).toBe('matched')
      expect(await matchActivityRoute(user, third, defaultRouteMatchDeps)).toBe('already_routed')

      const back = await addTrackedActivity(reversed)
      expect(await matchActivityRoute(user, back, defaultRouteMatchDeps)).toBe('unmatched')
      const elsewhere = await addTrackedActivity(parallel)
      expect(await matchActivityRoute(user, elsewhere, defaultRouteMatchDeps)).toBe('unmatched')

      expect((await getRouteById(user, route!.id))!.activity_count).toBe(3)
      expect(await listRoutes(user)).toHaveLength(1)
    })

    test('an out-and-back course pairs with itself despite its overlapping legs', async () => {
      const user = getTestUser()
      // Both runs jittered: legs that coincide exactly collapse into one in ST_Intersection
      // and halve the coverage, which no recorded track does.
      const first = await addTrackedActivity(jitter(outAndBack))
      day += 6
      const second = await addTrackedActivity(jitter(outAndBack).map(([x, y]): Xy => [x + 3, y - 3]))

      expect(await matchActivityRoute(user, second, defaultRouteMatchDeps)).toBe('created')
      const route = await getRouteForActivity(user, first)
      expect(route).toMatchObject({ activity_count: 2, canonical_activity_id: first })
      expect((await getRouteForActivity(user, second))!.id).toBe(route!.id)
    })

    test('the backfill pass pairs history and is idempotent', async () => {
      const user = getTestUser()
      await addTrackedActivity(base)
      await addTrackedActivity(reversed)
      await addTrackedActivity(jittered)
      await addTrackedActivity(reversed)
      await addTrackedActivity(detour)

      expect(await matchUnroutedTracks(user, defaultRouteMatchDeps)).toEqual({ created: 2, matched: 1 })
      expect(await matchUnroutedTracks(user, defaultRouteMatchDeps)).toEqual({ created: 0, matched: 0 })
      expect((await listRoutes(user)).map((r) => r.activity_count).sort()).toEqual([2, 3])
    })
  })
})
