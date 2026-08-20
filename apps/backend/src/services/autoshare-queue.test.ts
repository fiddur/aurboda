import { describe, expect, test } from 'vitest'

import type { AutoshareJobData } from './autoshare-queue.ts'
import type { Job } from './pg-boss.ts'

import { groupAutoshareJobs, STABILISATION_SECONDS } from './autoshare-queue.ts'

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
