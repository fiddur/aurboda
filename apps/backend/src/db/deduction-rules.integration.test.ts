import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestDbClient, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  getDeductionRule,
  insertDeductionRule,
  insertDeductionRuleRun,
  pruneDeductionRuleRuns,
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
