import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { deleteActivity, insertActivity } from './activities/index.ts'
import { upsertItemValueAlias } from './item-value-aliases.ts'
import { upsertItemValueIdentity } from './item-value-identities.ts'
import { createSharedExercise } from './shared-exercises.ts'
import { getStrengthScoreInputAggregates } from './strength-score-inputs.ts'
import { deleteTimeSeriesPoint, insertTimeSeries } from './time-series.ts'

const CONTAINER_TIMEOUT = 120_000

const types = ['strength_training']

describe('strength score input aggregates integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('is empty for a user without inputs', async () => {
    expect(await getStrengthScoreInputAggregates(getTestUser(), types)).toEqual({
      activities: { changed_at: null, count: 0 },
      item_value_aliases: { changed_at: null, count: 0 },
      item_value_identities: { changed_at: null, count: 0 },
      shared_exercises: { changed_at: null, count: 0 },
      weight: { changed_at: null, count: 0, deleted: 0 },
    })
  })

  test('counts every input and changes when one changes', async () => {
    const user = getTestUser()
    const sessionId = await insertActivity(user, {
      activity_type: 'strength_training',
      data: { sets: [{ exercise: 'Bench press', reps: 5, weight: 80 }] },
      external_id: 'ext-1',
      source: 'gravl',
      start_time: new Date('2026-06-01T07:00:00Z'),
    })
    await insertActivity(user, {
      activity_type: 'exercise',
      external_id: 'ext-2',
      source: 'gravl',
      start_time: new Date('2026-06-02T07:00:00Z'),
    })
    const weightAt = new Date('2026-06-01T06:00:00Z')
    await insertTimeSeries(user, [
      { metric: 'weight', source: 'manual', time: weightAt, value: 80 },
      { metric: 'weight', source: 'manual', time: new Date('2026-06-02T06:00:00Z'), value: 81 },
      { metric: 'steps', source: 'health_connect_aggregate', time: weightAt, value: 1000 },
    ])
    await upsertItemValueIdentity(
      user,
      'strength_training.sets.exercise',
      'Bench press',
      'barbell_bench_press',
    )
    await upsertItemValueAlias(user, 'strength_training.sets.exercise', 'Bench', 'Bench press')
    await createSharedExercise(user, {
      activity_type: 'strength_training',
      field: 'sets.exercise',
      is_public: false,
      name: 'Bench press',
      value: 'Bench press',
    })

    const before = await getStrengthScoreInputAggregates(user, types)
    expect(before.activities.count).toBe(1)
    expect(before.activities.changed_at).not.toBeNull()
    expect(before.weight).toMatchObject({ count: 2, deleted: 0 })
    expect(before.item_value_identities.count).toBe(1)
    expect(before.item_value_aliases.count).toBe(1)
    expect(before.shared_exercises.count).toBe(1)

    await deleteTimeSeriesPoint(user, 'weight', weightAt, 'manual')
    await deleteActivity(user, sessionId)
    const after = await getStrengthScoreInputAggregates(user, types)
    expect(after.weight).toMatchObject({ count: 1, deleted: 1 })
    expect(after.activities.count).toBe(1)
    expect(after.activities.changed_at).not.toBe(before.activities.changed_at)
  })
})
