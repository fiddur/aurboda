import { describe, expect, test } from 'vitest'

import type { CalorieJobData } from './calorie-queue.ts'
import type { Job } from './pg-boss.ts'

import { groupCalorieJobs } from './calorie-queue.ts'

describe('groupCalorieJobs', () => {
  const makeJob = (user: string, start: string, end: string): Job<CalorieJobData> =>
    ({
      data: { end, start, user },
    }) as Job<CalorieJobData>

  test('groups jobs by user and merges windows', () => {
    const jobs = [
      makeJob('alice', '2024-01-01T10:00:00Z', '2024-01-01T10:05:00Z'),
      makeJob('alice', '2024-01-01T10:03:00Z', '2024-01-01T10:10:00Z'),
      makeJob('alice', '2024-01-01T09:55:00Z', '2024-01-01T10:08:00Z'),
      makeJob('bob', '2024-01-01T12:00:00Z', '2024-01-01T12:30:00Z'),
    ]

    const result = groupCalorieJobs(jobs)

    expect(result.size).toBe(2)
    const alice = result.get('alice')!
    expect(alice.start).toEqual(new Date('2024-01-01T09:55:00Z'))
    expect(alice.end).toEqual(new Date('2024-01-01T10:10:00Z'))

    const bob = result.get('bob')!
    expect(bob.start).toEqual(new Date('2024-01-01T12:00:00Z'))
    expect(bob.end).toEqual(new Date('2024-01-01T12:30:00Z'))
  })

  test('handles empty jobs list', () => {
    expect(groupCalorieJobs([]).size).toBe(0)
  })

  test('single job returns the same window', () => {
    const jobs = [makeJob('alice', '2024-01-01T10:00:00Z', '2024-01-01T10:05:00Z')]
    const result = groupCalorieJobs(jobs)
    const alice = result.get('alice')!
    expect(alice.start).toEqual(new Date('2024-01-01T10:00:00Z'))
    expect(alice.end).toEqual(new Date('2024-01-01T10:05:00Z'))
  })
})
