import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { query } from './connection.ts'
import {
  ackOutboundSync,
  enqueueOutboundSync,
  failOutboundSync,
  findHcRecordId,
  getOutboundSyncHistory,
  getPendingOutboundSync,
  reportSyncFailure,
  requeueOutboundSync,
} from './outbound-sync.ts'

const CONTAINER_TIMEOUT = 60_000

describe('Outbound Sync Queue Integration Tests', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  describe('enqueueOutboundSync', () => {
    test('enqueues an insert entry', async () => {
      const user = getTestUser()

      const id = await enqueueOutboundSync(user, {
        entity_id: 'activity-123',
        entity_type: 'activity',
        hc_record_type: 'ExerciseSessionRecord',
        operation: 'insert',
        payload: {
          activity_type: 'exercise',
          start_time: '2024-01-15T10:00:00Z',
        },
      })

      expect(id).toBeDefined()
      expect(typeof id).toBe('string')

      const { entries: pending } = await getPendingOutboundSync(user)
      expect(pending).toHaveLength(1)
      expect(pending[0].entity_id).toBe('activity-123')
      expect(pending[0].operation).toBe('insert')
      expect(pending[0].status).toBe('pending')
      expect(pending[0].hc_record_id).toBeUndefined()
    })

    test('supersedes pending entries on update', async () => {
      const user = getTestUser()

      await enqueueOutboundSync(user, {
        entity_id: 'activity-123',
        entity_type: 'activity',
        hc_record_type: 'ExerciseSessionRecord',
        operation: 'insert',
        payload: { start_time: '2024-01-15T10:00:00Z' },
      })

      // Now update the same entity - should supersede the insert
      await enqueueOutboundSync(user, {
        entity_id: 'activity-123',
        entity_type: 'activity',
        hc_record_type: 'ExerciseSessionRecord',
        operation: 'update',
        payload: { start_time: '2024-01-15T10:30:00Z' },
      })

      const { entries: pending } = await getPendingOutboundSync(user)
      expect(pending).toHaveLength(1)
      expect(pending[0].operation).toBe('update')
    })

    test('supersedes pending entries on delete', async () => {
      const user = getTestUser()

      await enqueueOutboundSync(user, {
        entity_id: 'activity-123',
        entity_type: 'activity',
        hc_record_type: 'ExerciseSessionRecord',
        operation: 'insert',
        payload: { start_time: '2024-01-15T10:00:00Z' },
      })

      await enqueueOutboundSync(user, {
        entity_id: 'activity-123',
        entity_type: 'activity',
        hc_record_type: 'ExerciseSessionRecord',
        operation: 'delete',
        payload: {},
      })

      const { entries: pending } = await getPendingOutboundSync(user)
      expect(pending).toHaveLength(1)
      expect(pending[0].operation).toBe('delete')
    })
  })

  describe('getPendingOutboundSync', () => {
    test('returns entries ordered by priority then newest-first', async () => {
      const user = getTestUser()

      await enqueueOutboundSync(user, {
        entity_id: 'ts-first',
        entity_type: 'time_series',
        hc_record_type: 'WeightRecord',
        operation: 'insert',
        payload: {},
      })

      await enqueueOutboundSync(user, {
        entity_id: 'ts-second',
        entity_type: 'time_series',
        hc_record_type: 'HeightRecord',
        operation: 'insert',
        payload: {},
      })

      await enqueueOutboundSync(user, {
        entity_id: 'activity-first',
        entity_type: 'activity',
        hc_record_type: 'ExerciseSessionRecord',
        operation: 'insert',
        payload: {},
      })

      const { entries: pending } = await getPendingOutboundSync(user)
      expect(pending).toHaveLength(3)
      // Activities are prioritized over time_series
      expect(pending[0].entity_id).toBe('activity-first')
      // Within same entity_type, newest-first
      expect(pending[1].entity_id).toBe('ts-second')
      expect(pending[2].entity_id).toBe('ts-first')
    })

    test('respects limit and returns total_pending', async () => {
      const user = getTestUser()

      for (let i = 0; i < 5; i++) {
        await enqueueOutboundSync(user, {
          entity_id: `item-${i}`,
          entity_type: 'activity',
          hc_record_type: 'ExerciseSessionRecord',
          operation: 'insert',
          payload: {},
        })
      }

      const { entries: pending, total_pending } = await getPendingOutboundSync(user, 3)
      expect(pending).toHaveLength(3)
      expect(total_pending).toBe(5)
    })

    test('returns empty array when no pending entries', async () => {
      const user = getTestUser()
      const { entries: pending, total_pending } = await getPendingOutboundSync(user)
      expect(pending).toHaveLength(0)
      expect(total_pending).toBe(0)
    })

    test('auto-expires entries older than 90 days', async () => {
      const user = getTestUser()

      // Create an entry and backdate it to 91 days ago
      const oldId = await enqueueOutboundSync(user, {
        entity_id: 'old-calorie',
        entity_type: 'time_series',
        hc_record_type: 'ActiveCaloriesBurnedRecord',
        operation: 'insert',
        payload: { value: 5.0 },
      })
      await query(
        user,
        `UPDATE outbound_sync_queue SET created_at = NOW() - INTERVAL '91 days' WHERE id = $1`,
        [oldId],
      )

      // Create a recent entry
      await enqueueOutboundSync(user, {
        entity_id: 'recent-exercise',
        entity_type: 'activity',
        hc_record_type: 'ExerciseSessionRecord',
        operation: 'insert',
        payload: {},
      })

      const { entries: pending } = await getPendingOutboundSync(user)
      // Only the recent entry should be returned; the old one should be auto-expired
      expect(pending).toHaveLength(1)
      expect(pending[0].entity_id).toBe('recent-exercise')
    })

    test('total_pending reflects count after auto-expiry', async () => {
      const user = getTestUser()

      // Create an entry and backdate it to 91 days ago
      const oldId = await enqueueOutboundSync(user, {
        entity_id: 'old-entry',
        entity_type: 'time_series',
        hc_record_type: 'ActiveCaloriesBurnedRecord',
        operation: 'insert',
        payload: { value: 5.0 },
      })
      await query(
        user,
        `UPDATE outbound_sync_queue SET created_at = NOW() - INTERVAL '91 days' WHERE id = $1`,
        [oldId],
      )

      // Create two recent entries
      await enqueueOutboundSync(user, {
        entity_id: 'recent-1',
        entity_type: 'activity',
        hc_record_type: 'ExerciseSessionRecord',
        operation: 'insert',
        payload: {},
      })
      await enqueueOutboundSync(user, {
        entity_id: 'recent-2',
        entity_type: 'activity',
        hc_record_type: 'ExerciseSessionRecord',
        operation: 'insert',
        payload: {},
      })

      const { entries, total_pending } = await getPendingOutboundSync(user, 1)
      // Should only return 1 due to limit, but total_pending should be 2
      // (the old entry was auto-expired)
      expect(entries).toHaveLength(1)
      expect(total_pending).toBe(2)
    })
  })

  describe('ackOutboundSync', () => {
    test('acknowledges entry and stores HC record ID', async () => {
      const user = getTestUser()

      const id = await enqueueOutboundSync(user, {
        entity_id: 'activity-123',
        entity_type: 'activity',
        hc_record_type: 'ExerciseSessionRecord',
        operation: 'insert',
        payload: {},
      })

      const ok = await ackOutboundSync(user, id, 'hc-record-abc')
      expect(ok).toBe(true)

      // Should no longer be in pending
      const { entries: pending } = await getPendingOutboundSync(user)
      expect(pending).toHaveLength(0)
    })

    test('returns false for non-existent entry', async () => {
      const user = getTestUser()
      const ok = await ackOutboundSync(user, '00000000-0000-0000-0000-000000000000')
      expect(ok).toBe(false)
    })

    test('returns false for already-acked entry', async () => {
      const user = getTestUser()

      const id = await enqueueOutboundSync(user, {
        entity_id: 'activity-123',
        entity_type: 'activity',
        hc_record_type: 'ExerciseSessionRecord',
        operation: 'insert',
        payload: {},
      })

      await ackOutboundSync(user, id, 'hc-record-abc')
      const ok = await ackOutboundSync(user, id, 'hc-record-def')
      expect(ok).toBe(false)
    })
  })

  describe('failOutboundSync', () => {
    test('marks entry as failed', async () => {
      const user = getTestUser()

      const id = await enqueueOutboundSync(user, {
        entity_id: 'activity-123',
        entity_type: 'activity',
        hc_record_type: 'ExerciseSessionRecord',
        operation: 'insert',
        payload: {},
      })

      const ok = await failOutboundSync(user, id)
      expect(ok).toBe(true)

      // Should no longer be in pending
      const { entries: pending } = await getPendingOutboundSync(user)
      expect(pending).toHaveLength(0)
    })
  })

  describe('reportSyncFailure', () => {
    test('increments fail_count and keeps entry pending', async () => {
      const user = getTestUser()

      const id = await enqueueOutboundSync(user, {
        entity_id: 'activity-123',
        entity_type: 'activity',
        hc_record_type: 'ExerciseSessionRecord',
        operation: 'insert',
        payload: {},
      })

      const result = await reportSyncFailure(user, id, 'Health Connect unavailable')
      expect(result.fail_count).toBe(1)
      expect(result.retrying).toBe(true)

      // Entry should still be pending
      const { entries: pending } = await getPendingOutboundSync(user)
      expect(pending).toHaveLength(1)
      expect(pending[0].fail_count).toBe(1)
      expect(pending[0].fail_reason).toBe('Health Connect unavailable')
    })

    test('marks entry as failed after MAX_RETRIES', async () => {
      const user = getTestUser()

      const id = await enqueueOutboundSync(user, {
        entity_id: 'activity-123',
        entity_type: 'activity',
        hc_record_type: 'ExerciseSessionRecord',
        operation: 'insert',
        payload: {},
      })

      // Report failures up to the max (5)
      for (let i = 1; i <= 4; i++) {
        const result = await reportSyncFailure(user, id, `Failure ${i}`)
        expect(result.fail_count).toBe(i)
        expect(result.retrying).toBe(true)
      }

      // 5th failure should mark as failed
      const result = await reportSyncFailure(user, id, 'Final failure')
      expect(result.fail_count).toBe(5)
      expect(result.retrying).toBe(false)

      // Entry should no longer be pending
      const { entries: pending } = await getPendingOutboundSync(user)
      expect(pending).toHaveLength(0)
    })

    test('returns zero fail_count for non-existent entry', async () => {
      const user = getTestUser()
      const result = await reportSyncFailure(user, '00000000-0000-0000-0000-000000000000', 'error')
      expect(result.fail_count).toBe(0)
      expect(result.retrying).toBe(false)
    })
  })

  describe('requeueOutboundSync', () => {
    test('resets a failed entry back to pending', async () => {
      const user = getTestUser()

      const id = await enqueueOutboundSync(user, {
        entity_id: 'activity-123',
        entity_type: 'activity',
        hc_record_type: 'ExerciseSessionRecord',
        operation: 'insert',
        payload: {},
      })

      await failOutboundSync(user, id)

      // Should not be pending
      const { entries: before } = await getPendingOutboundSync(user)
      expect(before).toHaveLength(0)

      // Requeue it
      const ok = await requeueOutboundSync(user, id)
      expect(ok).toBe(true)

      // Should be pending again with reset fail_count
      const { entries: after } = await getPendingOutboundSync(user)
      expect(after).toHaveLength(1)
      expect(after[0].fail_count).toBe(0)
      expect(after[0].fail_reason).toBeUndefined()
    })

    test('resets a synced entry back to pending', async () => {
      const user = getTestUser()

      const id = await enqueueOutboundSync(user, {
        entity_id: 'activity-123',
        entity_type: 'activity',
        hc_record_type: 'ExerciseSessionRecord',
        operation: 'insert',
        payload: {},
      })

      await ackOutboundSync(user, id, 'hc-record-abc')

      const ok = await requeueOutboundSync(user, id)
      expect(ok).toBe(true)

      const { entries: pending } = await getPendingOutboundSync(user)
      expect(pending).toHaveLength(1)
      expect(pending[0].status).toBe('pending')
    })

    test('returns false for a pending entry', async () => {
      const user = getTestUser()

      const id = await enqueueOutboundSync(user, {
        entity_id: 'activity-123',
        entity_type: 'activity',
        hc_record_type: 'ExerciseSessionRecord',
        operation: 'insert',
        payload: {},
      })

      const ok = await requeueOutboundSync(user, id)
      expect(ok).toBe(false)
    })
  })

  describe('getOutboundSyncHistory', () => {
    test('returns all entries regardless of status', async () => {
      const user = getTestUser()

      const id1 = await enqueueOutboundSync(user, {
        entity_id: 'activity-1',
        entity_type: 'activity',
        hc_record_type: 'ExerciseSessionRecord',
        operation: 'insert',
        payload: {},
      })
      await ackOutboundSync(user, id1, 'hc-1')

      const id2 = await enqueueOutboundSync(user, {
        entity_id: 'activity-2',
        entity_type: 'activity',
        hc_record_type: 'ExerciseSessionRecord',
        operation: 'insert',
        payload: {},
      })
      await failOutboundSync(user, id2)

      await enqueueOutboundSync(user, {
        entity_id: 'activity-3',
        entity_type: 'activity',
        hc_record_type: 'ExerciseSessionRecord',
        operation: 'insert',
        payload: {},
      })

      const history = await getOutboundSyncHistory(user)
      expect(history).toHaveLength(3)

      const statuses = history.map((e) => e.status)
      expect(statuses).toContain('synced')
      expect(statuses).toContain('failed')
      expect(statuses).toContain('pending')
    })

    test('returns entries ordered newest-first', async () => {
      const user = getTestUser()

      await enqueueOutboundSync(user, {
        entity_id: 'first',
        entity_type: 'activity',
        hc_record_type: 'ExerciseSessionRecord',
        operation: 'insert',
        payload: {},
      })

      await enqueueOutboundSync(user, {
        entity_id: 'second',
        entity_type: 'activity',
        hc_record_type: 'ExerciseSessionRecord',
        operation: 'insert',
        payload: {},
      })

      const history = await getOutboundSyncHistory(user)
      expect(history).toHaveLength(2)
      expect(history[0].entity_id).toBe('second')
      expect(history[1].entity_id).toBe('first')
    })

    test('respects limit parameter', async () => {
      const user = getTestUser()

      for (let i = 0; i < 5; i++) {
        await enqueueOutboundSync(user, {
          entity_id: `item-${i}`,
          entity_type: 'activity',
          hc_record_type: 'ExerciseSessionRecord',
          operation: 'insert',
          payload: {},
        })
      }

      const history = await getOutboundSyncHistory(user, 3)
      expect(history).toHaveLength(3)
    })

    test('includes fail_count and fail_reason', async () => {
      const user = getTestUser()

      const id = await enqueueOutboundSync(user, {
        entity_id: 'activity-fail',
        entity_type: 'activity',
        hc_record_type: 'ExerciseSessionRecord',
        operation: 'insert',
        payload: {},
      })

      await reportSyncFailure(user, id, 'Connection timeout')

      const history = await getOutboundSyncHistory(user)
      expect(history).toHaveLength(1)
      expect(history[0].fail_count).toBe(1)
      expect(history[0].fail_reason).toBe('Connection timeout')
    })
  })

  describe('findHcRecordId', () => {
    test('finds HC record ID for previously synced entity', async () => {
      const user = getTestUser()

      const id = await enqueueOutboundSync(user, {
        entity_id: 'activity-123',
        entity_type: 'activity',
        hc_record_type: 'ExerciseSessionRecord',
        operation: 'insert',
        payload: {},
      })

      await ackOutboundSync(user, id, 'hc-record-xyz')

      const hcId = await findHcRecordId(user, 'activity', 'activity-123')
      expect(hcId).toBe('hc-record-xyz')
    })

    test('returns undefined for entity with no HC record', async () => {
      const user = getTestUser()
      const hcId = await findHcRecordId(user, 'activity', 'nonexistent')
      expect(hcId).toBeUndefined()
    })

    test('returns most recent HC record ID', async () => {
      const user = getTestUser()

      // First sync
      const id1 = await enqueueOutboundSync(user, {
        entity_id: 'activity-123',
        entity_type: 'activity',
        hc_record_type: 'ExerciseSessionRecord',
        operation: 'insert',
        payload: {},
      })
      await ackOutboundSync(user, id1, 'hc-old')

      // Second sync (update)
      const id2 = await enqueueOutboundSync(user, {
        entity_id: 'activity-123',
        entity_type: 'activity',
        hc_record_type: 'ExerciseSessionRecord',
        operation: 'update',
        payload: {},
      })
      await ackOutboundSync(user, id2, 'hc-new')

      const hcId = await findHcRecordId(user, 'activity', 'activity-123')
      expect(hcId).toBe('hc-new')
    })
  })
})
