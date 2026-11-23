import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { getOverrideForActivity } from '../db/activities/index.ts'
import { query } from '../db/connection.ts'
import { ackOutboundSync, getPendingOutboundSync } from '../db/outbound-sync.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  addCheckInForm,
  checkInDeps,
  deleteCheckInById,
  restoreCheckInById,
  submitCheckIn,
  updateCheckInById,
} from './check-ins.ts'
import { updateActivity } from './mutations.ts'

const CONTAINER_TIMEOUT = 120_000

const unwrap = <T>(outcome: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!outcome.ok) throw new Error(outcome.error)
  return outcome.value
}

const deletedAt = async (user: string, id: string): Promise<Date | null> =>
  (await query<{ deleted_at: Date | null }>(user, 'SELECT deleted_at FROM activities WHERE id = $1', [id]))
    .rows[0]!.deleted_at

describe('check-ins against the database (integration)', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  const addForm = async (user: string, mutated: unknown[] = []) => {
    const deps = { ...checkInDeps, activityMutated: (...args: unknown[]) => void mutated.push(args) }
    const form = unwrap(
      await addCheckInForm(deps, user, {
        name: 'Morning',
        notify: false,
        questions: [
          {
            key: 'vitamin_d',
            logs_to: {
              activity_type: 'supplement',
              answer_field: 'dose',
              fields: { dose_unit: 'µg', substance: 'vitamin D' },
            },
            min: 0,
            prompt: 'Vitamin D',
            required: false,
            type: 'number',
            unit: 'µg',
          },
          {
            key: 'weight',
            logs_to: { metric: 'weight' },
            prompt: 'Weight',
            required: false,
            type: 'number',
            unit: 'kg',
          },
        ],
      }),
    )
    return { deps, form }
  }

  test('a Timeline edit of a logged activity goes and comes back with the check-in', async () => {
    const user = getTestUser()
    const mutated: unknown[] = []
    const { deps, form } = await addForm(user, mutated)
    const checkIn = unwrap(
      await submitCheckIn(deps, user, {
        answered_at: '2026-11-20T07:00:00.000Z',
        answers: { vitamin_d: 50 },
        form_id: form.id,
      }),
    )
    const activityId = checkIn.activities.vitamin_d!.activity_id
    expect(mutated).toHaveLength(1)
    const edited = await updateActivity(user, activityId, { title: 'Vitamin D, with breakfast' })
    expect(edited.success).toBe(true)
    const override = await getOverrideForActivity(user, activityId)
    expect(override?.id).toBe(edited.id)

    await deleteCheckInById(deps, user, checkIn.id)
    expect(await deletedAt(user, activityId)).not.toBeNull()
    expect(await deletedAt(user, override!.id!)).not.toBeNull()

    unwrap(await restoreCheckInById(deps, user, checkIn.id))
    expect(await deletedAt(user, activityId)).toBeNull()
    expect(await deletedAt(user, override!.id!)).toBeNull()
    expect(mutated.length).toBeGreaterThanOrEqual(5)

    unwrap(await updateCheckInById(deps, user, checkIn.id, { answers: { vitamin_d: 25 } }))
    expect(await deletedAt(user, override!.id!)).not.toBeNull()
  })

  test('an override deleted on its own before the check-in stays deleted on restore', async () => {
    const user = getTestUser()
    const { deps, form } = await addForm(user)
    const checkIn = unwrap(
      await submitCheckIn(deps, user, {
        answered_at: '2026-11-20T07:00:00.000Z',
        answers: { vitamin_d: 50 },
        form_id: form.id,
      }),
    )
    const activityId = checkIn.activities.vitamin_d!.activity_id
    const edited = await updateActivity(user, activityId, { title: 'Edited' })
    await query(user, `UPDATE activities SET deleted_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, [
      edited.id,
    ])
    await deleteCheckInById(deps, user, checkIn.id)
    unwrap(await restoreCheckInById(deps, user, checkIn.id))
    expect(await deletedAt(user, activityId)).toBeNull()
    expect(await deletedAt(user, edited.id!)).not.toBeNull()
  })

  test('a logged point of a Health Connect metric is queued for outbound sync', async () => {
    const user = getTestUser()
    const { deps, form } = await addForm(user)
    unwrap(
      await submitCheckIn(deps, user, {
        answered_at: '2026-11-20T07:00:00.000Z',
        answers: { weight: 72.5 },
        form_id: form.id,
      }),
    )
    expect((await getPendingOutboundSync(user)).entries).toMatchObject([
      {
        entity_id: 'weight|2026-11-20T07:00:00.000Z',
        entity_type: 'time_series',
        operation: 'insert',
        payload: { metric: 'weight', time: '2026-11-20T07:00:00.000Z', unit: 'kg', value: 72.5 },
      },
    ])
  })
  describe('Health Connect hears of edits and deletes', () => {
    const at7 = '2026-11-20T07:00:00.000Z'
    const submitWeight = async (user: string) => {
      const { deps, form } = await addForm(user)
      const checkIn = unwrap(
        await submitCheckIn(deps, user, { answered_at: at7, answers: { weight: 72.5 }, form_id: form.id }),
      )
      return { checkIn, deps }
    }
    const ackAll = async (user: string, recordId?: string) => {
      for (const entry of (await getPendingOutboundSync(user)).entries) {
        await ackOutboundSync(user, entry.id, recordId)
      }
    }
    const pending = async (user: string) =>
      (await getPendingOutboundSync(user)).entries.map(({ entity_id, operation, payload }) => ({
        entity_id,
        operation,
        payload,
      }))

    test('deleting a check-in whose point reached the phone queues its delete', async () => {
      const user = getTestUser()
      const { checkIn, deps } = await submitWeight(user)
      await ackAll(user, 'hc-weight')
      await deleteCheckInById(deps, user, checkIn.id)
      expect(await pending(user)).toEqual([
        { entity_id: `weight|${at7}`, operation: 'delete', payload: { hc_record_id: 'hc-weight' } },
      ])
    })

    test('deleting one whose point never reached the phone leaves nothing queued', async () => {
      const user = getTestUser()
      const { checkIn, deps } = await submitWeight(user)
      await deleteCheckInById(deps, user, checkIn.id)
      expect(await pending(user)).toEqual([])
    })

    test('restoring it queues the insert again in place of the delete', async () => {
      const user = getTestUser()
      const { checkIn, deps } = await submitWeight(user)
      await ackAll(user, 'hc-weight')
      await deleteCheckInById(deps, user, checkIn.id)
      unwrap(await restoreCheckInById(deps, user, checkIn.id))
      expect(await pending(user)).toMatchObject([{ entity_id: `weight|${at7}`, operation: 'insert' }])

      await ackAll(user)
      await deleteCheckInById(deps, user, checkIn.id)
      unwrap(await restoreCheckInById(deps, user, checkIn.id))
      expect(await pending(user)).toMatchObject([{ entity_id: `weight|${at7}`, operation: 'insert' }])
    })

    test('an edit at the same time rewrites the point; one at another time deletes the old', async () => {
      const user = getTestUser()
      const { checkIn, deps } = await submitWeight(user)
      await ackAll(user, 'hc-weight')

      unwrap(await updateCheckInById(deps, user, checkIn.id, { answers: { weight: 73 } }))
      expect(await pending(user)).toMatchObject([
        { entity_id: `weight|${at7}`, operation: 'insert', payload: { value: 73 } },
      ])
      await ackAll(user, 'hc-weight')

      unwrap(await updateCheckInById(deps, user, checkIn.id, { answered_at: '2026-11-20T07:30:00.000Z' }))
      expect(await pending(user)).toEqual(
        expect.arrayContaining([
          { entity_id: `weight|${at7}`, operation: 'delete', payload: { hc_record_id: 'hc-weight' } },
          expect.objectContaining({ entity_id: 'weight|2026-11-20T07:30:00.000Z', operation: 'insert' }),
        ]),
      )
      expect(await pending(user)).toHaveLength(2)
    })
  })
})
