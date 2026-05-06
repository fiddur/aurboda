/**
 * Integration tests for screentime category ↔ activity_type_definitions linking.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { query } from '../db/connection.ts'
import {
  getActivityTypeDefinition,
  getScreentimeCategories,
  getScreentimeCategoryById,
  insertActivityTypeDefinition,
  insertScreentimeCategory,
} from '../db/index.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { createCategory, moveCategoryToParent } from './screentime-categories.ts'
import { ensureAllCategoriesHaveTypes, ensureCategoryHasType } from './screentime-category-sync.ts'

const CONTAINER_TIMEOUT = 120_000

describe('screentime category → activity type sync', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
    // Clear non-builtin types accumulated across tests so each test starts fresh.
    await query(getTestUser(), `DELETE FROM activity_type_definitions WHERE is_builtin = false`)
  })

  test('createCategory mirrors a fresh category into a derived type def', async () => {
    const user = getTestUser()
    const cat = await createCategory(user, {
      color: '#22c55e',
      name: ['Work'],
      rule_regex: 'vscode',
      rule_type: 'regex',
    })

    expect(cat.activity_type_name).toBe('work')
    const def = await getActivityTypeDefinition(user, 'work')
    expect(def).not.toBeNull()
    expect(def!.display_name).toBe('Work')
    expect(def!.color).toBe('#22c55e')
    expect(def!.parent_type).toBeUndefined()
    expect(def!.is_builtin).toBe(false)
  })

  test('child category inherits parent slug as parent_type', async () => {
    const user = getTestUser()
    const parent = await createCategory(user, {
      name: ['Work'],
      rule_type: 'none',
    })
    expect(parent.activity_type_name).toBe('work')

    const child = await createCategory(user, {
      name: ['Work', 'Programming'],
      rule_regex: 'vscode',
      rule_type: 'regex',
    })

    expect(child.activity_type_name).toBe('programming')
    const def = await getActivityTypeDefinition(user, 'programming')
    expect(def!.parent_type).toBe('work')
  })

  test('convergence: leaf colliding with existing non-builtin type links to it', async () => {
    const user = getTestUser()
    // A pre-existing user activity type — could be from a deduction rule or manual create.
    await insertActivityTypeDefinition(user, {
      color: '#ec4899',
      display_category: 'other',
      display_name: 'TV',
      name: 'tv',
    })

    const cat = await createCategory(user, {
      color: '#999999',
      name: ['Media', 'TV'],
      rule_regex: 'Plex|VLC',
      rule_type: 'regex',
    })

    // Linked to the pre-existing type, not a fresh insert.
    expect(cat.activity_type_name).toBe('tv')
    const def = await getActivityTypeDefinition(user, 'tv')
    // Pre-existing metadata preserved (no clobbering).
    expect(def!.display_name).toBe('TV')
    expect(def!.color).toBe('#ec4899')
  })

  test('builtin collision forces parent-prefix slug', async () => {
    const user = getTestUser()
    // `screentime` is a builtin — a category literally named "Screentime"
    // would collide. The slug helper falls back to parent-prefix when a parent
    // slug is available.
    await createCategory(user, { name: ['Test'], rule_type: 'none' })
    const cat = await createCategory(user, {
      name: ['Test', 'Screentime'],
      rule_type: 'none',
    })
    expect(cat.activity_type_name).toBe('test_screentime')
  })

  test('moveCategoryToParent updates parent_type on the derived type def', async () => {
    const user = getTestUser()
    await createCategory(user, { name: ['Work'], rule_type: 'none' })
    const hobby = await createCategory(user, { name: ['Hobby'], rule_type: 'none' })
    const programming = await createCategory(user, {
      name: ['Work', 'Programming'],
      rule_type: 'none',
    })
    expect((await getActivityTypeDefinition(user, 'programming'))!.parent_type).toBe('work')

    await moveCategoryToParent(user, programming.id, hobby.id)

    expect((await getActivityTypeDefinition(user, 'programming'))!.parent_type).toBe('hobby')
    // The category itself reflects the new path
    const moved = await getScreentimeCategoryById(user, programming.id)
    expect(moved!.name).toEqual(['Hobby', 'Programming'])
    // Slug stayed stable
    expect(moved!.activity_type_name).toBe('programming')
    // Sanity: untouched siblings unaffected
    expect((await getActivityTypeDefinition(user, 'work'))!.parent_type).toBeUndefined()
    expect((await getActivityTypeDefinition(user, 'hobby'))!.parent_type).toBeUndefined()
  })

  test('ensureAllCategoriesHaveTypes processes parents before children', async () => {
    const user = getTestUser()
    // Insert categories raw (bypassing service layer) so they have no slugs yet.
    await insertScreentimeCategory(user, { name: ['Top'], rule_type: 'none' })
    await insertScreentimeCategory(user, { name: ['Top', 'Mid'], rule_type: 'none' })
    await insertScreentimeCategory(user, { name: ['Top', 'Mid', 'Leaf'], rule_type: 'none' })

    const all = await getScreentimeCategories(user)
    await ensureAllCategoriesHaveTypes(user, all)

    const refreshed = await getScreentimeCategories(user)
    const slugByPath = new Map(refreshed.map((c) => [c.name.join('/'), c.activity_type_name]))
    expect(slugByPath.get('Top')).toBe('top')
    expect(slugByPath.get('Top/Mid')).toBe('mid')
    expect(slugByPath.get('Top/Mid/Leaf')).toBe('leaf')

    expect((await getActivityTypeDefinition(user, 'top'))!.parent_type).toBeUndefined()
    expect((await getActivityTypeDefinition(user, 'mid'))!.parent_type).toBe('top')
    expect((await getActivityTypeDefinition(user, 'leaf'))!.parent_type).toBe('mid')
  })

  test('ensureCategoryHasType is idempotent — second call is a no-op', async () => {
    const user = getTestUser()
    const cat = await createCategory(user, { name: ['Solo'], rule_type: 'none' })
    expect(cat.activity_type_name).toBe('solo')

    const all = await getScreentimeCategories(user)
    const slug = await ensureCategoryHasType(user, all[0], all)
    expect(slug).toBe('solo')
    // Type def should still exist exactly once.
    const def = await getActivityTypeDefinition(user, 'solo')
    expect(def).not.toBeNull()
  })

  test('two categories with the same leaf converge on one type', async () => {
    const user = getTestUser()
    // "Reading" is not a builtin activity_type — clean leaf, no rename.
    await createCategory(user, { name: ['Quiet'], rule_type: 'none' })
    await createCategory(user, { name: ['Loud'], rule_type: 'none' })
    const a = await createCategory(user, { name: ['Quiet', 'Reading'], rule_type: 'none' })
    const b = await createCategory(user, { name: ['Loud', 'Reading'], rule_type: 'none' })

    expect(a.activity_type_name).toBe('reading')
    expect(b.activity_type_name).toBe('reading') // converged — no unique-index error

    // Both rows persisted the slug; the column is intentionally not unique.
    const refreshed = await getScreentimeCategories(user)
    const readingRows = refreshed.filter((c) => c.activity_type_name === 'reading')
    expect(readingRows).toHaveLength(2)
  })

  test('moving a converged category does NOT clobber the shared type parent_type', async () => {
    const user = getTestUser()
    // A pre-existing user activity type — could be from a deduction rule.
    await insertActivityTypeDefinition(user, {
      color: '#ec4899',
      display_category: 'other',
      display_name: 'TV',
      name: 'tv',
    })
    // Two parents, one category that converges on the existing `tv` type.
    await createCategory(user, { name: ['Media'], rule_type: 'none' })
    await createCategory(user, { name: ['Hobby'], rule_type: 'none' })
    const tvCat = await createCategory(user, { name: ['Media', 'TV'], rule_type: 'none' })
    expect(tvCat.activity_type_name).toBe('tv')

    // tv was created with no parent_type by the deduction rule path.
    expect((await getActivityTypeDefinition(user, 'tv'))!.parent_type).toBeUndefined()

    // Move the category. Because the type was created independently
    // (category linked, not created), parent_type should NOT change.
    const hobby = (await getScreentimeCategories(user)).find((c) => c.name[0] === 'Hobby')!
    await moveCategoryToParent(user, tvCat.id, hobby.id)

    expect((await getActivityTypeDefinition(user, 'tv'))!.parent_type).toBeUndefined()
  })

  test('moving a sole-owner category DOES update its type parent_type', async () => {
    const user = getTestUser()
    await createCategory(user, { name: ['Quiet'], rule_type: 'none' })
    await createCategory(user, { name: ['Loud'], rule_type: 'none' })
    const reading = await createCategory(user, {
      name: ['Quiet', 'Reading'],
      rule_type: 'none',
    })
    expect((await getActivityTypeDefinition(user, 'reading'))!.parent_type).toBe('quiet')

    const loud = (await getScreentimeCategories(user)).find((c) => c.name[0] === 'Loud')!
    await moveCategoryToParent(user, reading.id, loud.id)

    expect((await getActivityTypeDefinition(user, 'reading'))!.parent_type).toBe('loud')
  })

  test('concurrent ensureCategoryHasType calls do not error', async () => {
    const user = getTestUser()
    // Insert raw (no slug yet).
    const inserted = await insertScreentimeCategory(user, { name: ['Race'], rule_type: 'none' })
    const all = await getScreentimeCategories(user)

    // Two parallel ensures for the same category — simulating concurrent
    // RescueTime + ActivityWatch syncs hitting the lazy-link path.
    const [s1, s2] = await Promise.all([
      ensureCategoryHasType(user, { ...inserted }, [...all]),
      ensureCategoryHasType(user, { ...inserted }, [...all]),
    ])
    expect(s1).toBe('race')
    expect(s2).toBe('race')
    expect(await getActivityTypeDefinition(user, 'race')).not.toBeNull()
  })
})
