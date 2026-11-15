import { type MessageQueue, SendActivityError } from '@fedify/fedify'
import { describe, expect, test, vi } from 'vitest'

import {
  createDeliveryObserver,
  deliveryErrorLine,
  deliveryRetryPolicy,
  federationDelivery,
} from './delivery-queue.ts'

const INBOX = 'https://down.example/users/bob/inbox'

const fakeQueue = () => {
  let handler: ((message: unknown) => Promise<void> | void) | null = null
  const enqueued: unknown[] = []
  const queue: MessageQueue = {
    enqueue: async (message) => {
      enqueued.push(message)
    },
    listen: async (h) => {
      handler = h
    },
  }
  return { deliver: (message: unknown) => handler!(message), enqueued, queue }
}

const fakeStore = () => ({
  recordDeliveryFailure: vi.fn(async () => {}),
  recordDeliverySuccess: vi.fn(async () => {}),
})

const listening = async (
  observer: ReturnType<typeof createDeliveryObserver>,
  run: (q: MessageQueue) => (message: unknown) => Promise<void>,
) => {
  const { deliver, queue } = fakeQueue()
  const observed = observer.observe(queue)
  await observed.listen(run(observed))
  return deliver
}

const outbox = { inbox: INBOX, type: 'outbox' }

describe('deliveryErrorLine', () => {
  test('an HTTP failure is its status and reason, never the response body', () => {
    const error = new SendActivityError(new URL(INBOX), 503, 'Failed … secret body', 'secret body')
    expect(deliveryErrorLine(error)).toEqual({ line: 'HTTP 503 Service Unavailable', status: 503 })
  })

  test('a network failure names its error code', () => {
    const error = new TypeError('fetch failed', {
      cause: Object.assign(new Error('x'), { code: 'ECONNREFUSED' }),
    })
    expect(deliveryErrorLine(error)).toEqual({ line: 'TypeError: ECONNREFUSED', status: null })
  })

  test('otherwise the first line of the message, at most 200 characters', () => {
    const { line } = deliveryErrorLine(new Error(`${'x'.repeat(300)}\nsecond line`))
    expect(line).toHaveLength(200)
    expect(line.startsWith('Error: xxx')).toBe(true)
  })
})

describe('deliveryRetryPolicy', () => {
  test('first retry after one to two minutes, capped at 12 hours, ten attempts in all', () => {
    const policy = deliveryRetryPolicy()
    const first = policy({ attempts: 0, elapsedTime: Temporal.Duration.from({ seconds: 0 }) })
    expect(first!.total('second')).toBeGreaterThanOrEqual(60)
    expect(first!.total('second')).toBeLessThanOrEqual(120)
    const late = policy({ attempts: 8, elapsedTime: Temporal.Duration.from({ hours: 30 }) })
    expect(late!.total('hour')).toBe(12)
    expect(policy({ attempts: 9, elapsedTime: Temporal.Duration.from({ hours: 60 }) })).toBeNull()
  })
})

describe('delivery observer', () => {
  test('an HTTP failure is recorded against the inbox host', async () => {
    const store = fakeStore()
    const observer = createDeliveryObserver({ store })
    const deliver = await listening(observer, () => async () => {
      await observer.onOutboxError(new SendActivityError(new URL(INBOX), 503, 'm', 'body'), null)
    })
    await deliver(outbox)
    expect(store.recordDeliveryFailure).toHaveBeenCalledWith({
      inbox_host: 'down.example',
      last_error: 'HTTP 503 Service Unavailable',
      last_inbox: INBOX,
      last_status: 503,
    })
    expect(store.recordDeliverySuccess).not.toHaveBeenCalled()
  })

  test('a transport failure, which carries no inbox, is recorded against the attempt’s inbox', async () => {
    const store = fakeStore()
    const observer = createDeliveryObserver({ store })
    const deliver = await listening(observer, () => async () => {
      await observer.onOutboxError(new TypeError('fetch failed'), null)
    })
    await deliver(outbox)
    expect(store.recordDeliveryFailure).toHaveBeenCalledWith(
      expect.objectContaining({ inbox_host: 'down.example', last_inbox: INBOX, last_status: null }),
    )
  })

  test('an attempt that neither failed nor was put back counts as a success', async () => {
    const store = fakeStore()
    const observer = createDeliveryObserver({ store })
    const deliver = await listening(observer, () => async () => {})
    await deliver(outbox)
    expect(store.recordDeliverySuccess).toHaveBeenCalledWith('down.example')
  })

  test('an attempt put back on the queue (a circuit-breaker hold) is not a success', async () => {
    const store = fakeStore()
    const observer = createDeliveryObserver({ store })
    const deliver = await listening(observer, (queue) => async (message) => {
      await queue.enqueue(message)
    })
    await deliver(outbox)
    expect(store.recordDeliverySuccess).not.toHaveBeenCalled()
    expect(store.recordDeliveryFailure).not.toHaveBeenCalled()
  })

  test('a held activity dropped by the circuit breaker is recorded as a failure', async () => {
    const store = fakeStore()
    const observer = createDeliveryObserver({ store })
    const deliver = await listening(observer, () => async () => {
      await observer.onPermanentFailure({} as never, {
        activity: {} as never,
        actorIds: [],
        error: new SendActivityError(new URL(INBOX), 0, 'expired', ''),
        inbox: new URL(INBOX),
        reason: 'circuit-breaker-ttl',
        statusCode: 0,
      })
    })
    await deliver(outbox)
    expect(store.recordDeliveryFailure).toHaveBeenCalledWith(
      expect.objectContaining({ inbox_host: 'down.example', last_status: null }),
    )
    expect(store.recordDeliverySuccess).not.toHaveBeenCalled()
  })

  test('fan-out messages pass through untouched', async () => {
    const store = fakeStore()
    const observer = createDeliveryObserver({ store })
    const seen: unknown[] = []
    const deliver = await listening(observer, () => async (message) => void seen.push(message))
    await deliver({ type: 'fanout' })
    expect(seen).toEqual([{ type: 'fanout' }])
    expect(store.recordDeliverySuccess).not.toHaveBeenCalled()
  })

  test('a store failure is logged, not thrown', async () => {
    const store = {
      ...fakeStore(),
      recordDeliverySuccess: vi.fn(async () => Promise.reject(new Error('db down'))),
    }
    const logError = vi.fn()
    const observer = createDeliveryObserver({ logError, store })
    const deliver = await listening(observer, () => async () => {})
    await deliver(outbox)
    expect(logError).toHaveBeenCalled()
  })
})

describe('federationDelivery', () => {
  test('without pg-boss, delivery stays synchronous and says so', async () => {
    const log = vi.fn()
    expect(await federationDelivery(null, fakeStore(), log)).toBeNull()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('synchronous'))
  })
})
