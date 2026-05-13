/**
 * Screentime categories database integration tests using testcontainers.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import {
  bulkInsertScreentimeCategories,
  deleteAllScreentimeCategories,
  deleteScreentimeCategoryWithChildren,
  getScreentimeCategories,
  getScreentimeCategoryById,
  insertScreentimeCategory,
  moveScreentimeCategory,
  updateScreentimeCategory,
  upsertScreentimeCategory,
} from '../db/index.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'

const CONTAINER_TIMEOUT = 120_000

describe('Screentime Categories Integration Tests', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  describe('insertScreentimeCategory', () => {
    test('inserts a category and returns it with generated id', async () => {
      const user = getTestUser()
      const category = await insertScreentimeCategory(user, {
        color: '#22c55e',
        name: ['Work'],
        rule_regex: 'vscode|GitHub',
        rule_type: 'regex',
        score: 2,
      })

      expect(category.id).toBeTruthy()
      expect(category.name).toEqual(['Work'])
      expect(category.rule_type).toBe('regex')
      expect(category.rule_regex).toBe('vscode|GitHub')
      expect(category.color).toBe('#22c55e')
      expect(category.score).toBe(2)
      expect(category.ignore_case).toBe(true) // default
      expect(category.sort_order).toBe(0)
      expect(category.created_at).toBeInstanceOf(Date)
      expect(category.updated_at).toBeInstanceOf(Date)
    })

    test('inserts a category with no rule', async () => {
      const user = getTestUser()
      const category = await insertScreentimeCategory(user, {
        name: ['Media'],
        rule_type: 'none',
        score: -1,
      })

      expect(category.rule_regex).toBeUndefined()
      expect(category.score).toBe(-1)
    })

    test('inserts a hierarchical category', async () => {
      const user = getTestUser()
      const category = await insertScreentimeCategory(user, {
        name: ['Work', 'Programming', 'ActivityWatch'],
        rule_regex: 'aw-',
        rule_type: 'regex',
      })

      expect(category.name).toEqual(['Work', 'Programming', 'ActivityWatch'])
    })
  })

  describe('getScreentimeCategories', () => {
    test('returns all categories ordered by sort_order', async () => {
      const user = getTestUser()
      await insertScreentimeCategory(user, {
        name: ['Media'],
        rule_type: 'none',
        sort_order: 2,
      })
      await insertScreentimeCategory(user, {
        name: ['Work'],
        rule_type: 'none',
        sort_order: 1,
      })

      const categories = await getScreentimeCategories(user)
      expect(categories).toHaveLength(2)
      expect(categories[0].name).toEqual(['Work'])
      expect(categories[1].name).toEqual(['Media'])
    })

    test('returns empty array when no categories', async () => {
      const user = getTestUser()
      const categories = await getScreentimeCategories(user)
      expect(categories).toEqual([])
    })
  })

  describe('getScreentimeCategoryById', () => {
    test('returns a category by id', async () => {
      const user = getTestUser()
      const inserted = await insertScreentimeCategory(user, {
        name: ['Work'],
        rule_type: 'none',
      })

      const fetched = await getScreentimeCategoryById(user, inserted.id)
      expect(fetched).not.toBeNull()
      expect(fetched!.id).toBe(inserted.id)
      expect(fetched!.name).toEqual(['Work'])
    })

    test('returns null for non-existent id', async () => {
      const user = getTestUser()
      const result = await getScreentimeCategoryById(user, '00000000-0000-0000-0000-000000000000')
      expect(result).toBeNull()
    })
  })

  describe('updateScreentimeCategory', () => {
    test('updates a category name', async () => {
      const user = getTestUser()
      const inserted = await insertScreentimeCategory(user, {
        name: ['Work'],
        rule_type: 'none',
      })

      const updated = await updateScreentimeCategory(user, inserted.id, {
        name: ['Work', 'Engineering'],
      })

      expect(updated).not.toBeNull()
      expect(updated!.name).toEqual(['Work', 'Engineering'])
    })

    test('updates rule_regex and rule_type', async () => {
      const user = getTestUser()
      const inserted = await insertScreentimeCategory(user, {
        name: ['Work'],
        rule_type: 'none',
      })

      const updated = await updateScreentimeCategory(user, inserted.id, {
        rule_regex: 'vscode',
        rule_type: 'regex',
      })

      expect(updated!.rule_type).toBe('regex')
      expect(updated!.rule_regex).toBe('vscode')
    })

    test('updates color and score', async () => {
      const user = getTestUser()
      const inserted = await insertScreentimeCategory(user, {
        name: ['Work'],
        rule_type: 'none',
      })

      const updated = await updateScreentimeCategory(user, inserted.id, {
        color: '#ff0000',
        score: 1,
      })

      expect(updated!.color).toBe('#ff0000')
      expect(updated!.score).toBe(1)
    })

    test('returns null for non-existent id', async () => {
      const user = getTestUser()
      const result = await updateScreentimeCategory(user, '00000000-0000-0000-0000-000000000000', {
        name: ['Updated'],
      })
      expect(result).toBeNull()
    })

    test('returns existing when no fields to update', async () => {
      const user = getTestUser()
      const inserted = await insertScreentimeCategory(user, {
        name: ['Work'],
        rule_type: 'none',
      })

      const result = await updateScreentimeCategory(user, inserted.id, {})
      expect(result).not.toBeNull()
      expect(result!.id).toBe(inserted.id)
    })
  })

  describe('deleteScreentimeCategoryWithChildren', () => {
    test('deletes a single category', async () => {
      const user = getTestUser()
      const inserted = await insertScreentimeCategory(user, {
        name: ['Work'],
        rule_type: 'none',
      })

      const count = await deleteScreentimeCategoryWithChildren(user, inserted.id)
      expect(count).toBe(1)

      const categories = await getScreentimeCategories(user)
      expect(categories).toHaveLength(0)
    })

    test('deletes category and all its children', async () => {
      const user = getTestUser()
      const parent = await insertScreentimeCategory(user, {
        name: ['Work'],
        rule_type: 'none',
      })
      await insertScreentimeCategory(user, {
        name: ['Work', 'Programming'],
        rule_regex: 'vscode',
        rule_type: 'regex',
      })
      await insertScreentimeCategory(user, {
        name: ['Work', 'Programming', 'ActivityWatch'],
        rule_regex: 'aw-',
        rule_type: 'regex',
      })
      await insertScreentimeCategory(user, {
        name: ['Media'],
        rule_type: 'none',
      })

      const count = await deleteScreentimeCategoryWithChildren(user, parent.id)
      expect(count).toBe(3) // Work, Work > Programming, Work > Programming > ActivityWatch

      const remaining = await getScreentimeCategories(user)
      expect(remaining).toHaveLength(1)
      expect(remaining[0].name).toEqual(['Media'])
    })

    test('does not delete siblings', async () => {
      const user = getTestUser()
      await insertScreentimeCategory(user, {
        name: ['Work'],
        rule_type: 'none',
      })
      const child = await insertScreentimeCategory(user, {
        name: ['Work', 'Programming'],
        rule_regex: 'vscode',
        rule_type: 'regex',
      })
      await insertScreentimeCategory(user, {
        name: ['Work', 'Design'],
        rule_regex: 'Figma',
        rule_type: 'regex',
      })

      const count = await deleteScreentimeCategoryWithChildren(user, child.id)
      expect(count).toBe(1) // Only Programming

      const remaining = await getScreentimeCategories(user)
      expect(remaining).toHaveLength(2) // Work, Work > Design
    })

    test('returns 0 for non-existent id', async () => {
      const user = getTestUser()
      const count = await deleteScreentimeCategoryWithChildren(user, '00000000-0000-0000-0000-000000000000')
      expect(count).toBe(0)
    })
  })

  describe('deleteAllScreentimeCategories', () => {
    test('deletes all categories', async () => {
      const user = getTestUser()
      await insertScreentimeCategory(user, { name: ['Work'], rule_type: 'none' })
      await insertScreentimeCategory(user, { name: ['Media'], rule_type: 'none' })

      await deleteAllScreentimeCategories(user)

      const categories = await getScreentimeCategories(user)
      expect(categories).toHaveLength(0)
    })
  })

  describe('bulkInsertScreentimeCategories', () => {
    test('inserts multiple categories at once', async () => {
      const user = getTestUser()
      const result = await bulkInsertScreentimeCategories(user, [
        { name: ['Work'], rule_type: 'none', score: 2, sort_order: 0 },
        {
          name: ['Work', 'Programming'],
          rule_regex: 'vscode',
          rule_type: 'regex',
          sort_order: 1,
        },
        { name: ['Media'], rule_type: 'none', score: -1, sort_order: 2 },
      ])

      expect(result).toHaveLength(3)
      expect(result[0].name).toEqual(['Work'])
      expect(result[1].name).toEqual(['Work', 'Programming'])
      expect(result[2].name).toEqual(['Media'])
    })

    test('returns empty array for empty input', async () => {
      const user = getTestUser()
      const result = await bulkInsertScreentimeCategories(user, [])
      expect(result).toEqual([])
    })

    test('assigns sequential sort_order when not specified', async () => {
      const user = getTestUser()
      const result = await bulkInsertScreentimeCategories(user, [
        { name: ['A'], rule_type: 'none' },
        { name: ['B'], rule_type: 'none' },
        { name: ['C'], rule_type: 'none' },
      ])

      expect(result[0].sort_order).toBe(0)
      expect(result[1].sort_order).toBe(1)
      expect(result[2].sort_order).toBe(2)
    })
  })

  // ========================================================================
  // upsertScreentimeCategory
  // ========================================================================

  describe('upsertScreentimeCategory', () => {
    test('creates a new category with specified UUID', async () => {
      const user = getTestUser()
      const id = '11111111-1111-1111-1111-111111111111'
      const result = await upsertScreentimeCategory(user, id, {
        name: ['Test'],
        rule_type: 'none',
      })

      expect(result.id).toBe(id)
      expect(result.name).toEqual(['Test'])
    })

    test('updates existing category on conflict', async () => {
      const user = getTestUser()
      const created = await insertScreentimeCategory(user, {
        name: ['Original'],
        rule_type: 'none',
      })

      const result = await upsertScreentimeCategory(user, created.id, {
        name: ['Updated'],
        rule_regex: 'test',
        rule_type: 'regex',
      })

      expect(result.id).toBe(created.id)
      expect(result.name).toEqual(['Updated'])
      expect(result.rule_regex).toBe('test')
      expect(result.rule_type).toBe('regex')
    })

    test('preserves exclude_from_screentime flag', async () => {
      const user = getTestUser()
      const id = '22222222-2222-2222-2222-222222222222'
      const result = await upsertScreentimeCategory(user, id, {
        exclude_from_screentime: true,
        name: ['Excluded'],
        rule_type: 'none',
      })

      expect(result.exclude_from_screentime).toBe(true)
    })
  })

  // ========================================================================
  // moveScreentimeCategory
  // ========================================================================

  describe('moveScreentimeCategory', () => {
    test('moves a top-level category under a parent', async () => {
      const user = getTestUser()
      await insertScreentimeCategory(user, { name: ['Work'], rule_type: 'none' })
      const child = await insertScreentimeCategory(user, { name: ['Programming'], rule_type: 'none' })

      const result = await moveScreentimeCategory(user, child.id, ['Work'])
      expect(result.updated).toBe(1)

      const moved = await getScreentimeCategoryById(user, child.id)
      expect(moved!.name).toEqual(['Work', 'Programming'])
    })

    test('moves a child category to top level', async () => {
      const user = getTestUser()
      await insertScreentimeCategory(user, { name: ['Work'], rule_type: 'none' })
      const child = await insertScreentimeCategory(user, {
        name: ['Work', 'Programming'],
        rule_type: 'none',
      })

      const result = await moveScreentimeCategory(user, child.id, null)
      expect(result.updated).toBe(1)

      const moved = await getScreentimeCategoryById(user, child.id)
      expect(moved!.name).toEqual(['Programming'])
    })

    test('cascades to children when moving a parent', async () => {
      const user = getTestUser()
      await insertScreentimeCategory(user, { name: ['Media'], rule_type: 'none' })
      const work = await insertScreentimeCategory(user, { name: ['Work'], rule_type: 'none' })
      const prog = await insertScreentimeCategory(user, {
        name: ['Work', 'Programming'],
        rule_type: 'none',
      })
      const aw = await insertScreentimeCategory(user, {
        name: ['Work', 'Programming', 'ActivityWatch'],
        rule_type: 'none',
      })

      // Move Work under Media
      const result = await moveScreentimeCategory(user, work.id, ['Media'])
      expect(result.updated).toBe(3) // Work + Programming + ActivityWatch

      const movedWork = await getScreentimeCategoryById(user, work.id)
      expect(movedWork!.name).toEqual(['Media', 'Work'])

      const movedProg = await getScreentimeCategoryById(user, prog.id)
      expect(movedProg!.name).toEqual(['Media', 'Work', 'Programming'])

      const movedAw = await getScreentimeCategoryById(user, aw.id)
      expect(movedAw!.name).toEqual(['Media', 'Work', 'Programming', 'ActivityWatch'])
    })

    test('returns 0 updated for non-existent category', async () => {
      const user = getTestUser()
      const result = await moveScreentimeCategory(user, '99999999-9999-9999-9999-999999999999', null)
      expect(result.updated).toBe(0)
    })

    test('moves category with no children', async () => {
      const user = getTestUser()
      await insertScreentimeCategory(user, { name: ['Media'], rule_type: 'none' })
      const cat = await insertScreentimeCategory(user, {
        name: ['Work'],
        rule_type: 'regex',
        rule_regex: 'test',
      })

      const result = await moveScreentimeCategory(user, cat.id, ['Media'])
      expect(result.updated).toBe(1)

      const moved = await getScreentimeCategoryById(user, cat.id)
      expect(moved!.name).toEqual(['Media', 'Work'])
      expect(moved!.rule_regex).toBe('test') // Other fields preserved
    })
  })
})
