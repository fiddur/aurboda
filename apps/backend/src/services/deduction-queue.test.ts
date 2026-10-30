import type { DeductionRule } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { groupEvalJobs, selectRelevantRules } from './deduction-queue.ts'

describe('groupEvalJobs', () => {
  const makeJob = (user: string, start: string, end: string, sourceRuleId?: string, activityType = 'test') =>
    ({
      data: {
        activity_type: activityType,
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

  test('collects activity types per user, including the wildcard', () => {
    const jobs = [
      makeJob('alice', '2024-01-01T10:00:00Z', '2024-01-01T10:05:00Z', undefined, 'computer_active'),
      makeJob('alice', '2024-01-01T10:03:00Z', '2024-01-01T10:10:00Z', undefined, 'running'),
      makeJob('alice', '2024-01-01T10:04:00Z', '2024-01-01T10:06:00Z', undefined, 'computer_active'),
      makeJob('bob', '2024-01-01T12:00:00Z', '2024-01-01T12:30:00Z', undefined, '*'),
    ]

    const result = groupEvalJobs(jobs)

    expect(result.get('alice')?.activityTypes).toEqual(new Set(['computer_active', 'running']))
    expect(result.get('bob')?.activityTypes).toEqual(new Set(['*']))
  })
})

describe('selectRelevantRules', () => {
  const rule = (
    name: string,
    output_activity_type: string,
    conditions: DeductionRule['conditions'],
    extra: Partial<DeductionRule> = {},
  ): DeductionRule => ({
    conditions,
    enabled: true,
    id: `00000000-0000-4000-8000-${name.padStart(12, '0')}`,
    name,
    output_activity_type,
    priority: 0,
    ...extra,
  })

  const hardRun = rule(
    'hardrun',
    'running',
    [
      {
        activity_type: 'running',
        feature: 'zone5_fraction',
        kind: 'activity_feature',
        operator: 'gte',
        value: 0.4,
      },
    ],
    { mode: 'enrich', output_category: 'hard' },
  )
  const tv = rule(
    'tv',
    'tv',
    [
      {
        activity_type: 'computer_active',
        field: 'device',
        kind: 'activity_data',
        operator: 'eq',
        value: 'sharada',
      },
    ],
    { merge_gap_seconds: 300, output_title: 'Sharada TV' },
  )
  const vocal = rule(
    'vocal',
    'vocal_training',
    [{ artist: ['Voice Activated'], duration_seconds: 210, kind: 'scrobble', match_mode: 'exact' }],
    { merge_gap_seconds: 600 },
  )
  const holosync = rule(
    'holosync',
    'holosync',
    [
      { activity_type: 'meditation', kind: 'activity' },
      {
        artist: ['Centerpointe Research Institute'],
        duration_seconds: 2000,
        kind: 'scrobble',
        match_mode: 'exact',
        track: '',
      },
    ],
    { priority: 1 },
  )
  const coding = rule('coding', 'coding', [
    { category: ['Work', 'Programming'], kind: 'screentime_category' },
  ])
  const atGym = rule('gym', 'strength_training', [
    { activity_type: 'exercise', kind: 'activity' },
    { kind: 'location', location_name: 'Gym' },
  ])
  const all = [hardRun, tv, vocal, holosync, coding, atGym]
  const names = (affected: string[]) => selectRelevantRules(all, new Set(affected)).map((r) => r.name)

  test('matches an activity condition', () => {
    expect(names(['meditation'])).toEqual(['holosync', 'coding'])
  })

  test('matches an activity_data condition', () => {
    expect(names(['computer_active'])).toEqual(['tv', 'coding'])
  })

  test('matches an activity_feature condition', () => {
    expect(names(['running'])).toEqual(['hardrun', 'coding'])
  })

  test('matches on the output activity type alone', () => {
    expect(names(['vocal_training'])).toEqual(['vocal', 'coding'])
  })

  test('excludes a scrobble-only rule whose output type is unrelated', () => {
    expect(names(['computer_active'])).not.toContain('vocal')
  })

  test('always includes a rule with a screentime_category condition', () => {
    expect(names(['some_unrelated_type'])).toEqual(['coding'])
  })

  test('matches a condition on an ancestor of the changed type', () => {
    expect(names(['cycling', 'exercise'])).toEqual(['coding', 'gym'])
  })

  test('excludes an activity rule on an unrelated type', () => {
    expect(names(['sleep'])).not.toContain('holosync')
    expect(names(['sleep'])).not.toContain('gym')
  })
})
