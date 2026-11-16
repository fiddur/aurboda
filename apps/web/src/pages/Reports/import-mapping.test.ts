import { describe, expect, test } from 'vitest'

import {
  guessMapping,
  guessRole,
  mappingFits,
  mappingFromRoles,
  missingRoles,
  rolesFromMapping,
  setRole,
  sortRows,
  startingMapping,
  summaryText,
  switchLayout,
} from './import-mapping'

describe('guessRole', () => {
  test.each([
    ['Datum', 'date'],
    ['Date', 'date'],
    ['Analys', 'metric'],
    ['Komponent', 'metric'],
    ['Test name', 'metric'],
    ['Resultat', 'value'],
    ['Värde', 'value'],
    ['Enhet', 'unit'],
    ['Referensintervall', 'reference_range'],
    ['Ref.', 'reference_range'],
    ['Reference low', 'reference_low'],
    ['Max', 'reference_high'],
  ])('%s is %s', (header, role) => {
    expect(guessRole(header)).toBe(role)
  })

  test('an unknown header has no role', () => {
    expect(guessRole('Kommentar')).toBeUndefined()
  })
})

describe('guessMapping', () => {
  test('a sheet with a date column is long', () => {
    expect(guessMapping(['Datum', 'Analys', 'Resultat', 'Enhet', 'Referens', 'Kommentar'])).toEqual({
      layout: 'long',
      roles: ['date', 'metric', 'value', 'unit', 'reference_range', 'ignore'],
    })
  })

  test('a sheet with dates in the header is wide', () => {
    expect(guessMapping(['Analys', 'Enhet', '2026-03-01', '15/6-26'])).toEqual({
      layout: 'wide',
      roles: ['metric', 'unit', 'date_column', 'date_column'],
    })
  })

  test('takes each single role once', () => {
    expect(guessMapping(['Test', 'Analys', 'Value']).roles).toEqual(['metric', 'ignore', 'value'])
  })
})

const options = { date_order: 'dmy' as const, has_header: true }

describe('mappingFromRoles', () => {
  test('long needs date, test name and value', () => {
    expect(
      mappingFromRoles(['date', 'metric', 'value', 'unit', 'ignore'], { ...options, layout: 'long' }),
    ).toEqual({ ...options, date: 0, layout: 'long', metric: 1, unit: 3, value: 2 })
    expect(mappingFromRoles(['date', 'metric'], { ...options, layout: 'long' })).toBeUndefined()
    expect(missingRoles(['date', 'metric'], 'long')).toBe('Choose a column for: value')
  })

  test('wide needs a test name and a date column', () => {
    expect(
      mappingFromRoles(['metric', 'reference_range', 'date_column', 'date_column'], {
        ...options,
        layout: 'wide',
      }),
    ).toEqual({ ...options, date_columns: [2, 3], layout: 'wide', metric: 0, reference_range: 1 })
    expect(missingRoles(['metric'], 'wide')).toBe('Choose a column for: results on this date')
  })

  test('round-trips through rolesFromMapping', () => {
    const roles = ['metric', 'unit', 'date_column', 'ignore'] as const
    const mapping = mappingFromRoles([...roles], { ...options, layout: 'wide' })!
    expect(rolesFromMapping(mapping, 4)).toEqual(roles)
    expect(mappingFits(mapping, 4)).toBe(true)
    expect(mappingFits(mapping, 2)).toBe(false)
  })
})

describe('setRole and switchLayout', () => {
  test('a single role moves from the column that had it', () => {
    expect(setRole(['metric', 'ignore'], 1, 'metric')).toEqual(['ignore', 'metric'])
    expect(setRole(['date_column', 'ignore'], 1, 'date_column')).toEqual(['date_column', 'date_column'])
  })

  test('switching layout drops roles the other layout has no use for', () => {
    const header = ['Datum', 'Analys', 'Resultat', '2026-03-01']
    expect(switchLayout(['date', 'metric', 'value', 'ignore'], header, 'wide', 'dmy')).toEqual([
      'ignore',
      'metric',
      'ignore',
      'date_column',
    ])
    expect(switchLayout(['ignore', 'metric', 'ignore', 'date_column'], header, 'long', 'dmy')).toEqual([
      'ignore',
      'metric',
      'ignore',
      'ignore',
    ])
  })
})

describe('summaryText', () => {
  test('counts new results, reports, existing and errors', () => {
    expect(
      summaryText({ entries_existing: 40, entries_new: 12, errors: 2, reports_new: 2, reports_updated: 1 }),
    ).toBe('12 new results in 3 reports, 40 already imported, 2 rows with errors')
  })

  test('says when nothing is new', () => {
    expect(
      summaryText({ entries_existing: 3, entries_new: 0, errors: 1, reports_new: 0, reports_updated: 0 }),
    ).toBe('Nothing new to import, 3 already imported, 1 row with errors')
  })
})

test('sortRows puts errors first', () => {
  expect(
    sortRows([
      { row: 2, status: 'new' },
      { row: 5, status: 'error' },
      { row: 3, status: 'exists' },
    ]).map((r) => r.row),
  ).toEqual([5, 2, 3])
})

describe('startingMapping', () => {
  const wide = [
    ['Analys', 'Enhet', '2026-03-01', '1/6-26', '15.9.2026'],
    ['Hb', 'g/L', '145', '139', '142'],
  ]
  const rememberedWide = {
    date_columns: [2, 3],
    date_order: 'dmy' as const,
    has_header: true,
    layout: 'wide' as const,
    metric: 0,
    unit: 1,
  }

  test('a remembered wide mapping picks up a date column added since', () => {
    expect(startingMapping(wide, rememberedWide)).toEqual({
      date_order: 'dmy',
      has_header: true,
      layout: 'wide',
      roles: ['metric', 'unit', 'date_column', 'date_column', 'date_column'],
    })
  })

  test('a remembered mapping of the other layout is not used', () => {
    const rememberedLong = {
      date: 0,
      date_order: 'dmy' as const,
      has_header: true,
      layout: 'long' as const,
      metric: 1,
      value: 2,
    }
    expect(startingMapping(wide, rememberedLong).roles).toEqual([
      'metric',
      'unit',
      'date_column',
      'date_column',
      'date_column',
    ])
  })

  test('without a remembered mapping the header is guessed', () => {
    expect(startingMapping([['Datum', 'Analys', 'Resultat']], null)).toEqual({
      date_order: 'dmy',
      has_header: true,
      layout: 'long',
      roles: ['date', 'metric', 'value'],
    })
  })
})
