import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import type { ActivityFeatureValues } from '../db/activity-features.ts'

import { upsertActivityFeatures } from '../db/activity-features.ts'
import { query } from '../db/connection.ts'
import { getActivityById, insertActivity, insertDeductionRule, insertOverride } from '../db/index.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { createDefaultEngineDeps } from './deduction-deps.ts'
import { evaluateAllRules } from './deduction-engine.ts'

const CONTAINER_TIMEOUT = 120_000

const window = { end: new Date('2026-06-03T00:00:00Z'), start: new Date('2026-06-01T00:00:00Z') }

const features = (low_hr_fraction: number): ActivityFeatureValues => ({
  duration_vs_median_90d: null,
  elapsed_s: 2700,
  elevation_gain_m: null,
  elevation_oscillation: null,
  hr_drift_pct: null,
  interval_count: null,
  low_hr_ceiling_bpm: 140,
  low_hr_fraction,
  moving_s: 2600,
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
})

let counter = 0
const addRun = async (activityType: string, hour: number) => {
  counter++
  const start = new Date(Date.UTC(2026, 5, 1, hour))
  return insertActivity(getTestUser(), {
    activity_type: activityType,
    end_time: new Date(start.getTime() + 45 * 60_000),
    external_id: `cat-${counter}`,
    source: 'garmin',
    start_time: start,
  })
}

const categoriesOf = async (id: string) => (await getActivityById(getTestUser(), id))?.data?.run_categories

describe('categorising rules against the database', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  const lowHrRule = () =>
    insertDeductionRule(getTestUser(), {
      conditions: [
        {
          activity_type: 'running',
          feature: 'low_hr_fraction',
          kind: 'activity_feature',
          operator: 'gte',
          value: 0.85,
        },
      ],
      mode: 'enrich',
      name: 'Low-HR run',
      output_activity_type: 'running',
      output_category: 'low_hr',
    })

  test('adds the category while the features match, keeps manual entries, and takes it back', async () => {
    const user = getTestUser()
    const run = await addRun('running', 7)
    await query(user, `UPDATE activities SET data = $2::jsonb WHERE id = $1`, [
      run,
      JSON.stringify({ run_categories: [{ category: 'race', reasons: [] }] }),
    ])
    await upsertActivityFeatures(user, run, features(0.9))
    const rule = await lowHrRule()
    const deps = createDefaultEngineDeps()

    await evaluateAllRules(user, [rule], window, deps)
    expect(await categoriesOf(run)).toEqual([
      { category: 'race', reasons: [] },
      {
        category: 'low_hr',
        reasons: ['time at or below the low-HR ceiling 90.0% ≥ 85.0%'],
        rule_id: rule.id,
      },
    ])

    const again = await evaluateAllRules(user, [rule], window, deps)
    expect(again.activities_created).toBe(0)

    await upsertActivityFeatures(user, run, features(0.5))
    await evaluateAllRules(user, [rule], window, deps)
    expect(await categoriesOf(run)).toEqual([{ category: 'race', reasons: [] }])
  })

  test('a walk retyped to a run through an override is categorised on the override', async () => {
    const user = getTestUser()
    const walk = await addRun('walking', 9)
    await upsertActivityFeatures(user, walk, features(0.95))
    const [row] = (await query(user, `SELECT start_time, end_time FROM activities WHERE id = $1`, [walk]))
      .rows
    const override = await insertOverride(user, [walk], {
      activity_type: 'running',
      end_time: row.end_time as Date,
      start_time: row.start_time as Date,
    })
    const rule = await lowHrRule()

    await evaluateAllRules(user, [rule], window, createDefaultEngineDeps())

    expect(await categoriesOf(override!.id!)).toEqual([
      {
        category: 'low_hr',
        reasons: ['time at or below the low-HR ceiling 95.0% ≥ 85.0%'],
        rule_id: rule.id,
      },
    ])
    expect(await categoriesOf(walk)).toBeUndefined()
  })

  test('the synced row of an overridden run never gets an entry and loses an old one', async () => {
    const user = getTestUser()
    const synced = await addRun('running', 9)
    await upsertActivityFeatures(user, synced, features(0.95))
    const rule = await lowHrRule()
    const stale = { category: 'low_hr', reasons: [], rule_id: rule.id }
    await query(user, `UPDATE activities SET data = $2::jsonb WHERE id = $1`, [
      synced,
      JSON.stringify({ run_categories: [stale] }),
    ])
    const [row] = (await query(user, `SELECT start_time, end_time FROM activities WHERE id = $1`, [synced]))
      .rows
    const override = await insertOverride(user, [synced], {
      activity_type: 'running',
      end_time: row.end_time as Date,
      start_time: row.start_time as Date,
      title: 'Morning run',
    })

    await evaluateAllRules(user, [rule], window, createDefaultEngineDeps())

    expect(await categoriesOf(synced)).toEqual([])
    expect(await categoriesOf(override!.id!)).toEqual([
      {
        category: 'low_hr',
        reasons: ['time at or below the low-HR ceiling 95.0% ≥ 85.0%'],
        rule_id: rule.id,
      },
    ])
  })

  test('a run retyped to walking loses the entry on the next evaluation', async () => {
    const user = getTestUser()
    const run = await addRun('running', 11)
    await upsertActivityFeatures(user, run, features(0.9))
    const rule = await lowHrRule()
    const deps = createDefaultEngineDeps()
    await evaluateAllRules(user, [rule], window, deps)
    expect(await categoriesOf(run)).toHaveLength(1)

    await query(user, `UPDATE activities SET activity_type = 'walking' WHERE id = $1`, [run])
    await evaluateAllRules(user, [rule], window, deps)

    expect(await categoriesOf(run)).toEqual([])
  })

  test('patchActivityData writes only while run_categories is as read', async () => {
    const user = getTestUser()
    const run = await addRun('running', 13)
    const deps = createDefaultEngineDeps()
    const manual = { category: 'race', reasons: [] }
    const patch = { run_categories: [manual] }

    expect(await deps.patchActivityData(user, run, patch, undefined)).toBe(true)
    expect(await deps.patchActivityData(user, run, { run_categories: [] }, undefined)).toBe(false)
    expect(await categoriesOf(run)).toEqual([manual])
    expect(await deps.patchActivityData(user, run, { run_categories: [] }, [manual])).toBe(true)
    expect(await categoriesOf(run)).toEqual([])
    expect(await deps.getActivityData(user, run)).toEqual({ run_categories: [] })
  })
})
