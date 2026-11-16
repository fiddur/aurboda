import type { DataSource } from '@aurboda/api-spec'

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { defaultSuggestedSegmentOps, lineWkt } from '../services/suggested-segments.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { insertActivity, deleteActivity } from './activities/index.ts'
import { query } from './connection.ts'
import { createRouteWithPair } from './routes.ts'
import { insertSegment } from './segments.ts'
import {
  countUnscannedTrackedActivities,
  decideSuggestedSegment,
  getSuggestedSegment,
  getSuggestionInput,
  listSuggestedSegments,
  listUnscannedTrackedActivities,
  markSuggestionsScanned,
  suggestedSegmentLine,
  upsertSuggestion,
} from './suggested-segments.ts'
import { upsertActivityTrack } from './tracks.ts'

const CONTAINER_TIMEOUT = 120_000

const LAT0 = 59.3
const LON0 = 18.07
const M_PER_DEG_LAT = 111_195
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180)

type Xy = [number, number]

const toLatLon = ([x, y]: Xy) => ({ lat: LAT0 + y / M_PER_DEG_LAT, lon: LON0 + x / M_PER_DEG_LON })

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

const ewkt = (points: Xy[]): string =>
  `SRID=4326;LINESTRING ZM(${points
    .map(toLatLon)
    .map(({ lat, lon }, i) => `${lon.toFixed(7)} ${lat.toFixed(7)} 0 ${i * 5}`)
    .join(', ')})`

/** 1 km east along y = 0. */
const EAST = densify([
  [0, 0],
  [1000, 0],
])
const WEST = [...EAST].reverse()

let day = 0

const addTrackedActivity = async (
  points: Xy[],
  {
    activityType = 'running',
    source = 'garmin',
    start,
  }: { activityType?: string; source?: DataSource; start?: Date } = {},
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
  await upsertActivityTrack(user, { activity_id: id, ewkt: ewkt(points), full_resolution: true, source })
  return id
}

const wkt = (corners: Xy[]) => lineWkt(corners.map(toLatLon))

