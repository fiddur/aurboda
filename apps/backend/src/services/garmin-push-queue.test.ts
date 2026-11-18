import { describe, expect, test, vi } from 'vitest'

import type { GarminPushJob } from '../integrations/garmin/push.ts'

import {
  chunkGarminPushJob,
  garminReprocessSince,
  inProcessGarminPushQueue,
  reprocessGarminPushes,
} from './garmin-push-queue.ts'

const NOW = new Date('2026-11-18T12:00:00Z')
const daysBefore = (days: number) => new Date(NOW.getTime() - days * 86_400_000)

describe('chunkGarminPushJob', () => {
  test('splits a large job into jobs of at most the size, in order', () => {
    const records = ['a', 'b', 'c', 'd', 'e'].map((external_id) => ({ external_id, type: 'dailies' }))
    expect(chunkGarminPushJob({ records, user: 'alice' }, 2)).toEqual([
      { records: records.slice(0, 2), user: 'alice' },
      { records: records.slice(2, 4), user: 'alice' },
      { records: records.slice(4), user: 'alice' },
    ])
  })

  test('keeps the replay flag on every chunk', () => {
    const records = ['a', 'b', 'c'].map((external_id) => ({ external_id, type: 'dailies' }))
    expect(chunkGarminPushJob({ records, replay: true, user: 'alice' }, 2).map((job) => job.replay)).toEqual([
      true,
      true,
    ])
  })
})

describe('garminReprocessSince', () => {
  test('defaults to seven days ago', () => {
    expect(garminReprocessSince(undefined, NOW)).toEqual(daysBefore(7))
  })

  test('keeps a time within 90 days and takes an earlier one as 90 days ago', () => {
    expect(garminReprocessSince(daysBefore(30), NOW)).toEqual(daysBefore(30))
    expect(garminReprocessSince(daysBefore(365), NOW)).toEqual(daysBefore(90))
  })
})

describe('reprocessGarminPushes', () => {
  const makeDeps = (keys: { record_type: string; external_id: string }[]) => ({
    enqueue: vi.fn(async (_job: GarminPushJob) => {}),
    listPushRecordKeys: vi.fn(async (_user: string, _since: Date) => keys),
    now: () => NOW,
  })

  test('queues the stored records of known types as one job and answers the count', async () => {
    const deps = makeDeps([
      { external_id: 'sd-1', record_type: 'garmin_push_dailies' },
      { external_id: 'file-7-fit', record_type: 'garmin_push_activity_files' },
      { external_id: 'x-1', record_type: 'garmin_push_something_new' },
    ])
    expect(await reprocessGarminPushes(deps, 'alice', daysBefore(2))).toBe(2)
    expect(deps.listPushRecordKeys).toHaveBeenCalledWith('alice', daysBefore(2))
    expect(deps.enqueue).toHaveBeenCalledWith({
      records: [
        { external_id: 'sd-1', type: 'dailies' },
        { external_id: 'file-7-fit', type: 'activityFiles' },
      ],
      replay: true,
      user: 'alice',
    })
  })

  test('looks back seven days by default and queues nothing when nothing is stored', async () => {
    const deps = makeDeps([])
    expect(await reprocessGarminPushes(deps, 'alice')).toBe(0)
    expect(deps.listPushRecordKeys).toHaveBeenCalledWith('alice', daysBefore(7))
    expect(deps.enqueue).not.toHaveBeenCalled()
  })
})

describe('inProcessGarminPushQueue', () => {
  test('runs jobs one after another and reports a failure without stopping', async () => {
    const order: string[] = []
    const errors: unknown[] = []
    const process = vi.fn(async ({ user }: GarminPushJob) => {
      order.push(user)
      if (user === 'bob') throw new Error('boom')
    })
    const queue = inProcessGarminPushQueue(process, (error) => errors.push(error))
    await queue.enqueue({ records: [], user: 'alice' })
    await queue.enqueue({ records: [], user: 'bob' })
    await queue.enqueue({ records: [], user: 'carol' })
    await vi.waitFor(() => expect(order).toEqual(['alice', 'bob', 'carol']))
    expect(errors).toHaveLength(1)
  })
})
