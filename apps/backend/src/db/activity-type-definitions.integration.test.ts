/**
 * Integration tests for the hierarchical activity type definitions.
 *
 * Verifies parent_type relationships: CRUD, cycle prevention, descendant
 * expansion, reparenting on delete and merge.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  deleteActivityTypeDefinition,
  expandActivityTypes,
  getActivityTypeDefinition,
  getDescendantTypes,
  insertActivityTypeDefinition,
  mergeActivityTypeDefinition,
  updateActivityTypeDefinition,
} from './activity-type-definitions.ts'
import { query } from './connection.ts'

const CONTAINER_TIMEOUT = 60_000

describe('Hierarchical activity types', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
    // Seed test-specific custom types with hierarchy.
    // The built-in exercise subtypes are already seeded by initializeSchema.
  })

  describe('seed hierarchy', () => {
    test('exercise subtypes have parent_type = exercise', async () => {
      const user = getTestUser()
      const running = await getActivityTypeDefinition(user, 'running')
      expect(running?.parent_type).toBe('exercise')
      const yoga = await getActivityTypeDefinition(user, 'yoga')
      expect(yoga?.parent_type).toBe('exercise')
    })

    test('nap and rest have parent_type = sleep', async () => {
      const user = getTestUser()
      const nap = await getActivityTypeDefinition(user, 'nap')
      expect(nap?.parent_type).toBe('sleep')
      const rest = await getActivityTypeDefinition(user, 'rest')
      expect(rest?.parent_type).toBe('sleep')
    })

    test('root types have no parent_type', async () => {
      const user = getTestUser()
      const exercise = await getActivityTypeDefinition(user, 'exercise')
      expect(exercise?.parent_type).toBeUndefined()
      const sleep = await getActivityTypeDefinition(user, 'sleep')
      expect(sleep?.parent_type).toBeUndefined()
    })
  })

  describe('insertActivityTypeDefinition with parent_type', () => {
    test('creates a type with a valid parent', async () => {
      const user = getTestUser()
      const result = await insertActivityTypeDefinition(user, {
        name: 'hatha_yoga',
        display_name: 'Hatha Yoga',
        display_category: 'exercise',
        parent_type: 'yoga',
      })
      expect(result.parent_type).toBe('yoga')
    })

    test('rejects non-existent parent', async () => {
      const user = getTestUser()
      await expect(
        insertActivityTypeDefinition(user, {
          name: 'foo_bar',
          display_name: 'Foo',
          display_category: 'other',
          parent_type: 'nonexistent_parent',
        }),
      ).rejects.toThrow(/does not exist/)
    })

    test('rejects self as parent', async () => {
      const user = getTestUser()
      await expect(
        insertActivityTypeDefinition(user, {
          name: 'self_ref',
          display_name: 'Self',
          display_category: 'other',
          parent_type: 'self_ref',
        }),
      ).rejects.toThrow(/cannot reference the type itself/)
    })
  })

  describe('updateActivityTypeDefinition parent_type', () => {
    test('sets parent_type on existing type', async () => {
      const user = getTestUser()
      await insertActivityTypeDefinition(user, {
        name: 'my_exercise',
        display_name: 'My Exercise',
        display_category: 'exercise',
      })
      const updated = await updateActivityTypeDefinition(user, 'my_exercise', {
        parent_type: 'exercise',
      })
      expect(updated?.parent_type).toBe('exercise')
    })

    test('clears parent_type when set to null', async () => {
      const user = getTestUser()
      await insertActivityTypeDefinition(user, {
        name: 'temp_type',
        display_name: 'Temp',
        display_category: 'other',
        parent_type: 'exercise',
      })
      const cleared = await updateActivityTypeDefinition(user, 'temp_type', {
        parent_type: null,
      })
      expect(cleared?.parent_type).toBeUndefined()
    })

    test('rejects cycle', async () => {
      const user = getTestUser()
      await insertActivityTypeDefinition(user, {
        name: 'a_type',
        display_name: 'A',
        display_category: 'other',
      })
      await insertActivityTypeDefinition(user, {
        name: 'b_type',
        display_name: 'B',
        display_category: 'other',
        parent_type: 'a_type',
      })
      // Trying to set a_type.parent = b_type would create a cycle
      await expect(updateActivityTypeDefinition(user, 'a_type', { parent_type: 'b_type' })).rejects.toThrow(
        /cycle/,
      )
    })
  })

  describe('getDescendantTypes', () => {
    test('returns all descendants including grandchildren', async () => {
      const user = getTestUser()
      await insertActivityTypeDefinition(user, {
        name: 'cardio',
        display_name: 'Cardio',
        display_category: 'exercise',
        parent_type: 'exercise',
      })
      await insertActivityTypeDefinition(user, {
        name: 'sprint',
        display_name: 'Sprint',
        display_category: 'exercise',
        parent_type: 'cardio',
      })
      const descendants = await getDescendantTypes(user, 'cardio')
      expect(descendants).toContain('sprint')
      expect(descendants).not.toContain('cardio')
    })

    test('returns empty array for leaf type', async () => {
      const user = getTestUser()
      const descendants = await getDescendantTypes(user, 'running')
      expect(descendants).toEqual([])
    })

    test('exercise parent includes all builtin subtypes', async () => {
      const user = getTestUser()
      const descendants = await getDescendantTypes(user, 'exercise')
      expect(descendants).toContain('running')
      expect(descendants).toContain('yoga')
      expect(descendants.length).toBeGreaterThan(50)
    })
  })

  describe('expandActivityTypes', () => {
    test('includes self and all descendants', async () => {
      const user = getTestUser()
      const expanded = await expandActivityTypes(user, ['exercise'])
      expect(expanded).toContain('exercise')
      expect(expanded).toContain('running')
      expect(expanded).toContain('yoga')
    })

    test('leaf type expands to itself', async () => {
      const user = getTestUser()
      const expanded = await expandActivityTypes(user, ['running'])
      expect(expanded).toEqual(['running'])
    })

    test('multiple types combine without duplicates', async () => {
      const user = getTestUser()
      const expanded = await expandActivityTypes(user, ['sleep', 'meditation'])
      expect(expanded).toContain('sleep')
      expect(expanded).toContain('nap')
      expect(expanded).toContain('rest')
      expect(expanded).toContain('meditation')
      expect(new Set(expanded).size).toBe(expanded.length)
    })

    test('unknown type returns empty', async () => {
      const user = getTestUser()
      const expanded = await expandActivityTypes(user, ['nonexistent'])
      expect(expanded).toEqual([])
    })
  })

  describe('deleteActivityTypeDefinition reparents children', () => {
    test('children of deleted type get parent of the deleted type', async () => {
      const user = getTestUser()
      await insertActivityTypeDefinition(user, {
        name: 'mid_level',
        display_name: 'Mid',
        display_category: 'exercise',
        parent_type: 'exercise',
      })
      await insertActivityTypeDefinition(user, {
        name: 'child_leaf',
        display_name: 'Child',
        display_category: 'exercise',
        parent_type: 'mid_level',
      })
      await deleteActivityTypeDefinition(user, 'mid_level')
      const child = await getActivityTypeDefinition(user, 'child_leaf')
      expect(child?.parent_type).toBe('exercise')
    })

    test('children become top-level if deleted type had no parent', async () => {
      const user = getTestUser()
      await insertActivityTypeDefinition(user, {
        name: 'top',
        display_name: 'Top',
        display_category: 'other',
      })
      await insertActivityTypeDefinition(user, {
        name: 'child',
        display_name: 'Child',
        display_category: 'other',
        parent_type: 'top',
      })
      await deleteActivityTypeDefinition(user, 'top')
      const child = await getActivityTypeDefinition(user, 'child')
      expect(child?.parent_type).toBeUndefined()
    })
  })

  describe('mergeActivityTypeDefinition reparents children', () => {
    test('children of source become children of target', async () => {
      const user = getTestUser()
      await insertActivityTypeDefinition(user, {
        name: 'parent_a',
        display_name: 'A',
        display_category: 'other',
      })
      await insertActivityTypeDefinition(user, {
        name: 'parent_b',
        display_name: 'B',
        display_category: 'other',
      })
      await insertActivityTypeDefinition(user, {
        name: 'leaf_x',
        display_name: 'X',
        display_category: 'other',
        parent_type: 'parent_a',
      })
      await mergeActivityTypeDefinition(user, 'parent_a', 'parent_b')
      const leaf = await getActivityTypeDefinition(user, 'leaf_x')
      expect(leaf?.parent_type).toBe('parent_b')
    })
  })

  describe('rename with FK cascade', () => {
    test('renaming a parent updates children parent_type via CASCADE', async () => {
      const user = getTestUser()
      await insertActivityTypeDefinition(user, {
        name: 'old_parent',
        display_name: 'Old',
        display_category: 'other',
      })
      await insertActivityTypeDefinition(user, {
        name: 'a_child',
        display_name: 'Child',
        display_category: 'other',
        parent_type: 'old_parent',
      })
      await query(user, `UPDATE activity_type_definitions SET name = 'new_parent' WHERE name = 'old_parent'`)
      const child = await getActivityTypeDefinition(user, 'a_child')
      expect(child?.parent_type).toBe('new_parent')
    })
  })
})
