import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestDbClient, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { getActivityById, insertActivity } from './activities/index.ts'
import { query } from './connection.ts'
import {
  deleteDeductionRule,
  getDeductionRule,
  insertDeductionRule,
  insertDeductionRuleRun,
  pruneDeductionRuleRuns,
  removeRuleCategoryEntries,
  updateDeductionRule,
} from './deduction-rules.ts'

const CONTAINER_TIMEOUT = 120_000

describe('deduction rules (integration)', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('output_media_field round-trips and can be cleared', async () => {
    const user = getTestUser()
    const outputMediaField = { field: 'session_name', strip_pattern: '\\s*—\\s*True Naked Yoga$' }

    const inserted = await insertDeductionRule(user, {
      conditions: [{ kind: 'media', match_mode: 'contains', url_host: ['truenakedyoga.com'] }],
      mode: 'enrich',
      name: 'Yoga session name',
      output_activity_type: 'yoga',
      output_data: { style: 'yin' },
      output_media_field: outputMediaField,
    })

    expect(inserted).toMatchObject({
      mode: 'enrich',
      output_data: { style: 'yin' },
      output_media_field: outputMediaField,
    })
    expect((await getDeductionRule(user, inserted.id))?.output_media_field).toEqual(outputMediaField)

    const renamed = await updateDeductionRule(user, inserted.id, {
      output_media_field: { field: 'video_title' },
    })
    expect(renamed?.output_media_field).toEqual({ field: 'video_title' })

    const cleared = await updateDeductionRule(user, inserted.id, { output_media_field: null })
    expect(cleared).not.toHaveProperty('output_media_field')
  })

  test('output_title_field round-trips and can be cleared', async () => {
    const user = getTestUser()

    const inserted = await insertDeductionRule(user, {
      conditions: [
        {
          activity_type: 'yoga',
          data_filters: [{ field: 'session_name', operator: 'exists' }],
          kind: 'activity',
        },
      ],
      mode: 'enrich',
      name: 'Yoga title from session',
      output_activity_type: 'yoga',
      output_title_field: 'session_name',
    })

    expect(inserted.output_title_field).toBe('session_name')
    expect((await getDeductionRule(user, inserted.id))?.output_title_field).toBe('session_name')

    const renamed = await updateDeductionRule(user, inserted.id, { output_title_field: 'video_title' })
    expect(renamed?.output_title_field).toBe('video_title')

    const untouched = await updateDeductionRule(user, inserted.id, { name: 'Renamed' })
    expect(untouched?.output_title_field).toBe('video_title')

    const cleared = await updateDeductionRule(user, inserted.id, { output_title_field: null })
    expect(cleared).not.toHaveProperty('output_title_field')
  })

  test('output_category round-trips and can be cleared', async () => {
    const user = getTestUser()

    const inserted = await insertDeductionRule(user, {
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

    expect(inserted.output_category).toBe('low_hr')
    expect((await getDeductionRule(user, inserted.id))?.conditions[0]).toMatchObject({
      feature: 'low_hr_fraction',
      kind: 'activity_feature',
    })

    const renamed = await updateDeductionRule(user, inserted.id, { output_category: 'easy' })
    expect(renamed?.output_category).toBe('easy')

    const untouched = await updateDeductionRule(user, inserted.id, { name: 'Renamed' })
    expect(untouched?.output_category).toBe('easy')

    const cleared = await updateDeductionRule(user, inserted.id, { output_category: null })
    expect(cleared).not.toHaveProperty('output_category')
  })

  test('deleting a rule removes its run_categories entries and keeps the others', async () => {
    const user = getTestUser()
    const rule = await insertDeductionRule(user, {
      conditions: [
        {
          activity_type: 'running',
          feature: 'moving_s',
          kind: 'activity_feature',
          operator: 'gte',
          value: 5400,
        },
      ],
      mode: 'enrich',
      name: 'Long run',
      output_activity_type: 'running',
      output_category: 'long',
    })
    const manual = { category: 'race', reasons: [] }
    const other = { category: 'long', reasons: ['x'], rule_id: '00000000-0000-4000-8000-000000000001' }
    const own = { category: 'long', reasons: ['moving time 1:40 ≥ 1:30'], rule_id: rule.id }
    const addRun = async (data: Record<string, unknown> | undefined, hour: number) =>
      insertActivity(user, {
        activity_type: 'running',
        data,
        end_time: new Date(Date.UTC(2026, 5, 1, hour, 45)),
        source: 'aurboda',
        start_time: new Date(Date.UTC(2026, 5, 1, hour)),
      })
    const mixed = await addRun({ distance: 15000, run_categories: [manual, own, other] }, 7)
    const onlyOwn = await addRun({ run_categories: [own] }, 9)
    const untouched = await addRun({ run_categories: [manual] }, 11)
    const malformed = await addRun({ run_categories: 'long' }, 13)
    const dataOf = async (id: string) =>
      (await query(user, `SELECT data FROM activities WHERE id = $1`, [id])).rows[0]?.data

    await updateDeductionRule(user, rule.id, { enabled: false })
    expect((await getActivityById(user, onlyOwn))?.data?.run_categories).toEqual([own])

    expect(await deleteDeductionRule(user, rule.id)).toBe(true)
    expect(await dataOf(mixed)).toEqual({ distance: 15000, run_categories: [manual, other] })
    expect(await dataOf(onlyOwn)).toEqual({ run_categories: [] })
    expect(await dataOf(untouched)).toEqual({ run_categories: [manual] })
    expect(await dataOf(malformed)).toEqual({ run_categories: 'long' })
    expect(await removeRuleCategoryEntries(user, rule.id)).toBe(0)
  })

  test('pruneDeductionRuleRuns deletes only runs older than the retention', async () => {
    const user = getTestUser()
    const rule = await insertDeductionRule(user, {
      conditions: [{ activity_type: 'meditation', kind: 'activity' }],
      name: 'Rest after meditation',
      output_activity_type: 'rest',
    })
    const run = {
      activities_created: 1,
      duration_ms: 5,
      rule_id: rule.id,
      window_end: new Date('2026-09-18T00:00:00Z'),
      window_start: new Date('2026-09-17T00:00:00Z'),
    }
    await insertDeductionRuleRun(user, run)
    await insertDeductionRuleRun(user, run)
    await getTestDbClient().query(
      `UPDATE deduction_rule_runs SET evaluated_at = NOW() - INTERVAL '31 days'
        WHERE id = (SELECT id FROM deduction_rule_runs LIMIT 1)`,
    )

    expect(await pruneDeductionRuleRuns(user, 30)).toBe(1)
    const remaining = await getTestDbClient().query(
      `SELECT evaluated_at > NOW() - INTERVAL '1 day' AS recent FROM deduction_rule_runs`,
    )
    expect(remaining.rows).toEqual([{ recent: true }])
  })
})
