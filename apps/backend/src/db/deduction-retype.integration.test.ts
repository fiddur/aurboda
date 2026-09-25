import type { DeductionRule } from '@aurboda/api-spec'

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import type { Activity } from './types.ts'

import { createDefaultEngineDeps } from '../services/deduction-deps.ts'
import { evaluateRule } from '../services/deduction-engine.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  activityTypeExists,
  getActivityById,
  getOverrideForActivity,
  insertActivity,
  insertActivityTypeDefinition,
} from './index.ts'

const CONTAINER_TIMEOUT = 120_000

const window = { end: new Date('2026-09-26T00:00:00Z'), start: new Date('2026-09-25T00:00:00Z') }

const garminActivity = (overrides: Partial<Activity> = {}): Activity => ({
  activity_type: 'other_workout',
  data: { average_hr: 89, garmin_activity_id: 24497411117, garmin_type_key: 'other' },
  end_time: new Date('2026-09-25T19:28:40Z'),
  external_id: 'garmin-activity-24497411117',
  source: 'garmin',
  start_time: new Date('2026-09-25T18:53:58Z'),
  title: 'Mark Sex',
  ...overrides,
})

const rule: DeductionRule = {
  conditions: [{ activity_type: 'other_workout', kind: 'activity', title: 'sex' }],
  enabled: true,
  id: '5b0c7a4e-3f7d-4d8e-9a53-2f0f1b6c9e11',
  mode: 'retype',
  name: 'Sex from Garmin',
  output_activity_type: 'sex',
  output_data: { partner: 'unknown' },
  output_title: 'Sex',
  priority: 0,
}

describe('retype rules (integration)', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
    if (await activityTypeExists(getTestUser(), 'sex')) return
    await insertActivityTypeDefinition(getTestUser(), {
      display_category: 'other',
      display_name: 'Sex',
      name: 'sex',
    })
  })

  test('a synced activity gets an override of the new type that survives a re-sync', async () => {
    const user = getTestUser()
    const syncedId = await insertActivity(user, garminActivity())
    const deps = createDefaultEngineDeps()

    expect((await evaluateRule(user, rule, window, deps)).affected_ids).toEqual([syncedId])

    const override = await getOverrideForActivity(user, syncedId)
    expect(override).toMatchObject({ activity_type: 'sex', source: 'aurboda', title: 'Sex' })
    expect(override?.data).toMatchObject({ _retyped_by: rule.id, average_hr: 89, partner: 'unknown' })

    await insertActivity(user, garminActivity())
    expect((await getActivityById(user, syncedId))?.activity_type).toBe('other_workout')
    expect((await getOverrideForActivity(user, syncedId))?.id).toBe(override?.id)

    expect((await evaluateRule(user, rule, window, deps)).affected_ids).toEqual([])
  })

  test('an activity whose title does not match is left alone', async () => {
    const user = getTestUser()
    const id = await insertActivity(
      user,
      garminActivity({ external_id: 'garmin-activity-1', title: 'Mark Efghij' }),
    )

    expect((await evaluateRule(user, rule, window, createDefaultEngineDeps())).affected_ids).toEqual([])
    expect(await getOverrideForActivity(user, id)).toBeNull()
  })

  test('an aurboda activity is retyped in place, keeping data it already has', async () => {
    const user = getTestUser()
    const id = await insertActivity(
      user,
      garminActivity({ data: { partner: 'A' }, external_id: undefined, source: 'aurboda', title: 'sex' }),
    )

    expect((await evaluateRule(user, rule, window, createDefaultEngineDeps())).affected_ids).toEqual([id])
    expect(await getActivityById(user, id)).toMatchObject({
      activity_type: 'sex',
      data: { _retyped_by: rule.id, partner: 'A' },
      title: 'Sex',
    })
  })
})
