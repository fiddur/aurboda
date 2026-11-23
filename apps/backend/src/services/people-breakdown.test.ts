import { describe, expect, test } from 'vitest'

import { activityBreakdownSql, breakdownSeriesKeys, personSeriesLabels } from './people-breakdown.ts'

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
  test('labels people, (none) for no one, joined with the other fields in order', () => {
    const created = new Date('2026-01-01')
    const later = new Date('2026-02-01')
    const rows = [
      { field_0: 'happy', field_1: 'Anna', field_1_created: created, field_1_id: 'a1' },
      { field_0: 'happy', field_1: 'Anna', field_1_created: later, field_1_id: 'a2' },
      { field_0: 'sad', field_1: null, field_1_created: null, field_1_id: null },
    ]
    expect(breakdownSeriesKeys(rows, ['mood', '@people'])).toEqual([
      'happy / Anna',
      'happy / Anna (2)',
      'sad / (none)',
    ])
  })
})
