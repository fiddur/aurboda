/**
 * Productivity database integration tests using testcontainers.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import {
  batchUpdateResolvedCategory,
  deleteProductivityRecord,
  getAllProductivityForCategorization,
  getProductivity,
  insertProductivity,
  restoreProductivityRecord,
} from '../db'
import type { ProductivityRecord } from '../db/types'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper'

const CONTAINER_TIMEOUT = 60_000

const makeRecord = (
  partial: Partial<ProductivityRecord> & Pick<ProductivityRecord, 'activity'>,
): ProductivityRecord => ({
  device_name: '',
  duration_sec: 300,
  end_time: new Date('2024-01-15T10:05:00Z'),
  source: 'activitywatch' as const,
  start_time: new Date('2024-01-15T10:00:00Z'),
  ...partial,
})

describe('Productivity Integration Tests', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  // ==========================================================================
  // insertProductivity
  // ==========================================================================

  describe('insertProductivity', () => {
    test('inserts records and retrieves them', async () => {
      const user = getTestUser()
      await insertProductivity(user, [makeRecord({ activity: 'vscode', title: 'main.ts — myproject' })])

      const records = await getProductivity(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )
      expect(records).toHaveLength(1)
      expect(records[0].activity).toBe('vscode')
      expect(records[0].title).toBe('main.ts — myproject')
    })

    test('inserts records with resolved_category as string array', async () => {
      const user = getTestUser()
      await insertProductivity(user, [
        makeRecord({
          activity: 'vscode',
          resolved_category: ['Work', 'Programming'],
        }),
      ])

      const records = await getProductivity(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )
      expect(records).toHaveLength(1)
      expect(records[0].resolved_category).toEqual(['Work', 'Programming'])
    })

    test('inserts records with single-element resolved_category', async () => {
      const user = getTestUser()
      await insertProductivity(user, [
        makeRecord({
          activity: 'netflix',
          resolved_category: ['TV'],
        }),
      ])

      const records = await getProductivity(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )
      expect(records).toHaveLength(1)
      expect(records[0].resolved_category).toEqual(['TV'])
    })

    test('inserts records with no resolved_category', async () => {
      const user = getTestUser()
      await insertProductivity(user, [makeRecord({ activity: 'unknown-app' })])

      const records = await getProductivity(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )
      expect(records).toHaveLength(1)
      expect(records[0].resolved_category).toBeUndefined()
    })

    test('inserts multiple records at once', async () => {
      const user = getTestUser()
      await insertProductivity(user, [
        makeRecord({
          activity: 'vscode',
          end_time: new Date('2024-01-15T10:05:00Z'),
          resolved_category: ['Work', 'Programming'],
          start_time: new Date('2024-01-15T10:00:00Z'),
        }),
        makeRecord({
          activity: 'firefox',
          end_time: new Date('2024-01-15T10:10:00Z'),
          resolved_category: ['Media', 'Social Media'],
          start_time: new Date('2024-01-15T10:05:00Z'),
        }),
        makeRecord({
          activity: 'slack',
          end_time: new Date('2024-01-15T10:15:00Z'),
          start_time: new Date('2024-01-15T10:10:00Z'),
        }),
      ])

      const records = await getProductivity(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )
      expect(records).toHaveLength(3)
      expect(records[0].resolved_category).toEqual(['Work', 'Programming'])
      expect(records[1].resolved_category).toEqual(['Media', 'Social Media'])
      expect(records[2].resolved_category).toBeUndefined()
    })

    test('handles resolved_category with special characters', async () => {
      const user = getTestUser()
      await insertProductivity(user, [
        makeRecord({
          activity: 'test-app',
          resolved_category: ['Category "A"', 'Sub,category'],
        }),
      ])

      const records = await getProductivity(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )
      expect(records).toHaveLength(1)
      expect(records[0].resolved_category).toEqual(['Category "A"', 'Sub,category'])
    })

    test('does nothing for empty array', async () => {
      const user = getTestUser()
      await insertProductivity(user, [])

      const records = await getProductivity(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )
      expect(records).toHaveLength(0)
    })

    test('upserts on conflict', async () => {
      const user = getTestUser()
      await insertProductivity(user, [makeRecord({ activity: 'vscode', title: 'old title' })])
      await insertProductivity(user, [
        makeRecord({
          activity: 'vscode',
          resolved_category: ['Work'],
          title: 'new title',
        }),
      ])

      const records = await getProductivity(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )
      expect(records).toHaveLength(1)
      expect(records[0].title).toBe('new title')
      expect(records[0].resolved_category).toEqual(['Work'])
    })
  })

  // ==========================================================================
  // batchUpdateResolvedCategory
  // ==========================================================================

  describe('batchUpdateResolvedCategory', () => {
    test('updates resolved_category for existing records', async () => {
      const user = getTestUser()
      await insertProductivity(user, [makeRecord({ activity: 'vscode' })])

      const all = await getAllProductivityForCategorization(user)
      expect(all).toHaveLength(1)

      await batchUpdateResolvedCategory(user, [{ id: all[0].id, resolved_category: ['Work', 'Programming'] }])

      const records = await getProductivity(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )
      expect(records[0].resolved_category).toEqual(['Work', 'Programming'])
    })

    test('updates single-element category (the original bug case)', async () => {
      const user = getTestUser()
      await insertProductivity(user, [makeRecord({ activity: 'netflix' })])

      const all = await getAllProductivityForCategorization(user)
      await batchUpdateResolvedCategory(user, [{ id: all[0].id, resolved_category: ['TV'] }])

      const records = await getProductivity(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )
      expect(records[0].resolved_category).toEqual(['TV'])
    })

    test('updates deeply nested category path', async () => {
      const user = getTestUser()
      await insertProductivity(user, [makeRecord({ activity: 'aw-watcher' })])

      const all = await getAllProductivityForCategorization(user)
      await batchUpdateResolvedCategory(user, [
        { id: all[0].id, resolved_category: ['Work', 'Programming', 'ActivityWatch'] },
      ])

      const records = await getProductivity(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )
      expect(records[0].resolved_category).toEqual(['Work', 'Programming', 'ActivityWatch'])
    })

    test('sets resolved_category to null', async () => {
      const user = getTestUser()
      await insertProductivity(user, [makeRecord({ activity: 'vscode', resolved_category: ['Work'] })])

      const all = await getAllProductivityForCategorization(user)
      await batchUpdateResolvedCategory(user, [{ id: all[0].id, resolved_category: null }])

      const records = await getProductivity(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )
      expect(records[0].resolved_category).toBeUndefined()
    })

    test('updates multiple records in a batch', async () => {
      const user = getTestUser()
      await insertProductivity(user, [
        makeRecord({
          activity: 'vscode',
          end_time: new Date('2024-01-15T10:05:00Z'),
          start_time: new Date('2024-01-15T10:00:00Z'),
        }),
        makeRecord({
          activity: 'netflix',
          end_time: new Date('2024-01-15T10:10:00Z'),
          start_time: new Date('2024-01-15T10:05:00Z'),
        }),
        makeRecord({
          activity: 'slack',
          end_time: new Date('2024-01-15T10:15:00Z'),
          start_time: new Date('2024-01-15T10:10:00Z'),
        }),
      ])

      const all = await getAllProductivityForCategorization(user)
      expect(all).toHaveLength(3)

      await batchUpdateResolvedCategory(user, [
        { id: all.find((r) => r.activity === 'vscode')!.id, resolved_category: ['Work', 'Programming'] },
        { id: all.find((r) => r.activity === 'netflix')!.id, resolved_category: ['TV'] },
        { id: all.find((r) => r.activity === 'slack')!.id, resolved_category: null },
      ])

      const records = await getProductivity(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )
      const byActivity = Object.fromEntries(records.map((r) => [r.activity, r]))
      expect(byActivity['vscode'].resolved_category).toEqual(['Work', 'Programming'])
      expect(byActivity['netflix'].resolved_category).toEqual(['TV'])
      expect(byActivity['slack'].resolved_category).toBeUndefined()
    })

    test('handles category with spaces in name', async () => {
      const user = getTestUser()
      await insertProductivity(user, [makeRecord({ activity: 'reddit' })])

      const all = await getAllProductivityForCategorization(user)
      await batchUpdateResolvedCategory(user, [
        { id: all[0].id, resolved_category: ['Media', 'Social Media'] },
      ])

      const records = await getProductivity(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )
      expect(records[0].resolved_category).toEqual(['Media', 'Social Media'])
    })

    test('does nothing for empty updates array', async () => {
      const user = getTestUser()
      await batchUpdateResolvedCategory(user, [])
      // Should not throw
    })
  })

  // ==========================================================================
  // getAllProductivityForCategorization
  // ==========================================================================

  describe('getAllProductivityForCategorization', () => {
    test('returns only id, activity, and title', async () => {
      const user = getTestUser()
      await insertProductivity(user, [makeRecord({ activity: 'vscode', title: 'main.ts' })])

      const records = await getAllProductivityForCategorization(user)
      expect(records).toHaveLength(1)
      expect(records[0]).toHaveProperty('id')
      expect(records[0]).toHaveProperty('activity', 'vscode')
      expect(records[0]).toHaveProperty('title', 'main.ts')
    })

    test('excludes soft-deleted records', async () => {
      const user = getTestUser()
      await insertProductivity(user, [makeRecord({ activity: 'vscode' })])

      const all = await getProductivity(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )
      await deleteProductivityRecord(user, all[0].id!)

      const forCategorization = await getAllProductivityForCategorization(user)
      expect(forCategorization).toHaveLength(0)
    })
  })

  // ==========================================================================
  // deleteProductivityRecord / restoreProductivityRecord
  // ==========================================================================

  describe('deleteProductivityRecord', () => {
    test('soft-deletes a record', async () => {
      const user = getTestUser()
      await insertProductivity(user, [makeRecord({ activity: 'vscode' })])

      const records = await getProductivity(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )
      const deleted = await deleteProductivityRecord(user, records[0].id!)
      expect(deleted).toBe(true)

      const after = await getProductivity(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )
      expect(after).toHaveLength(0)
    })

    test('returns false for non-existent id', async () => {
      const user = getTestUser()
      const result = await deleteProductivityRecord(user, '00000000-0000-0000-0000-000000000000')
      expect(result).toBe(false)
    })
  })

  describe('restoreProductivityRecord', () => {
    test('restores a soft-deleted record', async () => {
      const user = getTestUser()
      await insertProductivity(user, [makeRecord({ activity: 'vscode' })])

      const records = await getProductivity(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )
      await deleteProductivityRecord(user, records[0].id!)
      const restored = await restoreProductivityRecord(user, records[0].id!)
      expect(restored).toBe(true)

      const after = await getProductivity(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )
      expect(after).toHaveLength(1)
    })

    test('returns false for non-deleted record', async () => {
      const user = getTestUser()
      await insertProductivity(user, [makeRecord({ activity: 'vscode' })])

      const records = await getProductivity(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )
      const result = await restoreProductivityRecord(user, records[0].id!)
      expect(result).toBe(false)
    })
  })
})
