import { describe, expect, test } from 'vitest'

import { canMergeInto, mergeTargets } from './itemMerge'

describe('mergeTargets', () => {
  test('excludes the current value and keeps the order', () => {
    expect(mergeTargets(['Squat', 'Dumbbell Curl', 'Bench Press'], 'Squat')).toEqual([
      'Dumbbell Curl',
      'Bench Press',
    ])
  })

  test('matches the current value case-insensitively and trimmed', () => {
    expect(mergeTargets([' squat ', 'SQUAT', 'Deadlift'], 'Squat')).toEqual(['Deadlift'])
  })

  test('returns everything when the current value is absent', () => {
    expect(mergeTargets(['Deadlift', 'Row'], 'Squat')).toEqual(['Deadlift', 'Row'])
  })

  test('returns an empty list for no values', () => {
    expect(mergeTargets([], 'Squat')).toEqual([])
  })
})

describe('canMergeInto', () => {
  test('needs a non-empty target', () => {
    expect(canMergeInto('', 'Squat')).toBe(false)
    expect(canMergeInto('   ', 'Squat')).toBe(false)
  })

  test('needs a target that differs from the current value', () => {
    expect(canMergeInto('Squat', 'Squat')).toBe(false)
    expect(canMergeInto(' Squat ', 'Squat')).toBe(false)
  })

  test('accepts a different spelling, including one that only differs in case', () => {
    expect(canMergeInto('Back Squat', 'Squat')).toBe(true)
    expect(canMergeInto('squat', 'Squat')).toBe(true)
  })
})
