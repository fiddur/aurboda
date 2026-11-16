import { describe, expect, test } from 'vitest'

import { createPgBossMessageQueue, type PgBossQueueClient } from './pg-boss-message-queue.ts'

type WorkHandler = (jobs: { data: object }[]) => Promise<void>

const fakeBoss = () => {
  const calls = {
    createQueue: [] as unknown[][],
    insert: [] as unknown[][],
    offWork: [] as unknown[][],
    send: [] as unknown[][],
    work: [] as unknown[][],
  }
  let handler: WorkHandler | null = null
  const boss = {
    createQueue: async (...args: unknown[]) => {
      calls.createQueue.push(args)
    },
    insert: async (...args: unknown[]) => {
      calls.insert.push(args)
      return null
    },
    offWork: async (...args: unknown[]) => {
      calls.offWork.push(args)
    },
    send: async (...args: unknown[]) => {
      calls.send.push(args)
      return 'job-id'
    },
    work: async (name: string, options: unknown, work: WorkHandler) => {
      calls.work.push([name, options])
      handler = work
      return 'worker-id'
    },
  } as unknown as PgBossQueueClient
  return { boss, calls, deliver: (jobs: { data: object }[]) => handler!(jobs) }
}

const delay = (ms: number) => Temporal.Duration.from({ milliseconds: ms })

describe('pg-boss message queue', () => {
  test('creates its queue without pg-boss retries and with a bounded retention', async () => {
    const { boss, calls } = fakeBoss()
    await createPgBossMessageQueue(boss, 'fedify-outbox')
    expect(calls.createQueue).toEqual([['fedify-outbox', { deleteAfterSeconds: 3600, retryLimit: 0 }]])
  })

  test('leaves the retries to Fedify', async () => {
    const { boss } = fakeBoss()
    expect((await createPgBossMessageQueue(boss, 'q')).nativeRetrial).toBe(false)
  })

  test('enqueues a message to start at once', async () => {
    const { boss, calls } = fakeBoss()
    const queue = await createPgBossMessageQueue(boss, 'q')
    await queue.enqueue({ type: 'outbox' })
    expect(calls.send).toEqual([['q', { type: 'outbox' }, { retryLimit: 0 }]])
  })

  test('enqueues a delayed message to start after the delay, in seconds', async () => {
    const { boss, calls } = fakeBoss()
    const queue = await createPgBossMessageQueue(boss, 'q')
    await queue.enqueue({ type: 'outbox' }, { delay: delay(90_500) })
    expect(calls.send).toEqual([['q', { type: 'outbox' }, { retryLimit: 0, startAfter: 90.5 }]])
  })

  test('enqueues many messages in one insert', async () => {
    const { boss, calls } = fakeBoss()
    const queue = await createPgBossMessageQueue(boss, 'q')
    await queue.enqueueMany!([{ n: 1 }, { n: 2 }], { delay: delay(2000) })
    expect(calls.insert).toEqual([
      [
        'q',
        [
          { data: { n: 1 }, retryLimit: 0, startAfter: 2 },
          { data: { n: 2 }, retryLimit: 0, startAfter: 2 },
        ],
      ],
    ])
  })

  test('enqueueMany with nothing inserts nothing', async () => {
    const { boss, calls } = fakeBoss()
    const queue = await createPgBossMessageQueue(boss, 'q')
    await queue.enqueueMany!([])
    expect(calls.insert).toEqual([])
  })

  test('listen hands each job to the handler and stops working when the signal aborts', async () => {
    const { boss, calls, deliver } = fakeBoss()
    const queue = await createPgBossMessageQueue(boss, 'q', {
      localConcurrency: 2,
      pollingIntervalSeconds: 1,
    })
    const received: unknown[] = []
    const abort = new AbortController()
    let stopped = false
    const listening = queue
      .listen((message) => void received.push(message), { signal: abort.signal })
      .then(() => {
        stopped = true
      })
    await new Promise((resolve) => setImmediate(resolve))
    expect(calls.work).toEqual([['q', { batchSize: 1, localConcurrency: 2, pollingIntervalSeconds: 1 }]])

    await deliver([{ data: { n: 1 } }])
    expect(received).toEqual([{ n: 1 }])
    expect(stopped).toBe(false)

    abort.abort()
    await listening
    expect(calls.offWork).toEqual([['q', { id: 'worker-id', wait: true }]])
  })

  test('a handler error fails the job (pg-boss does not retry it)', async () => {
    const { boss, deliver } = fakeBoss()
    const queue = await createPgBossMessageQueue(boss, 'q')
    const abort = new AbortController()
    const listening = queue.listen(
      () => {
        throw new Error('boom')
      },
      { signal: abort.signal },
    )
    await new Promise((resolve) => setImmediate(resolve))
    await expect(deliver([{ data: {} }])).rejects.toThrow('boom')
    abort.abort()
    await listening
  })

  test('listen with an already aborted signal starts no worker', async () => {
    const { boss, calls } = fakeBoss()
    const queue = await createPgBossMessageQueue(boss, 'q')
    const abort = new AbortController()
    abort.abort()
    await queue.listen(() => {}, { signal: abort.signal })
    expect(calls.work).toEqual([])
  })
})
