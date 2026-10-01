import { describe, expect, test } from 'vitest'

import { challengeTheme } from './og-challenge-theme.ts'

describe('challengeTheme', () => {
  test.each([
    ['metric', 'steps', 'steps'],
    ['activity_type', 'Running', 'running'],
    ['metric', 'sleep_score', 'sleep'],
    ['metric', 'hr_zone_2_sec', 'heart'],
    ['metric', 'weight', 'default'],
    ['activity_type', 'Chess', 'default'],
  ] as const)('%s %s → %s', (source_type, pattern, key) => {
    expect(challengeTheme({ pattern, source_type }).key).toBe(key)
  })

  test('the default theme is the purple trophy', () => {
    expect(challengeTheme({ pattern: 'unknown', source_type: 'metric' })).toEqual({
      emoji: '🏆',
      gradient: ['#4c1d95', '#673ab8', '#8b5cf6'],
      key: 'default',
    })
  })
})
