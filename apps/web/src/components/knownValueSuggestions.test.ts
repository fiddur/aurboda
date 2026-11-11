import type { ActivityFieldValue } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import { exactMatchIndex, filterKnownValues, stepActiveIndex } from './knownValueSuggestions'

const values: ActivityFieldValue[] = [
  { count: 3, last_used: '2026-11-04T10:00:00Z', value: 'Leg day' },
  { count: 1441, last_used: '2026-11-03T10:00:00Z', value: 'Easy run' },
  { count: 257, last_used: '2026-11-02T10:00:00Z', value: 'Long Run' },
]

describe('filterKnownValues', () => {
  it('returns every value in order for empty text', () => {
    expect(filterKnownValues(values, '')).toEqual(values)
  })

  it('matches substrings case-insensitively', () => {
    expect(filterKnownValues(values, 'RUN').map((v) => v.value)).toEqual(['Easy run', 'Long Run'])
  })

  it('ignores surrounding whitespace in the typed text', () => {
    expect(filterKnownValues(values, '  leg ').map((v) => v.value)).toEqual(['Leg day'])
    expect(filterKnownValues(values, '   ')).toEqual(values)
  })

  it('offers every value again when the text is exactly one of them', () => {
    expect(filterKnownValues(values, 'easy RUN')).toEqual(values)
  })

  it('returns an empty list when nothing matches', () => {
    expect(filterKnownValues(values, 'swim')).toEqual([])
  })

  it('keeps the given order instead of sorting by count', () => {
    expect(filterKnownValues(values, 'a').map((v) => v.value)).toEqual(['Leg day', 'Easy run'])
  })
})

describe('exactMatchIndex', () => {
  it('points at the row the text exactly matches, ignoring case and surrounding whitespace', () => {
    expect(exactMatchIndex(values, 'Easy run')).toBe(1)
    expect(exactMatchIndex(values, '  long RUN ')).toBe(2)
  })

  it('returns -1 for a partial match', () => {
    expect(exactMatchIndex(values, 'run')).toBe(-1)
  })

  it('returns -1 for empty text', () => {
    expect(exactMatchIndex(values, '')).toBe(-1)
    expect(exactMatchIndex(values, '   ')).toBe(-1)
  })

  it('returns -1 when there are no rows', () => {
    expect(exactMatchIndex([], 'Leg day')).toBe(-1)
  })
})

describe('stepActiveIndex', () => {
  it('moves from no selection to the first row on down', () => {
    expect(stepActiveIndex(-1, 1, 3)).toBe(0)
  })

  it('clamps at the last row', () => {
    expect(stepActiveIndex(2, 1, 3)).toBe(2)
  })

  it('clamps at the first row', () => {
    expect(stepActiveIndex(0, -1, 3)).toBe(0)
    expect(stepActiveIndex(-1, -1, 3)).toBe(0)
  })

  it('moves within the list', () => {
    expect(stepActiveIndex(0, 1, 3)).toBe(1)
    expect(stepActiveIndex(2, -1, 3)).toBe(1)
  })

  it('returns -1 when there are no rows', () => {
    expect(stepActiveIndex(-1, 1, 0)).toBe(-1)
    expect(stepActiveIndex(2, -1, 0)).toBe(-1)
  })
})
