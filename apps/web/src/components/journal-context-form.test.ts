import type { JournalContextItem } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { addItem, itemProblem, moveItem, nextItemId, removeItem, withKind } from './journal-context-form'

const moon = (id: string): JournalContextItem => ({
  decimals: 0,
  id,
  kind: 'moon',
  label: '',
  value: 'illumination',
})

describe('journal context form', () => {
  test('new items get the first free id', () => {
    expect(nextItemId([])).toBe('c1')
    expect(nextItemId([moon('c1'), moon('c3')])).toBe('c2')
    expect(addItem([moon('c1')], 'metric')).toEqual([
      moon('c1'),
      { decimals: 0, id: 'c2', kind: 'metric', label: '', metric: '', missing: 'hide' },
    ])
  })

  test('changing the kind keeps the id, label and decimals', () => {
    expect(withKind({ decimals: 2, id: 'a', label: 'E' }, 'days_since')).toEqual({
      decimals: 2,
      id: 'a',
      kind: 'days_since',
      label: 'E',
      pattern: '',
      source_type: 'activity_type',
      unit: 'days',
    })
  })

  test('moves and removes items', () => {
    const items = [moon('a'), moon('b'), moon('c')]
    expect(moveItem(items, 0, 1).map((i) => i.id)).toEqual(['b', 'a', 'c'])
    expect(moveItem(items, 0, -1).map((i) => i.id)).toEqual(['a', 'b', 'c'])
    expect(moveItem(items, 2, 1).map((i) => i.id)).toEqual(['a', 'b', 'c'])
    expect(removeItem(items, 1).map((i) => i.id)).toEqual(['a', 'c'])
  })

  test('names what an item still lacks', () => {
    expect(itemProblem(moon('a'))).toBeUndefined()
    expect(itemProblem(withKind({ decimals: 0, id: 'a', label: '' }, 'metric'))).toBe('Choose a metric')
    const date: JournalContextItem = {
      decimals: 1,
      id: 'a',
      kind: 'days_since',
      label: 'A',
      source_type: 'date',
      unit: 'years',
    }
    expect(itemProblem(date)).toBe('Choose a date')
    expect(itemProblem({ ...date, date: '1980-05-17' })).toBeUndefined()
  })
})
