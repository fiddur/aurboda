import { describe, expect, test } from 'vitest'

import type { AutoshareJobData } from './autoshare-queue.ts'
import type { Job } from './pg-boss.ts'

import { announceNextEvaluationAt, groupAutoshareJobs } from './autoshare-queue.ts'
import { ANNOUNCE_DELAY_SECONDS, STABILISATION_SECONDS } from './autoshare.ts'

const job = (user: string, start: string, end: string): Job<AutoshareJobData> =>
  ({ data: { user, window_end: end, window_start: start }, id: 'j' }) as Job<AutoshareJobData>

describe('groupAutoshareJobs', () => {
  test('merges windows per user across a batch', () => {
    const grouped = groupAutoshareJobs([
      job('a', '2026-08-01T08:00:00Z', '2026-08-01T09:00:00Z'),
      job('a', '2026-08-01T07:00:00Z', '2026-08-01T08:30:00Z'),
      job('b', '2026-08-01T10:00:00Z', '2026-08-01T11:00:00Z'),
    ])
    expect(grouped.get('a')).toEqual({
      end: new Date('2026-08-01T09:00:00Z'),
      start: new Date('2026-08-01T07:00:00Z'),
    })
    expect(grouped.get('b')).toEqual({
      end: new Date('2026-08-01T11:00:00Z'),
      start: new Date('2026-08-01T10:00:00Z'),
    })
  })

  test('the stabilisation delay is minutes, not hours (a settled post, same day)', () => {
    expect(STABILISATION_SECONDS).toBeGreaterThanOrEqual(60)
    expect(STABILISATION_SECONDS).toBeLessThanOrEqual(3600)
  })
})

describe('announceNextEvaluationAt', () => {
  test('is when the evaluation sent with the announce job is due', () => {
    const now = new Date('2026-08-01T08:00:30Z')
    expect(announceNextEvaluationAt(now)).toEqual(
      new Date(now.getTime() + (STABILISATION_SECONDS - ANNOUNCE_DELAY_SECONDS) * 1000),
    )
    expect(ANNOUNCE_DELAY_SECONDS).toBeLessThan(STABILISATION_SECONDS)
  })
})
