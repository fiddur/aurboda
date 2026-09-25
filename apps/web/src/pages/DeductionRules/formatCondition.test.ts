import { describe, expect, test } from 'vitest'

import { formatCondition, formatConditions } from './formatCondition'

describe('formatCondition', () => {
  test('summarises a media condition', () => {
    expect(
      formatCondition({
        kind: 'media',
        min_played_ratio: 0.8,
        min_played_secs: 600,
        title: 'Yin',
        url_host: ['truenakedyoga.com'],
      }),
    ).toBe('Media: host truenakedyoga.com, title "Yin", ≥ 600 s, ≥ 80%')
  })

  test('a media condition without matchers matches any play', () => {
    expect(formatCondition({ kind: 'media' })).toBe('Media: any')
  })

  test('joins conditions with AND', () => {
    expect(
      formatConditions([
        { activity_type: 'yoga', kind: 'activity' },
        { kind: 'media', player: ['mpv'] },
      ]),
    ).toBe('Activity: yoga AND Media: player mpv')
  })
})
