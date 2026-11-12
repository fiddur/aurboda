import { describe, expect, test } from 'vitest'

import { parseImpactPeriod } from './impact-period.ts'

describe('parseImpactPeriod', () => {
  test('neither bound leaves the rolling period', () => {
    expect(parseImpactPeriod()).toEqual({ ok: true })
  })

  test('both bounds give the fixed period', () => {
    expect(parseImpactPeriod('2026-01-01T00:00:00Z', '2026-03-01T00:00:00Z')).toEqual({
      ok: true,
      since: new Date('2026-01-01T00:00:00Z'),
      until: new Date('2026-03-01T00:00:00Z'),
    })
  })

  test('one bound alone is an error', () => {
    expect(parseImpactPeriod('2026-01-01T00:00:00Z')).toEqual({
      error: 'Give both start and end, or neither.',
      ok: false,
    })
    expect(parseImpactPeriod(undefined, '2026-03-01T00:00:00Z').ok).toBe(false)
  })

  test('reversed or equal bounds are an error', () => {
    expect(parseImpactPeriod('2026-03-01T00:00:00Z', '2026-01-01T00:00:00Z')).toEqual({
      error: 'start must be before end.',
      ok: false,
    })
    expect(parseImpactPeriod('2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z').ok).toBe(false)
  })

  test('an unparseable bound is an error', () => {
    expect(parseImpactPeriod('soon', '2026-01-01T00:00:00Z')).toEqual({
      error: 'start and end must be ISO 8601 datetimes.',
      ok: false,
    })
  })
})
