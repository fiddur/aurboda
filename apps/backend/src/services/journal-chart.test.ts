import { JOURNAL_BREAKDOWN_MAX_SERIES } from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

import { foldSeries, journalFiltersOf, journalSeriesNames } from './journal-chart.ts'

const day = new Date('2024-03-04T00:00:00Z')
const alex = { created_at: new Date('2024-01-01T00:00:00Z'), id: 'a', name: 'Alex' }
const otherAlex = { created_at: new Date('2024-02-01T00:00:00Z'), id: 'b', name: 'Alex' }

describe('journalSeriesNames', () => {
  test('names a tag series by the tag and an untagged entry (none)', () => {
    const rows = [
      { bucket_start: day, tag: 'travel', value: 1 },
      { bucket_start: day, tag: null, value: 2 },
    ]
    expect(journalSeriesNames(rows, ['@tags'])).toEqual(['travel', '(none)'])
  })

  test('labels same-named people apart, (none) for no one', () => {
    const rows = [
      { bucket_start: day, person: otherAlex, value: 1 },
      { bucket_start: day, person: alex, value: 1 },
      { bucket_start: day, person: null, value: 1 },
    ]
    expect(journalSeriesNames(rows, ['@people'])).toEqual(['Alex (2)', 'Alex', '(none)'])
  })

  test('joins both fields in the order given', () => {
    const rows = [{ bucket_start: day, person: alex, tag: 'work', value: 1 }]
    expect(journalSeriesNames(rows, ['@people', '@tags'])).toEqual(['Alex / work'])
    expect(journalSeriesNames(rows, ['@tags', '@people'])).toEqual(['work / Alex'])
  })
})

describe('foldSeries', () => {
  test('keeps up to the cap as they are, sorted by name', () => {
    const totals = new Map(Array.from({ length: JOURNAL_BREAKDOWN_MAX_SERIES }, (_, i) => [`t${i}`, i]))
    const { nameOf, series } = foldSeries(totals)
    expect(series).toEqual([...totals.keys()].toSorted())
    expect(nameOf.get('t0')).toBe('t0')
  })

  test('over the cap keeps the largest (ties by name), sorted, and folds the rest into Other, listed last', () => {
    const totals = new Map([
      ['a', 1],
      ['b', 5],
      ['c', 5],
      ['d', 3],
      ['e', 9],
    ])
    const { nameOf, series } = foldSeries(totals, 3)
    expect(series).toEqual(['b', 'e', 'Other'])
    expect(['a', 'c', 'd'].map((n) => nameOf.get(n))).toEqual(['Other', 'Other', 'Other'])
    expect(nameOf.get('e')).toBe('e')
  })
})

describe('journalFiltersOf', () => {
  test('defaults to the free-standing entries and no filter', () => {
    expect(journalFiltersOf({})).toEqual({ filters: { entity_types: ['time', 'day'] } })
  })

  test('parses every filter', () => {
    const id = '00000000-0000-4000-8000-000000000001'
    expect(
      journalFiltersOf({
        journal_entity_types: 'time,activity',
        journal_q: 'long walk',
        journal_related_id: id,
        journal_related_type: 'person',
        journal_tags: 'travel, family',
      }),
    ).toEqual({
      filters: {
        entity_types: ['time', 'activity'],
        related: { entity_id: id, entity_type: 'person' },
        tags: ['travel', 'family'],
        text: { prefix: 'walk', websearch: 'long' },
      },
    })
  })

  test('refuses what the notes search refuses', () => {
    expect(journalFiltersOf({ journal_tags: 'not a tag!' })).toHaveProperty('error')
    expect(journalFiltersOf({ journal_entity_types: 'note' })).toHaveProperty('error')
    expect(journalFiltersOf({ journal_related_type: 'person' })).toEqual({
      error: 'related_type and related_id go together',
    })
    expect(journalFiltersOf({ journal_related_id: 'x', journal_related_type: 'person' })).toEqual({
      error: 'Not a UUID: x',
    })
  })
})
