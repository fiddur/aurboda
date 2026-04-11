import { describe, expect, test } from 'vitest'

import { groupEvalJobs } from './deduction-queue.ts'

describe('groupEvalJobs', () => {
  const makeJob = (user: string, start: string, end: string, sourceRuleId?: string) =>
    ({
      data: {
        activity_type: 'test',
        source_rule_id: sourceRuleId,
        user,
        window_end: end,
        window_start: start,
      },
    }) as never

  test('groups jobs by user and merges windows', () => {
    const jobs = [
      makeJob('alice', '2024-01-01T10:00:00Z', '2024-01-01T10:05:00Z'),
      makeJob('alice', '2024-01-01T10:03:00Z', '2024-01-01T10:10:00Z'),
      makeJob('bob', '2024-01-01T12:00:00Z', '2024-01-01T12:30:00Z'),
    ]

    const result = groupEvalJobs(jobs)

    expect(result.size).toBe(2)

    const alice = result.get('alice')!
    expect(alice.window.start).toEqual(new Date('2024-01-01T10:00:00Z'))
    expect(alice.window.end).toEqual(new Date('2024-01-01T10:10:00Z'))
    expect(alice.excludeRuleIds.size).toBe(0)

    const bob = result.get('bob')!
    expect(bob.window.start).toEqual(new Date('2024-01-01T12:00:00Z'))
    expect(bob.window.end).toEqual(new Date('2024-01-01T12:30:00Z'))
  })

  test('collects source rule IDs for exclusion', () => {
    const jobs = [
      makeJob('alice', '2024-01-01T10:00:00Z', '2024-01-01T10:05:00Z', 'rule-a'),
      makeJob('alice', '2024-01-01T10:03:00Z', '2024-01-01T10:10:00Z', 'rule-b'),
      makeJob('alice', '2024-01-01T10:06:00Z', '2024-01-01T10:15:00Z'), // no source rule
    ]

    const result = groupEvalJobs(jobs)
    const alice = result.get('alice')!

    expect(alice.excludeRuleIds).toEqual(new Set(['rule-a', 'rule-b']))
  })

  test('handles empty jobs list', () => {
    const result = groupEvalJobs([])
    expect(result.size).toBe(0)
  })

  test('single job returns correct window', () => {
    const jobs = [makeJob('alice', '2024-01-01T10:00:00Z', '2024-01-01T10:05:00Z')]
    const result = groupEvalJobs(jobs)

    const alice = result.get('alice')!
    expect(alice.window.start).toEqual(new Date('2024-01-01T10:00:00Z'))
    expect(alice.window.end).toEqual(new Date('2024-01-01T10:05:00Z'))
  })

  test('deduplicates source rule IDs', () => {
    const jobs = [
      makeJob('alice', '2024-01-01T10:00:00Z', '2024-01-01T10:05:00Z', 'rule-a'),
      makeJob('alice', '2024-01-01T10:03:00Z', '2024-01-01T10:10:00Z', 'rule-a'),
    ]

    const result = groupEvalJobs(jobs)
    const alice = result.get('alice')!

    expect(alice.excludeRuleIds.size).toBe(1)
    expect(alice.excludeRuleIds.has('rule-a')).toBe(true)
  })
})
