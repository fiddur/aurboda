import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import { getOverrideForActivity, insertActivity } from '../db/activities/index.ts'
import {
  activityTypeExists,
  getDeductionRule,
  insertActivityTypeDefinition,
  insertDeductionRule,
  updateDeductionRule,
} from '../db/index.ts'
import { insertPerson, softDeletePerson } from '../db/people.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { activityPeopleOf } from './activity-people.ts'
import { createDefaultEngineDeps } from './deduction-deps.ts'
import { evaluateAllRules, evaluateRule } from './deduction-engine.ts'

const CONTAINER_TIMEOUT = 120_000

const window = { end: new Date('2026-11-02T00:00:00Z'), start: new Date('2026-11-01T00:00:00Z') }

const ensureType = async (user: string, name: string) => {
  if (await activityTypeExists(user, name)) return
  await insertActivityTypeDefinition(user, { display_category: 'other', display_name: name, name })
}

describe('a rule adding people to activities (integration)', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('the rule stores its people, and null clears them', async () => {
    const user = getTestUser()
    await ensureType(user, 'fika')
    const anna = await insertPerson(user, { name: 'Anna' })
    const rule = await insertDeductionRule(user, {
      conditions: [{ activity_type: 'fika', kind: 'activity' }],
      mode: 'enrich',
      name: 'Fika',
      output_activity_type: 'fika',
      output_people: [anna.id],
    })
    expect((await getDeductionRule(user, rule.id))?.output_people).toEqual([anna.id])
    const cleared = await updateDeductionRule(user, rule.id, { output_people: null })
    expect(cleared?.output_people).toBeUndefined()
  })

  test('enrich links the live people on the synced row, without an override or a notification', async () => {
    const user = getTestUser()
    await ensureType(user, 'fika')
    const anna = await insertPerson(user, { name: 'Anna' })
    const bo = await insertPerson(user, { name: 'Bo' })
    const fikaId = await insertActivity(user, {
      activity_type: 'fika',
      data: { with_whom: 'Anna' },
      end_time: new Date('2026-11-01T11:00:00Z'),
      external_id: 'fika-1',
      source: 'garmin',
      start_time: new Date('2026-11-01T10:00:00Z'),
    })
    const otherId = await insertActivity(user, {
      activity_type: 'fika',
      data: { with_whom: 'Cleo' },
      end_time: new Date('2026-11-01T15:00:00Z'),
      source: 'aurboda',
      start_time: new Date('2026-11-01T14:00:00Z'),
    })
    const rule = await insertDeductionRule(user, {
      conditions: [
        { activity_type: 'fika', field: 'with_whom', kind: 'activity_data', operator: 'eq', value: 'Anna' },
      ],
      mode: 'enrich',
      name: 'Fika with Anna',
      output_activity_type: 'fika',
      output_people: [anna.id, bo.id],
    })
    await softDeletePerson(user, bo.id)
    const notifier = vi.fn()
    const deps = createDefaultEngineDeps(notifier)

    expect((await evaluateRule(user, rule, window, deps, true)).would_affect).toBe(1)
    const first = await evaluateAllRules(user, [rule], window, deps)

    expect(first.activities_created).toBe(1)
    expect(await activityPeopleOf(user, [fikaId])).toEqual([{ id: anna.id, name: 'Anna' }])
    expect(await activityPeopleOf(user, [otherId])).toBeUndefined()
    expect(await getOverrideForActivity(user, fikaId)).toBeNull()
    expect(notifier).not.toHaveBeenCalled()

    expect((await evaluateRule(user, rule, window, deps, true)).would_affect).toBe(0)
    expect((await evaluateAllRules(user, [rule], window, deps)).activities_created).toBe(0)
  })

  test('create mode links the people on the activities it creates', async () => {
    const user = getTestUser()
    await ensureType(user, 'fika')
    const anna = await insertPerson(user, { name: 'Anna' })
    await insertActivity(user, {
      activity_type: 'meditation',
      end_time: new Date('2026-11-01T09:00:00Z'),
      source: 'aurboda',
      start_time: new Date('2026-11-01T08:00:00Z'),
    })
    const rule = await insertDeductionRule(user, {
      conditions: [{ activity_type: 'meditation', kind: 'activity' }],
      name: 'Fika after meditation',
      output_activity_type: 'fika',
      output_people: [anna.id],
    })
    const { affected_ids } = await evaluateRule(user, rule, window, createDefaultEngineDeps())

    expect(affected_ids).toHaveLength(1)
    expect(await activityPeopleOf(user, affected_ids)).toEqual([{ id: anna.id, name: 'Anna' }])
  })
})
