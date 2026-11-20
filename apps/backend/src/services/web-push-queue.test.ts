import { describe, expect, test } from 'vitest'

import type { PushDelivery } from './web-push.ts'

import { runWebPushJob } from './web-push-queue.ts'

const job = { notification_id: '11111111-1111-4111-8111-111111111111', user: 'alice' }

const deps = (delivery: PushDelivery) => {
  const calls: [string, string, { retry: boolean }][] = []
  return {
    calls,
    deps: {
      deliver: async (user: string, id: string, options: { retry: boolean }) => {
        calls.push([user, id, options])
        return delivery
      },
    },
  }
}

describe('runWebPushJob', () => {
  test('delivers the notification and completes when every browser was reached or removed', async () => {
    const { deps: d, calls } = deps({ failed: 0, reached: 2, removed: 1 })
    await expect(runWebPushJob(d, job, 0)).resolves.toEqual({ failed: 0, reached: 2, removed: 1 })
    expect(calls).toEqual([['alice', job.notification_id, { retry: false }]])
  })

  test('throws when a browser failed, so that pg-boss retries', async () => {
    const { deps: d } = deps({ failed: 1, reached: 1, removed: 0 })
    await expect(runWebPushJob(d, job, 0)).rejects.toThrow('Web Push failed for 1 browser(s) of alice')
  })

  test('a retry asks for the failed browsers only', async () => {
    const { deps: d, calls } = deps({ failed: 0, reached: 1, removed: 0 })
    await runWebPushJob(d, job, 1)
    expect(calls[0]?.[2]).toEqual({ retry: true })
  })
})
