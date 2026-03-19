import { describe, expect, test } from 'vitest'

import { localMidnightToUtc } from './health-connect.ts'

describe('localMidnightToUtc', () => {
  test('falls back to UTC midnight when no timezone is provided', () => {
    const result = localMidnightToUtc('2026-03-18')
    expect(result.toISOString()).toBe('2026-03-18T00:00:00.000Z')
  })

  test('converts CET (UTC+1) midnight to correct UTC time', () => {
    // March 18 in Stockholm (CET, UTC+1) starts at 23:00 UTC on March 17
    const result = localMidnightToUtc('2026-03-18', 'Europe/Stockholm')
    expect(result.toISOString()).toBe('2026-03-17T23:00:00.000Z')
  })

  test('handles CEST (UTC+2) correctly during summer time', () => {
    // July 15 in Stockholm (CEST, UTC+2) starts at 22:00 UTC on July 14
    const result = localMidnightToUtc('2026-07-15', 'Europe/Stockholm')
    expect(result.toISOString()).toBe('2026-07-14T22:00:00.000Z')
  })

  test('handles positive UTC offset (Asia/Tokyo, UTC+9)', () => {
    // March 18 in Tokyo (UTC+9) starts at 15:00 UTC on March 17
    const result = localMidnightToUtc('2026-03-18', 'Asia/Tokyo')
    expect(result.toISOString()).toBe('2026-03-17T15:00:00.000Z')
  })

  test('handles negative UTC offset (America/New_York, UTC-5 EST)', () => {
    // January 15 in New York (EST, UTC-5) starts at 05:00 UTC on January 15
    const result = localMidnightToUtc('2026-01-15', 'America/New_York')
    expect(result.toISOString()).toBe('2026-01-15T05:00:00.000Z')
  })

  test('handles UTC timezone', () => {
    const result = localMidnightToUtc('2026-03-18', 'UTC')
    expect(result.toISOString()).toBe('2026-03-18T00:00:00.000Z')
  })

  test('falls back to UTC midnight for invalid timezone', () => {
    const result = localMidnightToUtc('2026-03-18', 'Invalid/Timezone')
    expect(result.toISOString()).toBe('2026-03-18T00:00:00.000Z')
  })

  test('handles New Zealand (UTC+12/+13)', () => {
    // March 18 in Auckland (NZDT, UTC+13 during DST) starts at 11:00 UTC on March 17
    const result = localMidnightToUtc('2026-03-18', 'Pacific/Auckland')
    expect(result.toISOString()).toBe('2026-03-17T11:00:00.000Z')
  })
})