describe('Suggested segments integration', () => {
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

  describe('getSuggestionInput', () => {
    test('null for an activity without a track or a deleted one', async () => {
      const user = getTestUser()
      const bare = await insertActivity(user, {
        activity_type: 'running',
        source: 'aurboda',
        start_time: new Date(Date.UTC(2026, 0, 1)),
      })
      expect(await getSuggestionInput(user, bare)).toBeNull()
      const gone = await addTrackedActivity(EAST)
      await deleteActivity(user, gone)
      expect(await getSuggestionInput(user, gone)).toBeNull()
    })

    test('candidates: same type, nearby, other sessions, not on the same route, newest first', async () => {
      const user = getTestUser()
      const a = await addTrackedActivity(EAST)
      const older = await addTrackedActivity(EAST)
      const newer = await addTrackedActivity(WEST)
      await addTrackedActivity(EAST, { activityType: 'walking' })
      await addTrackedActivity(
        densify([
          [50_000, 0],
          [51_000, 0],
        ]),
      )
      const deleted = await addTrackedActivity(EAST)
      await deleteActivity(user, deleted)
      const aStart = (await query(user, `SELECT start_time FROM activities WHERE id = $1`, [a])).rows[0]
        .start_time as Date
      await addTrackedActivity(EAST, { source: 'strava', start: aStart })

      const input = await getSuggestionInput(user, a)
      expect(input?.activity_type).toBe('running')
      expect(input?.points.length).toBeGreaterThanOrEqual(2)
      expect(input?.candidates.map((c) => c.activity_id)).toEqual([newer, older])
      expect(input?.candidates[0]?.start_time).toBeInstanceOf(Date)

      const sameRoute = await addTrackedActivity(EAST)
      await createRouteWithPair(user, {
        canonical: { activity_id: a, name: 'Route' },
        follower: { activity_id: sameRoute, coverage: 1 },
      })
      const routed = await getSuggestionInput(user, a)
      expect(routed?.candidates.map((c) => c.activity_id)).toEqual([newer, older])
    })
  })

  describe('upsertSuggestion', () => {
    const base = {
      activity_count: 3,
      activity_type: 'running',
      wkt: wkt([
        [0, 0],
        [800, 0],
      ]),
    }

    test('inserts, then takes the larger count of a similar pending one; the other direction is new', async () => {
      const user = getTestUser()
      const source = await addTrackedActivity(EAST)
      const input = { ...base, source_activity_id: source }
      expect(await upsertSuggestion(user, input)).toBe('inserted')
      expect(
        await upsertSuggestion(user, {
          ...input,
          activity_count: 5,
          wkt: wkt([
            [10, 5],
            [790, 5],
          ]),
        }),
      ).toBe('updated')
      expect(await upsertSuggestion(user, { ...input, activity_count: 4 })).toBe('updated')
      const [stored] = await listSuggestedSegments(user)
      expect(stored?.activity_count).toBe(5)
      expect(stored?.length_m).toBeCloseTo(800, -1)
      expect(stored?.source_activity_id).toBe(source)

      expect(
        await upsertSuggestion(user, {
          ...input,
          wkt: wkt([
            [800, 0],
            [0, 0],
          ]),
        }),
      ).toBe('inserted')
      expect(await upsertSuggestion(user, { ...input, activity_type: 'walking' })).toBe('inserted')
      expect(
        await upsertSuggestion(user, {
          ...input,
          wkt: wkt([
            [0, 0],
            [300, 0],
          ]),
        }),
      ).toBe('inserted')
      expect(await listSuggestedSegments(user)).toHaveLength(4)
    })

    test('a similar segment, or a dismissed or promoted suggestion, keeps it out', async () => {
      const user = getTestUser()
      const source = await addTrackedActivity(EAST)
      const input = { ...base, source_activity_id: source }
      await insertSegment(user, { activity_type: 'running', name: 'Hill', wkt: base.wkt })
      expect(await upsertSuggestion(user, input)).toBe('skipped')

      const other = {
        ...input,
        wkt: wkt([
          [0, 500],
          [800, 500],
        ]),
      }
      expect(await upsertSuggestion(user, other)).toBe('inserted')
      const [stored] = await listSuggestedSegments(user)
      expect(await decideSuggestedSegment(user, stored!.id, 'dismissed')).toBe(true)
      expect(await upsertSuggestion(user, other)).toBe('skipped')
      expect(await listSuggestedSegments(user)).toEqual([])
    })
  })

  describe('scanning marks', () => {
    test('unscanned tracked activities newest first; marked ones drop out; a rewritten track is unscanned again', async () => {
      const user = getTestUser()
      const first = await addTrackedActivity(EAST)
      const second = await addTrackedActivity(EAST)
      const deleted = await addTrackedActivity(EAST)
      await deleteActivity(user, deleted)
      expect(await listUnscannedTrackedActivities(user, 10)).toEqual([
        { activity_id: second },
        { activity_id: first },
      ])
      expect(await listUnscannedTrackedActivities(user, 1)).toEqual([{ activity_id: second }])
      expect(await countUnscannedTrackedActivities(user)).toBe(2)

      await markSuggestionsScanned(user, second)
      expect(await listUnscannedTrackedActivities(user, 10)).toEqual([{ activity_id: first }])
      expect(await countUnscannedTrackedActivities(user)).toBe(1)

      await upsertActivityTrack(user, {
        activity_id: second,
        ewkt: ewkt(WEST),
        full_resolution: true,
        source: 'garmin',
      })
      expect(await countUnscannedTrackedActivities(user)).toBe(2)
    })
  })

  describe('reading and deciding', () => {
    test('list (pending, most activities first), get, line, decide', async () => {
      const user = getTestUser()
      const source = await addTrackedActivity(EAST)
      await upsertSuggestion(user, {
        activity_count: 3,
        activity_type: 'running',
        source_activity_id: source,
        wkt: wkt([
          [0, 0],
          [1000, 0],
        ]),
      })
      await upsertSuggestion(user, {
        activity_count: 6,
        activity_type: 'running',
        source_activity_id: source,
        wkt: wkt([
          [0, 900],
          [600, 900],
        ]),
      })
      const list = await listSuggestedSegments(user)
      expect(list.map((s) => s.activity_count)).toEqual([6, 3])
      const long = list[1]!
      expect(long.points[0]!.lon).toBeCloseTo(LON0, 5)
      expect(long.status).toBe('pending')
      expect((await getSuggestedSegment(user, long.id))?.length_m).toBeCloseTo(1000, -1)

      const whole = await suggestedSegmentLine(user, long.id)
      expect(whole.ok && whole.line.length_m).toBeCloseTo(1000, -1)
      const trimmed = await suggestedSegmentLine(user, long.id, 0.2, 0.7)
      expect(trimmed.ok && trimmed.line.length_m).toBeCloseTo(500, -1)
      expect(trimmed.ok && trimmed.line.start.lon).toBeCloseTo(LON0 + 200 / M_PER_DEG_LON, 4)
      expect(trimmed.ok && trimmed.line.activity_type).toBe('running')
      expect(await suggestedSegmentLine(user, long.id, 2, 3)).toEqual({ ok: false, reason: 'out_of_range' })
      expect(await suggestedSegmentLine(user, '00000000-0000-0000-0000-000000000000')).toEqual({
        ok: false,
        reason: 'not_found',
      })

      expect(await decideSuggestedSegment(user, long.id, 'dismissed')).toBe(true)
      expect(await decideSuggestedSegment(user, long.id, 'promoted')).toBe(false)
      expect((await getSuggestedSegment(user, long.id))?.status).toBe('dismissed')
      expect((await listSuggestedSegments(user)).map((s) => s.activity_count)).toEqual([6])
    })
  })

  describe('end to end through the service', () => {
    test('three courses sharing a stretch suggest it once; promoting it times the passes; it does not come back', async () => {
      const user = getTestUser()
      const shared: Xy[] = [
        [0, 0],
        [1000, 0],
      ]
      await addTrackedActivity(densify([[0, -800], ...shared, [1000, 800]]))
      await addTrackedActivity(densify([[-800, 0], ...shared, [1800, 0]]))
      await addTrackedActivity(densify([[0, 600], ...shared, [1000, -600]]))
      await addTrackedActivity(
        densify([
          [1000, 0],
          [0, 0],
        ]),
      )

      const result = await defaultSuggestedSegmentOps.scan(user)
      expect(result).toMatchObject({ remaining: 0, scanned: 4 })
      expect(result.suggested).toBe(1)
      const [suggestion] = await defaultSuggestedSegmentOps.list(user)
      expect(suggestion?.activity_count).toBe(3)
      expect(suggestion?.length_m).toBeGreaterThan(900)
      expect(suggestion?.near_name).toBeNull()

      const promoted = await defaultSuggestedSegmentOps.promote(user, suggestion!.id, {
        end_km: 0.9,
        name: 'Shared',
        start_km: 0.1,
      })
      expect(promoted?.ok).toBe(true)
      if (!promoted?.ok) return
      expect(promoted.segment.name).toBe('Shared')
      expect(promoted.segment.efforts).toHaveLength(3)
      expect(await defaultSuggestedSegmentOps.list(user)).toEqual([])
      expect(await defaultSuggestedSegmentOps.promote(user, suggestion!.id, {})).toBeNull()
      expect(await defaultSuggestedSegmentOps.dismiss(user, suggestion!.id)).toBe(false)

      await query(user, `UPDATE activity_tracks SET segments_suggested_at = NULL`)
      expect(await defaultSuggestedSegmentOps.scan(user)).toMatchObject({ scanned: 4, suggested: 0 })
    })
  })
})
