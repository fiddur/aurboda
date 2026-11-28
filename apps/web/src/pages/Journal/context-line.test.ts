import type { JournalContextValue } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { contextToken } from './context-line'

const value = (overrides: Partial<JournalContextValue>): JournalContextValue => ({
  decimals: 0,
  id: 'x',
  kind: 'metric',
  label: 'W',
  name: 'weight',
  suffix: '',
  text: '',
  value: 96.62,
  ...overrides,
})

describe('contextToken', () => {
  test('formats the value with its decimals in the locale', () => {
    expect(contextToken(value({ decimals: 1 }), 'sv-SE')).toBe('W96,6')
    expect(contextToken(value({ decimals: 1 }), 'en-US')).toBe('W96.6')
    expect(contextToken(value({ decimals: 0 }), 'en-US')).toBe('W97')
    expect(contextToken(value({ decimals: 2, value: 5 }), 'en-US')).toBe('W5.00')
  })

  test('adds the suffix and keeps large numbers ungrouped', () => {
    expect(contextToken(value({ kind: 'moon', label: '🌘', suffix: '%', value: 15.2 }), 'en-US')).toBe(
      '🌘15%',
    )
    expect(contextToken(value({ label: 'S', value: 12345 }), 'en-US')).toBe('S12345')
  })

  test("shows the weather's text, which is not its value", () => {
    expect(
      contextToken(value({ kind: 'weather', label: '⛅', text: '⛅ Partly cloudy', value: 2 }), 'en-US'),
    ).toBe('⛅ Partly cloudy')
  })
})
