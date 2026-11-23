import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { query } from './connection.ts'
import {
  ackOutboundSync,
  enqueueOutboundSync,
  enqueueOutboundSyncDeletes,
  enqueueOutboundSyncInsertsIfChanged,
  failOutboundSync,
  findHcRecordId,
  getOutboundSyncHistory,
  getPendingOutboundSync,
  pruneSyncedOutboundSync,
  reportSyncFailure,
  requeueOutboundSync,
} from './outbound-sync.ts'

const CONTAINER_TIMEOUT = 120_000

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

    test('coalesces repeated inserts for the same entity (no duplicate flood)', async () => {
      const user = getTestUser()

      // Simulate the calorie-recompute path enqueueing the same per-minute
      // insert many times — only the latest payload should remain pending.
      const firstId = await enqueueOutboundSync(user, {
        entity_id: 'calories_active|2026-05-19T10:00:00.000Z',
        entity_type: 'time_series',
        hc_record_type: 'ActiveCaloriesBurnedRecord',
        operation: 'insert',
        payload: { value: 1.2 },
      })
      const secondId = await enqueueOutboundSync(user, {
        entity_id: 'calories_active|2026-05-19T10:00:00.000Z',
        entity_type: 'time_series',
        hc_record_type: 'ActiveCaloriesBurnedRecord',
        operation: 'insert',
        payload: { value: 1.5 },
      })
      const thirdId = await enqueueOutboundSync(user, {
        entity_id: 'calories_active|2026-05-19T10:00:00.000Z',
        entity_type: 'time_series',
        hc_record_type: 'ActiveCaloriesBurnedRecord',
        operation: 'insert',
        payload: { value: 1.7 },
      })

      // All three calls should return the same row id — payload updates in place
      expect(secondId).toBe(firstId)
      expect(thirdId).toBe(firstId)

      const { entries: pending } = await getPendingOutboundSync(user)
      expect(pending).toHaveLength(1)
      expect(pending[0].id).toBe(firstId)
      expect((pending[0].payload as { value: number }).value).toBe(1.7)
    })
  })

  describe('enqueueOutboundSyncInsertsIfChanged', () => {
    const minute = (iso: string, value: number) => ({
      entity_id: `calories_active|${iso}`,
      payload: { end_time: iso.replace(':00.000Z', ':59.000Z'), metric: 'calories_active', value },
    })
    const enqueue = (user: string, items: ReturnType<typeof minute>[]) =>
      enqueueOutboundSyncInsertsIfChanged(user, 'time_series', 'ActiveCaloriesBurnedRecord', items)
    const countRows = async (user: string) =>
      (await query(user, `SELECT COUNT(*)::int AS n FROM outbound_sync_queue`, [])).rows[0].n as number
    const ackAll = async (user: string) => {
      const { entries } = await getPendingOutboundSync(user)
      for (const entry of entries) await ackOutboundSync(user, entry.id, `hc-${entry.entity_id}`)
    }

    test('does not re-queue minutes already synced with the same value', async () => {
      const user = getTestUser()
      const points = [minute('2026-10-01T10:00:00.000Z', 1.5), minute('2026-10-01T10:01:00.000Z', 2)]

      expect(await enqueue(user, points)).toBe(2)
      await ackAll(user)
      expect(await enqueue(user, points)).toBe(0)
      expect(
        await enqueue(user, [
          minute('2026-10-01T10:00:00.000Z', 1.5),
          minute('2026-10-01T10:01:00.000Z', 2.0),
        ]),
      ).toBe(0)

      expect(await countRows(user)).toBe(2)
      expect((await getPendingOutboundSync(user)).total_pending).toBe(0)
    })

    test('queues one new row for a synced minute whose value changed', async () => {
      const user = getTestUser()
      await enqueue(user, [minute('2026-10-01T10:00:00.000Z', 1.5), minute('2026-10-01T10:01:00.000Z', 2)])
      await ackAll(user)

      expect(
        await enqueue(user, [
          minute('2026-10-01T10:00:00.000Z', 1.75),
          minute('2026-10-01T10:01:00.000Z', 2),
        ]),
      ).toBe(1)

      const { entries } = await getPendingOutboundSync(user)
      expect(entries).toHaveLength(1)
      expect(entries[0].entity_id).toBe('calories_active|2026-10-01T10:00:00.000Z')
      expect(entries[0].payload.value).toBe(1.75)
      expect(await countRows(user)).toBe(3)
    })

    test('updates a pending insert in place and skips an identical one', async () => {
      const user = getTestUser()
      await enqueue(user, [minute('2026-10-01T10:00:00.000Z', 1.5)])

      expect(await enqueue(user, [minute('2026-10-01T10:00:00.000Z', 1.5)])).toBe(0)
      expect(await enqueue(user, [minute('2026-10-01T10:00:00.000Z', 3)])).toBe(1)

      const { entries } = await getPendingOutboundSync(user)
      expect(entries).toHaveLength(1)
      expect(entries[0].payload.value).toBe(3)
      expect(await countRows(user)).toBe(1)
    })

    test('re-queues a minute whose latest row failed', async () => {
      const user = getTestUser()
      await enqueue(user, [minute('2026-10-01T10:00:00.000Z', 1.5)])
      const { entries } = await getPendingOutboundSync(user)
      await failOutboundSync(user, entries[0].id)

      expect(await enqueue(user, [minute('2026-10-01T10:00:00.000Z', 1.5)])).toBe(1)
      expect((await getPendingOutboundSync(user)).total_pending).toBe(1)
    })
  })

  describe('enqueueOutboundSyncDeletes', () => {
    const weight = (iso: string) => `weight|${iso}`
    const insertPoint = (user: string, iso: string, value = 80) =>
      enqueueOutboundSync(user, {
        entity_id: weight(iso),
        entity_type: 'time_series',
        hc_record_type: 'WeightRecord',
        operation: 'insert',
        payload: { metric: 'weight', time: iso, unit: 'kg', value },
      })
    const forget = (user: string, isos: string[]) =>
      enqueueOutboundSyncDeletes(
        user,
        'time_series',
        isos.map((iso) => ({ entity_id: weight(iso), hc_record_type: 'WeightRecord' })),
      )
    const rows = async (user: string) =>
      (
        await query(
          user,
          `SELECT entity_id, operation, status, payload, hc_record_type FROM outbound_sync_queue
           ORDER BY created_at, operation`,
          [],
        )
      ).rows
    const T1 = '2026-11-01T08:00:00.000Z'
    const T2 = '2026-11-02T08:00:00.000Z'

    test('queues a delete carrying the record id of a synced insert', async () => {
      const user = getTestUser()
      await ackOutboundSync(user, await insertPoint(user, T1), 'hc-1')

      expect(await forget(user, [T1])).toEqual({ cancelled: 0, deleted: 1 })

      const { entries } = await getPendingOutboundSync(user)
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        entity_id: weight(T1),
        hc_record_type: 'WeightRecord',
        operation: 'delete',
        payload: { hc_record_id: 'hc-1' },
      })
    })

    test('drops a pending insert and queues no delete', async () => {
      const user = getTestUser()
      await insertPoint(user, T1)

      expect(await forget(user, [T1])).toEqual({ cancelled: 1, deleted: 0 })
      expect(await rows(user)).toHaveLength(0)
    })

    test('drops a pending re-write and deletes the record already written', async () => {
      const user = getTestUser()
      await ackOutboundSync(user, await insertPoint(user, T1), 'hc-1')
      await insertPoint(user, T1, 81)

      expect(await forget(user, [T1])).toEqual({ cancelled: 1, deleted: 1 })
      const { entries } = await getPendingOutboundSync(user)
      expect(entries.map((entry) => [entry.operation, entry.payload])).toEqual([
        ['delete', { hc_record_id: 'hc-1' }],
      ])
    })

    test('does nothing for an entity with no queue entry', async () => {
      const user = getTestUser()
      expect(await forget(user, [T1])).toEqual({ cancelled: 0, deleted: 0 })
      expect(await rows(user)).toHaveLength(0)
    })

    test('does nothing for an insert the phone acked without a record', async () => {
      const user = getTestUser()
      await ackOutboundSync(user, await insertPoint(user, T1))
      expect(await forget(user, [T1])).toEqual({ cancelled: 0, deleted: 0 })
    })

    test('queues no second delete for a record being or already deleted', async () => {
      const user = getTestUser()
      await ackOutboundSync(user, await insertPoint(user, T1), 'hc-1')
      await forget(user, [T1])

      expect(await forget(user, [T1])).toEqual({ cancelled: 0, deleted: 0 })

      const { entries } = await getPendingOutboundSync(user)
      await ackOutboundSync(user, entries[0].id)
      expect(await forget(user, [T1])).toEqual({ cancelled: 0, deleted: 0 })
    })

    test('handles many points in one call', async () => {
      const user = getTestUser()
      const isos = Array.from({ length: 500 }, (_, i) => new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString())
      await enqueueOutboundSyncInsertsIfChanged(
        user,
        'time_series',
        'WeightRecord',
        isos.map((iso) => ({ entity_id: weight(iso), payload: { time: iso, value: 80 } })),
      )
      const { entries } = await getPendingOutboundSync(user, 1000)
      for (const entry of entries.slice(0, 300)) {
        await ackOutboundSync(user, entry.id, `hc-${entry.entity_id}`)
      }

      expect(await forget(user, [...isos, T1])).toEqual({ cancelled: 200, deleted: 300 })
      const pending = await getPendingOutboundSync(user, 1000)
      expect(pending.total_pending).toBe(300)
      expect(pending.entries.every((entry) => entry.operation === 'delete')).toBe(true)
      expect(pending.entries.every((entry) => entry.payload.hc_record_id === `hc-${entry.entity_id}`)).toBe(
        true,
      )
    })

    test('a re-insert after a synced delete is queued again', async () => {
      const user = getTestUser()
      await ackOutboundSync(user, await insertPoint(user, T1), 'hc-1')
      await forget(user, [T1])
      const { entries } = await getPendingOutboundSync(user)
      await ackOutboundSync(user, entries[0].id)

      await insertPoint(user, T1)
      const after = await getPendingOutboundSync(user)
      expect(after.entries.map((entry) => entry.operation)).toEqual(['insert'])

      await ackOutboundSync(user, after.entries[0].id, 'hc-2')
      expect(await forget(user, [T1])).toEqual({ cancelled: 0, deleted: 1 })
      expect((await getPendingOutboundSync(user)).entries[0].payload).toEqual({ hc_record_id: 'hc-2' })
    })

    test('a bulk re-insert after a synced delete is not taken for already synced', async () => {
      const user = getTestUser()
      const item = { entity_id: weight(T1), payload: { time: T1, value: 80 } }
      await enqueueOutboundSyncInsertsIfChanged(user, 'time_series', 'WeightRecord', [item])
      const first = await getPendingOutboundSync(user)
      await ackOutboundSync(user, first.entries[0].id, 'hc-1')
      await forget(user, [T1])
      const del = await getPendingOutboundSync(user)
      await ackOutboundSync(user, del.entries[0].id)

      expect(await enqueueOutboundSyncInsertsIfChanged(user, 'time_series', 'WeightRecord', [item])).toBe(1)
    })

    test('a re-insert drops a pending delete of the same point', async () => {
      const user = getTestUser()
      await ackOutboundSync(user, await insertPoint(user, T1), 'hc-1')
      await forget(user, [T1, T2])

      await insertPoint(user, T1, 82)
      const { entries } = await getPendingOutboundSync(user)
      expect(entries.map((entry) => [entry.operation, entry.payload.value])).toEqual([['insert', 82]])

      await ackOutboundSync(user, entries[0].id, 'hc-1')
      expect(await forget(user, [T1])).toEqual({ cancelled: 0, deleted: 1 })
    })
  })

  describe('pruneSyncedOutboundSync', () => {
    const insertRow = async (
      user: string,
      row: {
        entity_type: string
        entity_id: string
        status: string
        age_days: number
        hc_record_id?: string
      },
    ) => {
      await query(
        user,
        `INSERT INTO outbound_sync_queue
           (entity_type, entity_id, operation, hc_record_type, payload, status, hc_record_id, created_at, synced_at)
         VALUES ($1, $2, 'insert', 'ActiveCaloriesBurnedRecord', '{}', $3::text, $4,
                 NOW() - INTERVAL '1 day' * $5,
                 CASE WHEN $3::text = 'synced' THEN NOW() - INTERVAL '1 day' * $5 END)`,
        [row.entity_type, row.entity_id, row.status, row.hc_record_id ?? null, row.age_days],
      )
    }
    const remaining = async (user: string) =>
      (
        await query(
          user,
          `SELECT entity_id, status, hc_record_id FROM outbound_sync_queue ORDER BY entity_id, created_at`,
          [],
        )
      ).rows.map((row) => `${row.entity_id}:${row.status}:${row.hc_record_id ?? '-'}`)

    test('deletes only synced rows older than the retention', async () => {
      const user = getTestUser()
      await insertRow(user, {
        age_days: 20,
        entity_id: 'a-old-synced',
        entity_type: 'time_series',
        hc_record_id: 'hc-1',
        status: 'synced',
      })
      await insertRow(user, {
        age_days: 5,
        entity_id: 'b-recent-synced',
        entity_type: 'time_series',
        status: 'synced',
      })
      await insertRow(user, {
        age_days: 20,
        entity_id: 'c-old-pending',
        entity_type: 'time_series',
        status: 'pending',
      })
      await insertRow(user, {
        age_days: 20,
        entity_id: 'd-old-failed',
        entity_type: 'time_series',
        status: 'failed',
      })

      expect(await pruneSyncedOutboundSync(user, 14)).toBe(1)
      expect(await remaining(user)).toEqual([
        'b-recent-synced:synced:-',
        'c-old-pending:pending:-',
        'd-old-failed:failed:-',
      ])
    })

    test("keeps an activity's newest HC record id however old, so it can still be deleted in Health Connect", async () => {
      const user = getTestUser()
      await insertRow(user, {
        age_days: 40,
        entity_id: 'act-1',
        entity_type: 'activity',
        hc_record_id: 'hc-old',
        status: 'synced',
      })
      await insertRow(user, {
        age_days: 30,
        entity_id: 'act-1',
        entity_type: 'activity',
        hc_record_id: 'hc-new',
        status: 'synced',
      })
      await insertRow(user, { age_days: 30, entity_id: 'act-2', entity_type: 'activity', status: 'synced' })

      expect(await pruneSyncedOutboundSync(user, 14)).toBe(2)
      expect(await remaining(user)).toEqual(['act-1:synced:hc-new'])
      expect(await findHcRecordId(user, 'activity', 'act-1')).toBe('hc-new')
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

      const result = await reportSyncFailure(user, id, 'Final failure')
      expect(result.fail_count).toBe(5)
      expect(result.retrying).toBe(false)

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

      const { entries: before } = await getPendingOutboundSync(user)
      expect(before).toHaveLength(0)

      const ok = await requeueOutboundSync(user, id)
      expect(ok).toBe(true)

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
