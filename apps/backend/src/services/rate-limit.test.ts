import { describe, expect, test } from 'vitest'

import { createFailureBackoff, createTokenBucketLimiter, tooManyRequestsMessage } from './rate-limit.ts'

const clock = (start = 1_000_000) => {
  let at = start
  return { advance: (ms: number) => void (at += ms), now: () => at }
}

describe('createTokenBucketLimiter', () => {
  test('allows a burst up to capacity, then refuses with the seconds until a request is regained', () => {
    const time = clock()
    const limiter = createTokenBucketLimiter({ capacity: 3, refill_per_second: 0.5 }, time.now)

    expect([1, 2, 3].map(() => limiter.take('a').allowed)).toEqual([true, true, true])
    expect(limiter.take('a')).toEqual({ allowed: false, retry_after_seconds: 2 })

    time.advance(1000)
    expect(limiter.take('a')).toEqual({ allowed: false, retry_after_seconds: 1 })
    time.advance(1000)
    expect(limiter.take('a')).toEqual({ allowed: true })
  })

  test('keys are independent', () => {
    const limiter = createTokenBucketLimiter({ capacity: 1, refill_per_second: 1 }, clock().now)
    expect(limiter.take('a').allowed).toBe(true)
    expect(limiter.take('a').allowed).toBe(false)
    expect(limiter.take('b').allowed).toBe(true)
  })

  test('refills no further than capacity', () => {
    const time = clock()
    const limiter = createTokenBucketLimiter({ capacity: 2, refill_per_second: 1 }, time.now)
    limiter.take('a')
    time.advance(60_000)
    expect([1, 2, 3].map(() => limiter.take('a').allowed)).toEqual([true, true, false])
  })

  test('forgets keys whose bucket has refilled, and holds at most maxKeys', () => {
    const time = clock()
    const limiter = createTokenBucketLimiter({ capacity: 2, refill_per_second: 1 }, time.now, 3)
    for (const key of ['a', 'b', 'c', 'd']) limiter.take(key)
    expect(limiter.size()).toBe(3)

    time.advance(60_000)
    limiter.take('e')
    expect(limiter.size()).toBe(1)
  })
})

describe('createFailureBackoff', () => {
  const policy = { base_delay_ms: 1000, forget_after_ms: 15 * 60_000, free_failures: 2, max_delay_ms: 8000 }

  test('the free failures cost nothing, then the wait doubles up to the cap', () => {
    const time = clock()
    const backoff = createFailureBackoff(policy, time.now)
    const waits = Array.from({ length: 7 }, () => {
      backoff.recordFailure('alice')
      return backoff.retryAfterSeconds('alice')
    })
    expect(waits).toEqual([0, 0, 1, 2, 4, 8, 8])
  })

  test('the wait counts down from the last failure', () => {
    const time = clock()
    const backoff = createFailureBackoff(policy, time.now)
    for (let i = 0; i < 5; i++) backoff.recordFailure('alice')
    expect(backoff.retryAfterSeconds('alice')).toBe(4)
    time.advance(2500)
    expect(backoff.retryAfterSeconds('alice')).toBe(2)
    time.advance(1500)
    expect(backoff.retryAfterSeconds('alice')).toBe(0)
  })

  test('reset and a quiet spell both forget the failures', () => {
    const time = clock()
    const backoff = createFailureBackoff(policy, time.now)
    for (let i = 0; i < 4; i++) backoff.recordFailure('alice')
    backoff.reset('alice')
    backoff.recordFailure('alice')
    expect(backoff.retryAfterSeconds('alice')).toBe(0)

    for (let i = 0; i < 4; i++) backoff.recordFailure('bob')
    time.advance(policy.forget_after_ms)
    backoff.recordFailure('bob')
    expect(backoff.retryAfterSeconds('bob')).toBe(0)
  })
})

describe('createFailureBackoff undoFailure', () => {
  const policy = { base_delay_ms: 1000, forget_after_ms: 15 * 60_000, free_failures: 1, max_delay_ms: 8000 }

  test('takes back one failure, and forgets a key with none left', () => {
    const backoff = createFailureBackoff(policy, clock().now)
    backoff.recordFailure('alice')
    backoff.recordFailure('alice')
    expect(backoff.retryAfterSeconds('alice')).toBe(1)
    backoff.undoFailure('alice')
    expect(backoff.retryAfterSeconds('alice')).toBe(0)
    backoff.undoFailure('alice')
    expect(backoff.size()).toBe(0)
    backoff.undoFailure('alice')
    expect(backoff.size()).toBe(0)
  })
})

test('tooManyRequestsMessage says how long to wait', () => {
  expect(tooManyRequestsMessage(1)).toBe('Too many requests. Try again in 1 second.')
  expect(tooManyRequestsMessage(30)).toBe('Too many requests. Try again in 30 seconds.')
})
