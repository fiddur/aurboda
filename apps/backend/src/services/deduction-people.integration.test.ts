import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import { getOverrideForActivity, insertActivity } from '../db/activities/index.ts'
import { query } from '../db/connection.ts'
import {
  activityTypeExists,
  deleteDeductionRule,
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
import { updateActivity } from './mutations.ts'

const CONTAINER_TIMEOUT = 120_000

const window = { end: new Date('2026-11-02T00:00:00Z'), start: new Date('2026-11-01T00:00:00Z') }

const ensureType = async (user: string, name: string) => {
  if (await activityTypeExists(user, name)) return
  await insertActivityTypeDefinition(user, { display_category: 'other', display_name: name, name })
}

const fika = (user: string, start: string, data: Record<string, unknown> = {}, end?: string) =>
  insertActivity(user, {
    activity_type: 'fika',
    data,
    end_time: end ? new Date(end) : undefined,
    source: 'aurboda',
    start_time: new Date(start),
  })

const fikaRule = (user: string, people: string[]) =>
  insertDeductionRule(user, {
    conditions: [{ activity_type: 'meditation', kind: 'activity' }],
    mode: 'enrich',
    name: 'Fika after meditation',
    output_activity_type: 'fika',
    output_people: people,
  })

const meditation = (user: string) =>
  insertActivity(user, {
    activity_type: 'meditation',
    end_time: new Date('2026-11-01T11:00:00Z'),
    source: 'aurboda',
    start_time: new Date('2026-11-01T10:00:00Z'),
  })

const namesOn = async (user: string, rowIds: string[]) =>
  ((await activityPeopleOf(user, rowIds)) ?? []).map((p) => p.name).toSorted()

const recordedFor = async (user: string, ruleId: string) =>
  (
    await query<{ count: number }>(
      user,
      'SELECT COUNT(*)::int AS count FROM rule_activity_people WHERE rule_id = $1',
      [ruleId],
    )
  ).rows[0]!.count

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

  test('a person taken off by hand is not added again by the rule', async () => {
    const user = getTestUser()
    await ensureType(user, 'fika')
    const anna = await insertPerson(user, { name: 'Anna' })
    await meditation(user)
    const fikaId = await fika(user, '2026-11-01T10:30:00Z', {}, '2026-11-01T11:30:00Z')
    const rule = await fikaRule(user, [anna.id])
    const deps = createDefaultEngineDeps()

    await evaluateAllRules(user, [rule], window, deps)
    expect(await namesOn(user, [fikaId])).toEqual(['Anna'])

    expect((await updateActivity(user, fikaId, { people: [] })).success).toBe(true)
    expect((await evaluateRule(user, rule, window, deps, true)).would_affect).toBe(0)
    expect((await evaluateAllRules(user, [rule], window, deps)).activities_created).toBe(0)
    expect(await namesOn(user, [fikaId])).toEqual([])
  })

  test('an activity whose people were set by hand gets nobody from the rule, even once emptied', async () => {
    const user = getTestUser()
    await ensureType(user, 'fika')
    const anna = await insertPerson(user, { name: 'Anna' })
    const bo = await insertPerson(user, { name: 'Bo' })
    await meditation(user)
    const fikaId = await fika(user, '2026-11-01T10:30:00Z', {}, '2026-11-01T11:30:00Z')
    expect((await updateActivity(user, fikaId, { people: [bo.id] })).success).toBe(true)
    const rule = await fikaRule(user, [anna.id])
    const deps = createDefaultEngineDeps()

    expect((await evaluateRule(user, rule, window, deps, true)).would_affect).toBe(0)
    await evaluateAllRules(user, [rule], window, deps)
    await evaluateAllRules(user, [rule], window, deps)
    expect(await namesOn(user, [fikaId])).toEqual(['Bo'])

    expect((await updateActivity(user, fikaId, { people: [] })).success).toBe(true)
    await evaluateAllRules(user, [rule], window, deps)
    expect(await namesOn(user, [fikaId])).toEqual([])
  })

  test('a person set by hand on the override protects the synced row it overrides', async () => {
    const user = getTestUser()
    await ensureType(user, 'fika')
    const anna = await insertPerson(user, { name: 'Anna' })
    const bo = await insertPerson(user, { name: 'Bo' })
    await meditation(user)
    const syncedId = await insertActivity(user, {
      activity_type: 'fika',
      end_time: new Date('2026-11-01T11:30:00Z'),
      external_id: 'fika-synced',
      source: 'garmin',
      start_time: new Date('2026-11-01T10:30:00Z'),
    })
    expect((await updateActivity(user, syncedId, { title: 'Fika at home' })).success).toBe(true)
    const override = await getOverrideForActivity(user, syncedId)
    expect(override).not.toBeNull()
    expect((await updateActivity(user, syncedId, { people: [bo.id] })).success).toBe(true)
    const rule = await fikaRule(user, [anna.id])
    const deps = createDefaultEngineDeps()

    expect(await deps.addActivityPeople(user, rule.id, [syncedId], [anna.id], true)).toEqual([])
    await evaluateAllRules(user, [rule], window, deps)
    expect(await namesOn(user, [syncedId, override!.id!])).toEqual(['Bo'])
  })

  test('two rules each add their person to the same activity', async () => {
    const user = getTestUser()
    await ensureType(user, 'fika')
    const anna = await insertPerson(user, { name: 'Anna' })
    const bo = await insertPerson(user, { name: 'Bo' })
    await meditation(user)
    const fikaId = await fika(user, '2026-11-01T10:30:00Z', {}, '2026-11-01T11:30:00Z')
    const withAnna = await fikaRule(user, [anna.id])
    const withBo = await fikaRule(user, [bo.id])
    const deps = createDefaultEngineDeps()

    await evaluateAllRules(user, [withAnna], window, deps)
    await evaluateAllRules(user, [withBo], window, deps)
    expect(await namesOn(user, [fikaId])).toEqual(['Anna', 'Bo'])
  })

  test('a person added to the rule later reaches the activities it handled, not one edited by hand', async () => {
    const user = getTestUser()
    await ensureType(user, 'fika')
    const anna = await insertPerson(user, { name: 'Anna' })
    const bo = await insertPerson(user, { name: 'Bo' })
    const cleo = await insertPerson(user, { name: 'Cleo' })
    await meditation(user)
    const untouched = await fika(user, '2026-11-01T10:00:00Z', {}, '2026-11-01T10:20:00Z')
    const edited = await fika(user, '2026-11-01T10:40:00Z', {}, '2026-11-01T11:30:00Z')
    const rule = await fikaRule(user, [anna.id])
    const deps = createDefaultEngineDeps()
    await evaluateAllRules(user, [rule], window, deps)
    expect((await updateActivity(user, edited, { people: [cleo.id] })).success).toBe(true)

    await updateDeductionRule(user, rule.id, { output_people: [anna.id, bo.id] })
    const widened = (await getDeductionRule(user, rule.id))!
    expect((await evaluateRule(user, widened, window, deps, true)).would_affect).toBe(1)
    await evaluateAllRules(user, [widened], window, deps)

    expect(await namesOn(user, [untouched])).toEqual(['Anna', 'Bo'])
    expect(await namesOn(user, [edited])).toEqual(['Cleo'])
  })

  test('an open-ended activity counts as one hour long for an enrich rule', async () => {
    const user = getTestUser()
    await ensureType(user, 'fika')
    const anna = await insertPerson(user, { name: 'Anna' })
    await meditation(user)
    const daysBefore = await fika(user, '2026-10-29T10:00:00Z', { place: 'Café' })
    const justBefore = await fika(user, '2026-11-01T09:30:00Z', { place: 'Café' })
    const rule = await insertDeductionRule(user, {
      conditions: [{ activity_type: 'meditation', kind: 'activity' }],
      mode: 'enrich',
      name: 'Calm fika',
      output_activity_type: 'fika',
      output_data: { mood: 'calm' },
      output_people: [anna.id],
      output_title_field: 'place',
    })

    await evaluateAllRules(user, [rule], window, createDefaultEngineDeps())

    const rows = await query<{ id: string; title: string | null; mood: string | null }>(
      user,
      `SELECT id, title, data->>'mood' AS mood FROM activities WHERE id = ANY($1::uuid[])`,
      [[daysBefore, justBefore]],
    )
    const byId = new Map(rows.rows.map((r) => [r.id, r]))
    expect(byId.get(daysBefore)).toMatchObject({ mood: null, title: null })
    expect(byId.get(justBefore)).toMatchObject({ mood: 'calm', title: 'Café' })
    expect(await namesOn(user, [daysBefore])).toEqual([])
    expect(await namesOn(user, [justBefore])).toEqual(['Anna'])
  })

  test('the preview of a rule with people does not fail on its rule id', async () => {
    const user = getTestUser()
    await ensureType(user, 'fika')
    const anna = await insertPerson(user, { name: 'Anna' })
    await meditation(user)
    await fika(user, '2026-11-01T10:30:00Z', {}, '2026-11-01T11:30:00Z')
    const rule = await fikaRule(user, [anna.id])

    const preview = await evaluateRule(
      user,
      { ...rule, id: 'preview' },
      window,
      createDefaultEngineDeps(),
      true,
    )

    expect(preview.would_affect).toBe(1)
  })

  test('deleting the rule drops its record and keeps the links', async () => {
    const user = getTestUser()
    await ensureType(user, 'fika')
    const anna = await insertPerson(user, { name: 'Anna' })
    await meditation(user)
    const fikaId = await fika(user, '2026-11-01T10:30:00Z', {}, '2026-11-01T11:30:00Z')
    const rule = await fikaRule(user, [anna.id])
    await evaluateAllRules(user, [rule], window, createDefaultEngineDeps())
    expect(await recordedFor(user, rule.id)).toBe(1)

    expect(await deleteDeductionRule(user, rule.id)).toBe(true)

    expect(await recordedFor(user, rule.id)).toBe(0)
    expect(await namesOn(user, [fikaId])).toEqual(['Anna'])
  })
})
