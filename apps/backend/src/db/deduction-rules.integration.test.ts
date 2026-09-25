import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { getDeductionRule, insertDeductionRule, updateDeductionRule } from './deduction-rules.ts'

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
})
