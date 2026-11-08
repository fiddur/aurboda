import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  deleteActivityTypeDefinition,
  insertActivityTypeDefinition,
  renameActivityTypeDefinition,
} from './activity-type-definitions.ts'
import { createChallenge } from './challenges.ts'
import { publicSlugIsFree } from './public-slugs.ts'
import { createSharedDashboard } from './shared-dashboards.ts'
import {
  createSharedExercise,
  deleteSharedExercise,
  findSharedExercise,
  getSharedExerciseById,
  getSharedExerciseBySlug,
  isDuplicateSharedExercise,
  isUnknownSharedExerciseType,
  listPublicSharedExercises,
  listSharedExercises,
  repointSharedExercises,
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

  test('rejects an activity type that does not exist', async () => {
    const user = getTestUser()
    const error = await createSharedExercise(user, { ...input('Bench Press'), activity_type: 'nope' }).catch(
      (e: unknown) => e,
    )
    expect(isUnknownSharedExerciseType(error)).toBe(true)
    expect(isDuplicateSharedExercise(error)).toBe(false)
  })

  test('follows a renamed activity type and goes with a deleted one', async () => {
    const user = getTestUser()
    await insertActivityTypeDefinition(user, {
      display_category: 'exercise',
      display_name: 'Kettlebell',
      name: 'kettlebell',
    })
    const created = await createSharedExercise(user, { ...input('Swing'), activity_type: 'kettlebell' })

    expect(await renameActivityTypeDefinition(user, 'kettlebell', 'kettlebells')).not.toBeNull()
    expect((await getSharedExerciseBySlug(user, created.slug))?.activity_type).toBe('kettlebells')
    expect((await findSharedExercise(user, 'kettlebells', 'sets.exercise', 'Swing'))?.id).toBe(created.id)
    expect(await findSharedExercise(user, 'kettlebell', 'sets.exercise', 'Swing')).toBeNull()

    expect(await deleteActivityTypeDefinition(user, 'kettlebells')).toBe(true)
    expect(await getSharedExerciseBySlug(user, created.slug)).toBeNull()
  })

  test('repoints a share to the merge target, keeping its name and slug', async () => {
    const user = getTestUser()
    const created = await createSharedExercise(user, input('Bench press'))

    expect(
      await repointSharedExercises(
        user,
        ['strength_training'],
        'sets.exercise',
        'Bench press',
        'Bench Press',
      ),
    ).toBe(1)
    expect(await getSharedExerciseBySlug(user, created.slug)).toMatchObject({
      name: 'Bench press',
      value: 'Bench Press',
    })
    expect(await repointSharedExercises(user, ['running'], 'sets.exercise', 'Bench Press', 'Bench')).toBe(0)
  })

  test('repoints any spelling of the source, keeping one share per type', async () => {
    const user = getTestUser()
    const oldest = await createSharedExercise(user, input('bench press'))
    const other = await createSharedExercise(user, input(' Bench press'))

    expect(
      await repointSharedExercises(
        user,
        ['strength_training'],
        'sets.exercise',
        'BENCH PRESS',
        'Bench Press',
      ),
    ).toBe(1)
    expect((await getSharedExerciseById(user, oldest.id))?.value).toBe('Bench Press')
    expect(await getSharedExerciseById(user, other.id)).toBeNull()
  })

  test('drops the source share when the target is already shared', async () => {
    const user = getTestUser()
    const source = await createSharedExercise(user, input('Bench'))
    const target = await createSharedExercise(user, input('Bench Press'))

    expect(
      await repointSharedExercises(user, ['strength_training'], 'sets.exercise', 'Bench', 'Bench Press'),
    ).toBe(0)
    expect(await getSharedExerciseById(user, source.id)).toBeNull()
    expect((await getSharedExerciseById(user, target.id))?.value).toBe('Bench Press')
  })

  test('a public slug taken by a dashboard, a challenge or an exercise is not free', async () => {
    const user = getTestUser()
    const dashboard = await createSharedDashboard(user, {
      config: { sections: [], version: 1 },
      is_private: false,
      is_public: false,
      name: 'D',
    })
    const challenge = await createChallenge(user, {
      announce_winner: false,
      end_ts: new Date('2026-06-08T00:00:00Z'),
      is_public: false,
      name: 'C',
      spec: {
        activity_type_id: null,
        aggregation: 'sum',
        bucket_size: '1d',
        filter_field: null,
        filter_value: null,
        measure: null,
        pattern: 'steps',
        source_type: 'metric',
        unit: 'steps',
      },
      start_ts: new Date('2026-06-01T00:00:00Z'),
      timezone: 'Europe/Stockholm',
    })
    const exercise = await createSharedExercise(user, input('Bench Press'))

    expect(await publicSlugIsFree(user, dashboard.slug)).toBe(false)
    expect(await publicSlugIsFree(user, challenge.slug)).toBe(false)
    expect(await publicSlugIsFree(user, exercise.slug)).toBe(false)
    expect(await publicSlugIsFree(user, 'unused-slug')).toBe(true)
  })
})
