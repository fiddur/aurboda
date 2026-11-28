import { describe, expect, test } from 'vitest'

import {
  activityBreakdownSql,
  breakdownRowPeople,
  breakdownSeriesKeys,
  personSeriesLabels,
  stablePersonSeriesLabels,
} from './people-breakdown.ts'

const person = (id: string, name: string, created: string) => ({ created_at: new Date(created), id, name })

describe('personSeriesLabels', () => {
  test('labels each person by name', () => {
    const labels = personSeriesLabels([person('a', 'Anna', '2026-01-01'), person('b', 'Bo', '2026-01-02')])
    expect(labels).toEqual(
      new Map([
        ['a', 'Anna'],
        ['b', 'Bo'],
      ]),
    )
  })

  test('suffixes the later of same-named people by creation, then id', () => {
    const labels = personSeriesLabels([
      person('z', 'Anna', '2026-03-01'),
      person('y', 'Anna', '2026-01-01'),
      person('x', 'Anna', '2026-03-01'),
      person('y', 'Anna', '2026-01-01'),
    ])
    expect(labels).toEqual(
      new Map([
        ['y', 'Anna'],
        ['x', 'Anna (2)'],
        ['z', 'Anna (3)'],
      ]),
    )
  })
})

describe('stablePersonSeriesLabels', () => {
  test('ranks over every namesake in the account, not only the people given', async () => {
    const earlier = person('e', 'Anna', '2026-01-01')
    const later = person('l', 'Anna', '2026-02-01')
    const bo = person('b', 'Bo', '2026-01-15')
    const asked: string[][] = []
    const labels = await stablePersonSeriesLabels('user', [later, bo], async (_user, names) => {
      asked.push(names)
      return [earlier, later, bo]
    })
    expect(asked).toEqual([['Anna', 'Bo']])
    expect(labels.get('l')).toBe('Anna (2)')
    expect(labels.get('b')).toBe('Bo')
  })

  test('looks nothing up when there are no people', async () => {
    const labels = await stablePersonSeriesLabels('user', [], () => {
      throw new Error('looked up')
    })
    expect(labels).toEqual(new Map())
  })
})

describe('activityBreakdownSql', () => {
  test('refuses a field that is neither a data field nor @people', () => {
    expect(activityBreakdownSql(["x'; drop"], 'a')).toBeUndefined()
    expect(activityBreakdownSql(['@other'], 'a')).toBeUndefined()
  })

  test('joins the people only for @people', () => {
    expect(activityBreakdownSql(['mood'], 'a')).toEqual({
      columns: ["COALESCE(a.data->>'mood', '(none)') AS field_0"],
      groupBy: ['field_0'],
      join: '',
    })
    const people = activityBreakdownSql(['mood', '@people'], 'a')
    expect(people?.groupBy).toEqual(['field_0', 'field_1_id', 'field_1', 'field_1_created'])
    expect(people?.join).toContain('LEFT JOIN LATERAL')
  })

  test('a data field named people is a data field', () => {
    expect(activityBreakdownSql(['people'], 'a')?.join).toBe('')
  })
})

describe('breakdownSeriesKeys', () => {
  const created = new Date('2026-01-01')
  const later = new Date('2026-02-01')
  const rows = [
    { field_0: 'happy', field_1: 'Anna', field_1_created: created, field_1_id: 'a1' },
    { field_0: 'happy', field_1: 'Anna', field_1_created: later, field_1_id: 'a2' },
    { field_0: 'sad', field_1: null, field_1_created: null, field_1_id: null },
  ]

  test('the people of the @people columns', () => {
    expect(breakdownRowPeople(rows, ['mood', '@people'])).toEqual([
      { created_at: created, id: 'a1', name: 'Anna' },
      { created_at: later, id: 'a2', name: 'Anna' },
    ])
    expect(breakdownRowPeople(rows, ['mood', 'other'])).toEqual([])
  })

  test('labels people, (none) for no one, joined with the other fields in order', () => {
    const labels = new Map([
      ['a1', 'Anna'],
      ['a2', 'Anna (2)'],
    ])
    expect(breakdownSeriesKeys(rows, ['mood', '@people'], labels)).toEqual([
      'happy / Anna',
      'happy / Anna (2)',
      'sad / (none)',
    ])
  })
})
