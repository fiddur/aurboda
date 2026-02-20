import { beforeEach, describe, expect, test, vi } from 'vitest'
import { calculateRetryAfter, isRateLimited, needsSync } from './rescuetime-sync'

describe('calculateRetryAfter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T12:00:00Z'))
  })

  test('uses exponential backoff (attempt 0)', () => {
    const result = calculateRetryAfter(0)
    expect(result).toEqual(new Date('2025-01-01T12:01:00Z'))
  })

  test('uses exponential backoff (attempt 1)', () => {
    const result = calculateRetryAfter(1)
    expect(result).toEqual(new Date('2025-01-01T12:05:00Z'))
  })

  test('uses exponential backoff (attempt 2)', () => {
    const result = calculateRetryAfter(2)
    expect(result).toEqual(new Date('2025-01-01T12:15:00Z'))
  })

  test('caps backoff at max value (attempt >= 3)', () => {
    const result = calculateRetryAfter(5)
    expect(result).toEqual(new Date('2025-01-01T13:00:00Z'))
  })
})

describe('isRateLimited', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T12:00:00Z'))
  })

  test('returns false when syncState is null', () => {
    expect(isRateLimited(null)).toBe(false)
  })

  test('returns false when status is not rate_limited', () => {
    expect(
      isRateLimited({
        data_type: 'productivity',
        provider: 'rescuetime',
        retry_after: new Date('2025-01-01T13:00:00Z'),
        status: 'idle',
      }),
    ).toBe(false)
  })

  test('returns false when retry_after is in the past', () => {
    expect(
      isRateLimited({
        data_type: 'productivity',
        provider: 'rescuetime',
        retry_after: new Date('2025-01-01T11:00:00Z'),
        status: 'rate_limited',
      }),
    ).toBe(false)
  })

  test('returns true when rate_limited and retry_after is in the future', () => {
    expect(
      isRateLimited({
        data_type: 'productivity',
        provider: 'rescuetime',
        retry_after: new Date('2025-01-01T13:00:00Z'),
        status: 'rate_limited',
      }),
    ).toBe(true)
  })
})

describe('needsSync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T12:00:00Z'))
  })

  test('returns true when syncState is null', () => {
    expect(needsSync(null, 30)).toBe(true)
  })

  test('returns true when last_sync_time is undefined', () => {
    expect(
      needsSync(
        {
          data_type: 'productivity',
          provider: 'rescuetime',
          status: 'idle',
        },
        30,
      ),
    ).toBe(true)
  })

  test('returns true when last sync is older than threshold', () => {
    expect(
      needsSync(
        {
          data_type: 'productivity',
          last_sync_time: new Date('2025-01-01T11:00:00Z'), // 1 hour ago
          provider: 'rescuetime',
          status: 'idle',
        },
        30, // 30 minute threshold
      ),
    ).toBe(true)
  })

  test('returns false when last sync is within threshold', () => {
    expect(
      needsSync(
        {
          data_type: 'productivity',
          last_sync_time: new Date('2025-01-01T11:45:00Z'), // 15 minutes ago
          provider: 'rescuetime',
          status: 'idle',
        },
        30, // 30 minute threshold
      ),
    ).toBe(false)
  })
})
