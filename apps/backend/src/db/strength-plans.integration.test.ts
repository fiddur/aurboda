import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { deleteActivity, insertActivity } from './activities/index.ts'
import {
  createStrengthPlan,
  deleteStrengthPlan,
  getStrengthPlan,
  listStrengthPlans,
  listStrengthPlanSessions,
  updateStrengthPlan,
} from './strength-plans.ts'

const CONTAINER_TIMEOUT = 120_000
const MISSING_ID = '00000000-0000-0000-0000-000000000000'

const sets = [
  { exercise: 'Bench Press', exercise_key: 'barbell_bench_press', reps: 8, weight: 60 },
  { exercise: 'Plank', time: 45 },
]

const session = (planId: string, start: string) =>
  insertActivity(getTestUser(), {
    activity_type: 'strength_training',
    data: { plan_id: planId, sets: [] },
    source: 'aurboda',
    start_time: new Date(start),
  })

describe('Strength plans integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('creates a plan and round-trips it by id, the day unchanged', async () => {
    const user = getTestUser()
    const created = await createStrengthPlan(user, {
      name: 'Push day',
      note: 'Go heavy',
      planned_for: '2026-11-19',
      sets,
    })

    expect(created.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(created.planned_for).toBe('2026-11-19')
    expect(created.note).toBe('Go heavy')
    expect(created.sets).toEqual(sets)
    expect(created.created_at).toBeInstanceOf(Date)
    expect(created.updated_at).toBeInstanceOf(Date)

    expect(await getStrengthPlan(user, created.id)).toEqual(created)
    expect(await getStrengthPlan(user, MISSING_ID)).toBeNull()
  })

  test('the day reads back as written, also in the list', async () => {
    const user = getTestUser()
    const created = await createStrengthPlan(user, { name: 'A', note: null, planned_for: '2026-01-01', sets })
    expect((await getStrengthPlan(user, created.id))?.planned_for).toBe('2026-01-01')
    expect((await listStrengthPlans(user))[0].planned_for).toBe('2026-01-01')
  })

  test('a routine has no day', async () => {
    const user = getTestUser()
    const created = await createStrengthPlan(user, { name: 'Full body', note: null, planned_for: null, sets })
    expect(created.planned_for).toBeNull()
    expect(created.note).toBeNull()
  })

  test('lists every plan', async () => {
    const user = getTestUser()
    const a = await createStrengthPlan(user, { name: 'A', note: null, planned_for: null, sets })
    const b = await createStrengthPlan(user, { name: 'B', note: null, planned_for: '2026-11-20', sets })
    expect((await listStrengthPlans(user)).map((p) => p.id).sort()).toEqual([a.id, b.id].sort())
  })

  test('update leaves untouched fields alone and clears with null', async () => {
    const user = getTestUser()
    const created = await createStrengthPlan(user, {
      name: 'Push day',
      note: 'Go heavy',
      planned_for: '2026-11-19',
      sets,
    })

    const renamed = await updateStrengthPlan(user, created.id, { name: 'Push' })
    expect(renamed).toMatchObject({ name: 'Push', note: 'Go heavy', planned_for: '2026-11-19', sets })
    expect(renamed?.updated_at.getTime()).toBeGreaterThanOrEqual(created.updated_at.getTime())

    const cleared = await updateStrengthPlan(user, created.id, { note: null, planned_for: null })
    expect(cleared).toMatchObject({ name: 'Push', note: null, planned_for: null, sets })

    const replaced = await updateStrengthPlan(user, created.id, {
      planned_for: '2026-12-01',
      sets: [{ exercise: 'Squat', reps: 5 }],
    })
    expect(replaced).toMatchObject({ planned_for: '2026-12-01', sets: [{ exercise: 'Squat', reps: 5 }] })

    expect(await updateStrengthPlan(user, MISSING_ID, { name: 'X' })).toBeNull()
  })

  test('delete removes the row once', async () => {
    const user = getTestUser()
    const created = await createStrengthPlan(user, { name: 'A', note: null, planned_for: null, sets })
    expect(await deleteStrengthPlan(user, created.id)).toBe(true)
    expect(await deleteStrengthPlan(user, created.id)).toBe(false)
    expect(await getStrengthPlan(user, created.id)).toBeNull()
  })

  test('sessions are the non-deleted activities carrying the plan id, newest first', async () => {
    const user = getTestUser()
    const plan = await createStrengthPlan(user, { name: 'A', note: null, planned_for: null, sets })
    const other = await createStrengthPlan(user, { name: 'B', note: null, planned_for: null, sets })

    const older = await session(plan.id, '2026-11-10T08:00:00Z')
    const newer = await session(plan.id, '2026-11-12T08:00:00Z')
    const deleted = await session(plan.id, '2026-11-14T08:00:00Z')
    await deleteActivity(user, deleted)
    const otherSession = await session(other.id, '2026-11-11T08:00:00Z')
    await insertActivity(user, {
      activity_type: 'strength_training',
      data: { sets: [] },
      source: 'aurboda',
      start_time: new Date('2026-11-13T08:00:00Z'),
    })

    const all = await listStrengthPlanSessions(user)
    expect(all.get(plan.id)).toEqual([
      { activity_id: newer, start_time: new Date('2026-11-12T08:00:00Z') },
      { activity_id: older, start_time: new Date('2026-11-10T08:00:00Z') },
    ])
    expect(all.get(other.id)).toEqual([
      { activity_id: otherSession, start_time: new Date('2026-11-11T08:00:00Z') },
    ])
    expect(all.size).toBe(2)

    const one = await listStrengthPlanSessions(user, [other.id])
    expect([...one.keys()]).toEqual([other.id])
  })
})
