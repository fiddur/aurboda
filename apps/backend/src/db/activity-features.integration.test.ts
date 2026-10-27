import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { deleteActivity, insertActivity, insertOverride } from './activities/index.ts'
import {
  type ActivityFeatureValues,
  deleteAllActivityFeatures,
  findActivitiesByFeature,
  getActivityFeatures,
  getMedianDurationBefore,
  listTrackedActivitiesWithoutFeatures,
  upsertActivityFeatures,
} from './activity-features.ts'
import { query } from './connection.ts'
import { upsertActivityTrack } from './tracks.ts'

const CONTAINER_TIMEOUT = 120_000

const emptyFeatures: ActivityFeatureValues = {
  duration_vs_median_90d: null,
  elapsed_s: null,
  elevation_gain_m: null,
  elevation_oscillation: null,
  hr_drift_pct: null,
  interval_count: null,
  low_hr_ceiling_bpm: null,
  low_hr_fraction: null,
  moving_s: null,
  pace_cv: null,
  rest_block_median_s: null,
  work_block_cv: null,
  work_block_median_s: null,
  work_rest_pace_ratio: null,
  zone0_fraction: null,
  zone1_fraction: null,
  zone2_fraction: null,
  zone3_fraction: null,
  zone4_fraction: null,
  zone5_fraction: null,
}

const TRACK_EWKT = 'SRID=4326;LINESTRING ZM(18.07 59.3 0 0, 18.08 59.3 0 300, 18.09 59.3 0 600)'

let counter = 0

const addActivity = async ({
  activityType = 'running',
  durationMin = 30,
  start,
  track = false,
}: {
  activityType?: string
  durationMin?: number | null
  start: Date
  track?: boolean
}): Promise<string> => {
  counter++
  const user = getTestUser()
  const id = await insertActivity(user, {
    activity_type: activityType,
    end_time: durationMin === null ? undefined : new Date(start.getTime() + durationMin * 60_000),
    external_id: `ext-${counter}`,
    source: 'garmin',
    start_time: start,
  })
  if (track) {
    await upsertActivityTrack(user, {
      activity_id: id,
      ewkt: TRACK_EWKT,
      full_resolution: true,
      source: 'garmin',
    })
  }
  return id
}

const day = (d: number, hour = 7) => new Date(Date.UTC(2026, 5, d, hour))

