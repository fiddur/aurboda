import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import type { TimeSeriesPoint } from '../../db/types.ts'

import { query } from '../../db/connection.ts'
import {
  getHrZoneSecs,
  insertActivity,
  insertActivityTypeDefinition,
  insertTimeSeries,
} from '../../db/index.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../../test/db-test-helper.ts'
import { getEffectiveHrZones } from '../settings.ts'
import { getActivityNeighbors } from './activity-neighbors.ts'
import { queryActivitySessions } from './activity-sessions.ts'

const CONTAINER_TIMEOUT = 120_000
const TYPE = 'video_yoga'

const at = (iso: string) => new Date(iso)
const plus = (iso: string, minutes: number) => new Date(at(iso).getTime() + minutes * 60_000)

/** One HR sample every 10 s over `minutes`, ramping from `from` to `to`. */
const hrRamp = (startIso: string, minutes: number, from: number, to: number): TimeSeriesPoint[] => {
  const n = minutes * 6
  return Array.from({ length: n }, (_, i) => ({
    metric: 'heart_rate',
    source: 'garmin',
    time: new Date(at(startIso).getTime() + i * 10_000),
    value: Math.round(from + ((to - from) * i) / (n - 1)),
  }))
}

describe('activity sessions and neighbors against the database', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  const ids = { first: '', mergedGarmin: '', mergedStrava: '', unnamed: '', last: '' }

  beforeEach(async () => {
    await cleanTestDb()
    const user = getTestUser()
    await query(user, `DELETE FROM activity_type_definitions WHERE is_builtin = false`)
    await insertActivityTypeDefinition(user, {
      data_schema: { fields: [{ is_categorical: true, name: 'session_name', type: 'string' }] },
      display_category: 'exercise',
      display_name: 'Video yoga',
      name: TYPE,
    })

    const yoga = async (
      startIso: string,
      minutes: number,
      data: Record<string, unknown> | undefined,
      source: 'garmin' | 'strava' = 'garmin',
    ) => {
      const id = randomUUID()
      await insertActivity(user, {
        activity_type: TYPE,
        data,
        end_time: plus(startIso, minutes),
        id,
        source,
        start_time: at(startIso),
      })
      return id
    }
    ids.first = await yoga('2026-09-01T07:00:00Z', 20, { session_name: 'Mobility Flow' })
    // One session recorded by two sources; the name was enriched onto the Strava row
    ids.mergedGarmin = await yoga('2026-09-03T07:00:00Z', 26, { average_hr: 120, max_hr: 160 })
    ids.mergedStrava = await yoga('2026-09-03T07:00:05Z', 26, { session_name: 'Mobility Flow' }, 'strava')
    ids.unnamed = await yoga('2026-09-04T07:00:00Z', 10, undefined)
    ids.last = await yoga('2026-09-05T07:00:00Z', 40, { session_name: 'Yin' })

    await insertTimeSeries(user, [
      ...hrRamp('2026-09-01T07:00:00Z', 20, 80, 120),
      ...hrRamp('2026-09-03T07:00:00Z', 26, 90, 160),
      ...hrRamp('2026-09-05T07:00:00Z', 40, 60, 90),
    ])
  })

  test('sessions carry HR summaries and zones; groups pool by session_name', async () => {
    const user = getTestUser()
    const result = await queryActivitySessions(user, TYPE, { groupBy: 'session_name' })

    expect(result.sessions.map((s) => [s.id, s.fields.session_name, s.duration])).toEqual([
      [ids.last, 'Yin', 40],
      [ids.unnamed, undefined, 10],
      [`merged:${ids.mergedGarmin}`, 'Mobility Flow', 26],
      [ids.first, 'Mobility Flow', 20],
    ])

    const merged = result.sessions[2]!
    expect(merged).toMatchObject({ avg_hr: 120, max_hr: 160 })
    expect(merged.hr).toMatchObject({ max: 160, min: 90, sample_count: 156 })
    const { zones } = await getEffectiveHrZones(user)
    const [expectedZones] = await getHrZoneSecs(
      user,
      at('2026-09-03T07:00:00Z'),
      plus('2026-09-03T07:00:05Z', 26),
      zones,
    )
    expect(merged.hr_zone_secs).toEqual(expectedZones!.secs)

    const first = result.sessions[3]!
    expect(first).toMatchObject({ avg_hr: 100, max_hr: 120 })
    expect(first.hr).toMatchObject({ median: 100, min: 80, sample_count: 120 })
    expect(result.sessions[1]!.hr).toBeUndefined()

    expect(result.groups?.map((g) => [g.value, g.count, g.session_ids.length, g.hr?.sample_count])).toEqual([
      ['Yin', 1, 1, 240],
      ['Mobility Flow', 2, 2, 276],
      [null, 1, 1, undefined],
    ])
    const flow = result.groups![1]!
    expect(flow).toMatchObject({
      avg_hr_median: 110,
      duration_max: 26,
      duration_min: 20,
      hr: { max: 160, min: 80 },
    })
  })

  test('a value filter and a time range narrow the sessions', async () => {
    const user = getTestUser()
    const named = await queryActivitySessions(user, TYPE, {
      filter: { field: 'session_name', value: 'Mobility Flow' },
    })
    expect(named.sessions.map((s) => s.id)).toEqual([`merged:${ids.mergedGarmin}`, ids.first])
    expect(named.sessions[0]).toMatchObject({ avg_hr: 120, duration: 26 })

    const recent = await queryActivitySessions(user, TYPE, { start: at('2026-09-04T00:00:00Z') })
    expect(recent.sessions.map((s) => s.id)).toEqual([ids.last, ids.unnamed])
  })

  test('neighbors step over merged sources and can keep to the same session_name', async () => {
    const user = getTestUser()

    const fromMerged = await getActivityNeighbors(user, `merged:${ids.mergedStrava}`)
    expect(fromMerged?.previous?.id).toBe(ids.first)
    expect(fromMerged?.next?.id).toBe(ids.unnamed)

    const fromUnnamed = await getActivityNeighbors(user, ids.unnamed)
    expect(fromUnnamed?.previous).toMatchObject({
      end_time: plus('2026-09-03T07:00:05Z', 26).toISOString(),
      id: `merged:${ids.mergedGarmin}`,
      start_time: '2026-09-03T07:00:00.000Z',
    })

    const sameName = await getActivityNeighbors(user, ids.first, 'session_name')
    expect(sameName?.previous).toBeUndefined()
    expect(sameName?.next?.id).toBe(`merged:${ids.mergedGarmin}`)

    expect(await getActivityNeighbors(user, ids.unnamed, 'session_name')).toEqual({ activity_type: TYPE })
  })
})
