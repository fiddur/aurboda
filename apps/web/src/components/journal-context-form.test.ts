import type { JournalContextItem } from '@aurboda/api-spec'

import { journalContextItemSchema } from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

import {
  addItem,
  type ContextKind,
  itemProblem,
  moveItem,
  nextItemId,
  removeItem,
  withDaysSinceSource,
  withKind,
} from './journal-context-form'

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
      source_type: 'activity_type',
      unit: 'days',
    })
  })

  test('switching what time is counted from drops the field that no longer applies', () => {
    const since = withKind({ decimals: 0, id: 'a', label: 'A' }, 'days_since')
    if (since.kind !== 'days_since') throw new Error('not days_since')
    const fromActivity = { ...since, pattern: 'run' }
    const fromDate = withDaysSinceSource(fromActivity, 'date')
    expect(fromDate).not.toHaveProperty('pattern')
    expect(fromDate.source_type).toBe('date')
    const dated = { ...fromDate, date: '1980-05-17' }
    expect(withDaysSinceSource(dated, 'tag')).not.toHaveProperty('date')
  })

  const completions: Record<ContextKind, (item: JournalContextItem) => JournalContextItem> = {
    days_since: (item) => ({ ...item, pattern: 'run' }) as JournalContextItem,
    metric: (item) => ({ ...item, metric: 'weight' }) as JournalContextItem,
    moon: (item) => item,
    trend: (item) => ({ ...item, pattern: 'run' }) as JournalContextItem,
  }

  test.each(Object.keys(completions) as ContextKind[])(
    'a completed %s item from withKind is one the server accepts',
    (kind) => {
      const completed = completions[kind](withKind({ decimals: 1, id: 'a', label: 'A' }, kind))
      expect(itemProblem(completed)).toBeUndefined()
      expect(journalContextItemSchema.safeParse(completed).success).toBe(true)
    },
  )

  test('a completed fixed-date item is one the server accepts', () => {
    const since = withKind({ decimals: 1, id: 'a', label: 'A' }, 'days_since')
    if (since.kind !== 'days_since') throw new Error('not days_since')
    const fromDate = {
      ...withDaysSinceSource({ ...since, pattern: 'run' }, 'date'),
      date: '1980-05-17',
      unit: 'years' as const,
    }
    expect(itemProblem(fromDate)).toBeUndefined()
    expect(journalContextItemSchema.safeParse(fromDate).success).toBe(true)
    expect(journalContextItemSchema.safeParse(withDaysSinceSource(fromDate, 'tag')).success).toBe(false)
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
