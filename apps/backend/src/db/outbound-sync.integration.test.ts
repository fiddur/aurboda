import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper'
import {
  ackOutboundSync,
  enqueueOutboundSync,
  failOutboundSync,
  findHcRecordId,
  getPendingOutboundSync,
} from './outbound-sync'

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
        payload: { activity_type: 'exercise', start_time: '2024-01-15T10:00:00Z' },
      })

      expect(id).toBeDefined()
      expect(typeof id).toBe('string')

      const pending = await getPendingOutboundSync(user)
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

      const pending = await getPendingOutboundSync(user)
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

      const pending = await getPendingOutboundSync(user)
      expect(pending).toHaveLength(1)
      expect(pending[0].operation).toBe('delete')
    })
  })

  describe('getPendingOutboundSync', () => {
    test('returns entries ordered by creation time', async () => {
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
        entity_type: 'time_series',
        hc_record_type: 'WeightRecord',
        operation: 'insert',
        payload: {},
      })

      const pending = await getPendingOutboundSync(user)
      expect(pending).toHaveLength(2)
      expect(pending[0].entity_id).toBe('first')
      expect(pending[1].entity_id).toBe('second')
    })

    test('respects limit', async () => {
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

      const pending = await getPendingOutboundSync(user, 3)
      expect(pending).toHaveLength(3)
    })

    test('returns empty array when no pending entries', async () => {
      const user = getTestUser()
      const pending = await getPendingOutboundSync(user)
      expect(pending).toHaveLength(0)
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
      const pending = await getPendingOutboundSync(user)
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
      const pending = await getPendingOutboundSync(user)
      expect(pending).toHaveLength(0)
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
