import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  createSharedExercise,
  deleteSharedExercise,
  findSharedExercise,
  getSharedExerciseById,
  getSharedExerciseBySlug,
  isDuplicateSharedExercise,
  listPublicSharedExercises,
  listSharedExercises,
  type SharedExerciseInput,
  updateSharedExercise,
} from './shared-exercises.ts'

const CONTAINER_TIMEOUT = 120_000

const input = (value: string, is_public = false): SharedExerciseInput => ({
  activity_type: 'strength_training',
  field: 'sets.exercise',
  is_public,
  name: value,
  value,
})

describe('Shared exercises integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('creates with a generated slug and round-trips by id, slug and item', async () => {
    const user = getTestUser()
    const created = await createSharedExercise(user, input('Bench Press'))

    expect(created.slug).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(created).toMatchObject({
      activity_type: 'strength_training',
      field: 'sets.exercise',
      is_public: false,
      name: 'Bench Press',
      value: 'Bench Press',
    })

    expect((await getSharedExerciseById(user, created.id))?.slug).toBe(created.slug)
    expect((await getSharedExerciseBySlug(user, created.slug))?.id).toBe(created.id)
    expect((await findSharedExercise(user, 'strength_training', 'sets.exercise', 'Bench Press'))?.id).toBe(
      created.id,
    )
    expect(await findSharedExercise(user, 'strength_training', 'sets.exercise', 'Squat')).toBeNull()
    expect(await getSharedExerciseBySlug(user, 'does-not-exist')).toBeNull()
  })

  test('shares an item at most once', async () => {
    const user = getTestUser()
    await createSharedExercise(user, input('Bench Press'))
    const error = await createSharedExercise(user, input('Bench Press')).catch((e: unknown) => e)
    expect(isDuplicateSharedExercise(error)).toBe(true)
    expect((await createSharedExercise(user, input('Squat'))).value).toBe('Squat')
  })

  test('lists all (newest first) and filters public-only', async () => {
    const user = getTestUser()
    await createSharedExercise(user, input('A', true))
    await createSharedExercise(user, input('B'))
    await createSharedExercise(user, input('C', true))

    expect((await listSharedExercises(user)).map((e) => e.name)).toEqual(['C', 'B', 'A'])
    expect((await listPublicSharedExercises(user)).map((e) => e.name)).toEqual(['C', 'A'])
  })

  test('partially updates name and visibility without changing the slug', async () => {
    const user = getTestUser()
    const created = await createSharedExercise(user, input('Bench Press'))

    const renamed = await updateSharedExercise(user, created.id, { name: 'My bench' })
    expect(renamed).toMatchObject({ is_public: false, name: 'My bench', slug: created.slug })

    const published = await updateSharedExercise(user, created.id, { is_public: true })
    expect(published).toMatchObject({ is_public: true, name: 'My bench' })

    expect((await updateSharedExercise(user, created.id, {}))?.name).toBe('My bench')
    expect(await updateSharedExercise(user, '00000000-0000-0000-0000-000000000000', { name: 'x' })).toBeNull()
  })

  test('deletes a share and reports missing ones', async () => {
    const user = getTestUser()
    const created = await createSharedExercise(user, input('Bench Press'))

    expect(await deleteSharedExercise(user, created.id)).toBe(true)
    expect(await getSharedExerciseBySlug(user, created.slug)).toBeNull()
    expect(await deleteSharedExercise(user, created.id)).toBe(false)
  })
})