describe('activity features integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
    counter = 0
  })

  test('upsert then get round-trips every feature, a second upsert replaces', async () => {
    const user = getTestUser()
    const id = await addActivity({ start: day(1) })
    await upsertActivityFeatures(user, id, {
      ...emptyFeatures,
      elapsed_s: 1800,
      interval_count: 6,
      low_hr_ceiling_bpm: 140,
      low_hr_fraction: 0.9,
    })

    const stored = await getActivityFeatures(user, id)
    expect(stored).toMatchObject({
      activity_id: id,
      elapsed_s: 1800,
      hr_drift_pct: null,
      interval_count: 6,
      low_hr_ceiling_bpm: 140,
    })
    expect(stored?.low_hr_fraction).toBeCloseTo(0.9)
    expect(Number.isNaN(Date.parse(stored!.computed_at))).toBe(false)

    await upsertActivityFeatures(user, id, { ...emptyFeatures, elapsed_s: 1700 })
    const replaced = await getActivityFeatures(user, id)
    expect(replaced?.elapsed_s).toBe(1700)
    expect(replaced?.interval_count).toBeNull()
  })

  test('get returns null without a row', async () => {
    const id = await addActivity({ start: day(1) })
    expect(await getActivityFeatures(getTestUser(), id)).toBeNull()
  })

  test('deleting the activity row cascades', async () => {
    const user = getTestUser()
    const id = await addActivity({ start: day(1) })
    await upsertActivityFeatures(user, id, emptyFeatures)
    await query(user, `DELETE FROM activities WHERE id = $1`, [id])
    expect(await getActivityFeatures(user, id)).toBeNull()
  })

  test('deleteAllActivityFeatures removes every row and counts them', async () => {
    const user = getTestUser()
    const a = await addActivity({ start: day(1) })
    const b = await addActivity({ start: day(2) })
    await upsertActivityFeatures(user, a, emptyFeatures)
    await upsertActivityFeatures(user, b, emptyFeatures)

    expect(await deleteAllActivityFeatures(user)).toBe(2)
    expect(await getActivityFeatures(user, a)).toBeNull()
  })

  test('listTrackedActivitiesWithoutFeatures: tracked, not deleted, no features, oldest first', async () => {
    const user = getTestUser()
    const newer = await addActivity({ start: day(3), track: true })
    const older = await addActivity({ start: day(1), track: true })
    const withFeatures = await addActivity({ start: day(2), track: true })
    await upsertActivityFeatures(user, withFeatures, emptyFeatures)
    await addActivity({ start: day(4) })
    const deleted = await addActivity({ start: day(5), track: true })
    await deleteActivity(user, deleted)

    expect(await listTrackedActivitiesWithoutFeatures(user)).toEqual([
      { activity_id: older },
      { activity_id: newer },
    ])
  })

  test('getMedianDurationBefore: median over the window, types, timed and non-superseded rows only', async () => {
    const user = getTestUser()
    await addActivity({ durationMin: 20, start: day(10) })
    await addActivity({ durationMin: 40, start: day(11) })
    await addActivity({ durationMin: 60, start: day(12) })
    await addActivity({ durationMin: 90, start: day(13), activityType: 'walking' })
    await addActivity({ durationMin: null, start: day(14) })
    await addActivity({ durationMin: 500, start: day(20) })
    await addActivity({ durationMin: 500, start: new Date(day(20).getTime() - 100 * 86_400_000) })
    const superseded = await addActivity({ durationMin: 500, start: day(15) })
    const replacement = await addActivity({ activityType: 'yoga', durationMin: 5, start: day(16) })
    await query(user, `UPDATE activities SET superseded_by = $2 WHERE id = $1`, [superseded, replacement])

    expect(await getMedianDurationBefore(user, ['running'], day(20))).toBe(2400)
    expect(await getMedianDurationBefore(user, ['running', 'walking'], day(20))).toBe(3000)
    expect(await getMedianDurationBefore(user, ['swimming_pool'], day(20))).toBeNull()
    expect(await getMedianDurationBefore(user, [], day(20))).toBeNull()
  })

  test('findActivitiesByFeature: comparison, types, window and missing features', async () => {
    const user = getTestUser()
    const low = await addActivity({ start: day(1) })
    const high = await addActivity({ start: day(2) })
    const untimed = await addActivity({ durationMin: null, start: day(3) })
    const walk = await addActivity({ activityType: 'walking', start: day(4) })
    await addActivity({ start: day(5) })
    await upsertActivityFeatures(user, low, { ...emptyFeatures, low_hr_fraction: 0.9 })
    await upsertActivityFeatures(user, high, { ...emptyFeatures, low_hr_fraction: 0.5 })
    await upsertActivityFeatures(user, untimed, { ...emptyFeatures, low_hr_fraction: 0.95 })
    await upsertActivityFeatures(user, walk, { ...emptyFeatures, low_hr_fraction: 1 })

    const window = { end: day(10), start: day(1, 0) }
    const matches = await findActivitiesByFeature(user, ['running'], 'low_hr_fraction', 'gte', 0.85, window)
    expect(matches.map((m) => m.id)).toEqual([low, untimed])
    expect(matches[0]).toMatchObject({ end: new Date(day(1).getTime() + 30 * 60_000), start: day(1) })
    expect(matches[0]!.value).toBeCloseTo(0.9)
    expect(matches[1]!.end).toEqual(new Date(day(3).getTime() + 3_600_000))

    const below = await findActivitiesByFeature(user, ['running'], 'low_hr_fraction', 'lt', 0.85, window)
    expect(below.map((m) => m.id)).toEqual([high])

    const narrow = await findActivitiesByFeature(
      user,
      ['running', 'walking'],
      'low_hr_fraction',
      'gt',
      0.85,
      {
        end: day(5),
        start: day(3, 12),
      },
    )
    expect(narrow.map((m) => m.id)).toEqual([walk])

    expect(await findActivitiesByFeature(user, ['running'], 'pace_cv' as const, 'lte', 1, window)).toEqual([])
    expect(
      await findActivitiesByFeature(
        user,
        ['running'],
        'nope; DROP TABLE activities' as never,
        'gte',
        0,
        window,
      ),
    ).toEqual([])
  })

  test('findActivitiesByFeature matches a synced row by the type its override gives it', async () => {
    const user = getTestUser()
    const retypedToWalk = await addActivity({ start: day(1) })
    const retypedToRun = await addActivity({ activityType: 'walking', start: day(2) })
    for (const id of [retypedToWalk, retypedToRun]) {
      await upsertActivityFeatures(user, id, { ...emptyFeatures, low_hr_fraction: 0.9 })
    }
    const overrideTo = async (id: string, activityType: string) => {
      const [row] = (await query(user, `SELECT start_time, end_time FROM activities WHERE id = $1`, [id]))
        .rows
      await insertOverride(user, [id], {
        activity_type: activityType,
        end_time: row.end_time as Date,
        start_time: row.start_time as Date,
      })
    }
    await overrideTo(retypedToWalk, 'walking')
    await overrideTo(retypedToRun, 'running')

    const window = { end: day(10), start: day(1, 0) }
    const runs = await findActivitiesByFeature(user, ['running'], 'low_hr_fraction', 'gte', 0.85, window)
    expect(runs.map((m) => m.id)).toEqual([retypedToRun])
    const walks = await findActivitiesByFeature(user, ['walking'], 'low_hr_fraction', 'gte', 0.85, window)
    expect(walks.map((m) => m.id)).toEqual([retypedToWalk])
  })
})
