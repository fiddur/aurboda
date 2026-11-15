import type { ReportImportMapping } from '@aurboda/api-spec'

import { detectDelimiter, parseDelimited, parseImportDate, parseTable } from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

import {
  extractCells,
  parseImportNumber,
  parseReferenceRange,
  wideDateColumns,
} from './report-import-parse.ts'

describe('detectDelimiter', () => {
  test('a paste from a spreadsheet is tab-separated', () => {
    expect(detectDelimiter('Datum\tAnalys\tResultat\n2026-03-01\tHb\t3,5')).toBe('\t')
  })

  test('a Swedish CSV export uses semicolons, with decimal commas', () => {
    expect(detectDelimiter('Datum;Analys;Resultat\n2026-03-01;Hb;3,5')).toBe(';')
  })

  test('falls back to comma', () => {
    expect(detectDelimiter('date,test,value\n2026-03-01,Hb,145')).toBe(',')
  })

  test('ignores delimiters inside quotes', () => {
    expect(detectDelimiter('date,"a;b",value\n2026-03-01,Hb,145')).toBe(',')
  })
})

describe('parseDelimited', () => {
  test('handles quoted fields with delimiters, doubled quotes and line breaks', () => {
    expect(parseDelimited('a,"b,c","say ""hi""","two\nlines"\r\nd,e,f,g\n', ',')).toEqual([
      ['a', 'b,c', 'say "hi"', 'two\nlines'],
      ['d', 'e', 'f', 'g'],
    ])
  })

  test('keeps empty cells and drops trailing blank lines', () => {
    expect(parseDelimited('a\t\tc\n\t\t\n\n', '\t')).toEqual([['a', '', 'c']])
  })

  test('parseTable strips a UTF-8 BOM', () => {
    expect(parseTable('﻿Datum;Hb\n2026-03-01;145')).toEqual([
      ['Datum', 'Hb'],
      ['2026-03-01', '145'],
    ])
  })
})

describe('parseImportDate', () => {
  test.each([
    ['2026-03-01', '2026-03-01'],
    ['2026/03/01', '2026-03-01'],
    ['2026.3.1', '2026-03-01'],
    ['1/3/2026', '2026-03-01'],
    ['1.3.2026', '2026-03-01'],
    ['1/3 2026', '2026-03-01'],
    ['1/3-26', '2026-03-01'],
    ['01-03-2026', '2026-03-01'],
  ])('%s reads as %s (day first)', (raw, expected) => {
    expect(parseImportDate(raw, 'dmy')).toBe(expected)
  })

  test('mdy reads the month first', () => {
    expect(parseImportDate('1/3/2026', 'mdy')).toBe('2026-01-03')
  })

  test('a part over 12 is the day, whatever the order', () => {
    expect(parseImportDate('3/25/2026', 'dmy')).toBe('2026-03-25')
    expect(parseImportDate('25/3/2026', 'mdy')).toBe('2026-03-25')
  })

  test.each(['1 mars 2026', 'March 1, 2026', '2026-02-30', '', 'Hb'])('%s is not a date', (raw) => {
    expect(parseImportDate(raw, 'dmy')).toBeUndefined()
  })
})

describe('parseImportNumber', () => {
  test.each([
    ['3,5', 3.5],
    ['3.5', 3.5],
    ['1 234,5', 1234.5],
    ['1 234,5', 1234.5],
    ['1 234', 1234],
    ['1.234,5', 1234.5],
    ['1,234.5', 1234.5],
    ['1.234.567', 1234567],
    ['-0,5', -0.5],
    ['145', 145],
  ])('%s reads as %d', (raw, expected) => {
    expect(parseImportNumber(raw)).toBe(expected)
  })

  test.each(['<0,2', '>100', 'neg', '3,5 g/L', '', '-'])('%s is not a number', (raw) => {
    expect(parseImportNumber(raw)).toBeUndefined()
  })
})

describe('parseReferenceRange', () => {
  test.each([
    ['3,5-5,0', { reference_high: 5, reference_low: 3.5 }],
    ['3.5 – 5.0', { reference_high: 5, reference_low: 3.5 }],
    ['< 5', { reference_high: 5 }],
    ['>1,0', { reference_low: 1 }],
    ['normal', {}],
    ['', {}],
  ])('%s', (raw, expected) => {
    expect(parseReferenceRange(raw)).toEqual(expected)
  })
})

const longMapping: ReportImportMapping = {
  date: 0,
  date_order: 'dmy',
  has_header: true,
  layout: 'long',
  metric: 1,
  reference_range: 4,
  unit: 3,
  value: 2,
}

describe('extractCells (long)', () => {
  test('reads one result per row, with errors per row', () => {
    const records = parseTable(
      [
        'Datum;Analys;Resultat;Enhet;Referens',
        '1/3-26;Hb;145;g/L;117-153',
        '2026-03-01;Ferritin;<10;µg/L;',
        ';;;;',
        ';;12;;',
        'mars 2026;CRP;3;mg/L;<5',
        'Datum;Analys;Resultat;Enhet;Referens',
        '2026-03-01;LDL;;mmol/L;',
        '2026-03-01;LDL;3,1;;< 3,0',
      ].join('\n'),
    )
    expect(extractCells(records, longMapping)).toEqual({
      cells: [
        {
          date: '2026-03-01',
          metric: 'Hb',
          reference_high: 153,
          reference_low: 117,
          row: 2,
          unit: 'g/L',
          value: 145,
        },
        { date: '2026-03-01', metric: 'LDL', reference_high: 3, row: 9, value: 3.1 },
      ],
      errors: [
        { date: '2026-03-01', error: 'Not a number: <10', metric: 'Ferritin', row: 3 },
        { error: 'Not a date: mars 2026', metric: 'CRP', row: 6 },
        { error: 'Repeated header row', row: 7 },
      ],
      skipped: [{ row: 5 }],
    })
  })

  test('without a header the first row is data', () => {
    const records = parseTable('2026-03-01\tHb\t145')
    const result = extractCells(records, {
      ...longMapping,
      has_header: false,
      reference_range: undefined,
      unit: undefined,
    })
    expect(result).toEqual({
      cells: [{ date: '2026-03-01', metric: 'Hb', row: 1, value: 145 }],
      errors: [],
      skipped: [],
    })
  })

  test('separate low and high columns win over a range column', () => {
    const records = parseTable('d;t;v;u;r;lo;hi\n2026-03-01;Hb;145;g/L;100-200;117;153')
    const result = extractCells(records, { ...longMapping, reference_high: 6, reference_low: 5 })
    expect('cells' in result && result.cells[0]).toMatchObject({ reference_high: 153, reference_low: 117 })
  })
})

const wideMapping: ReportImportMapping = {
  date_order: 'dmy',
  has_header: true,
  layout: 'wide',
  metric: 0,
  reference_range: 2,
  unit: 1,
}

describe('extractCells (wide)', () => {
  const sheet = [
    'Analys\tEnhet\tReferens\t1/3-26\t15.6.2026\tKommentar',
    'Hb\tg/L\t117-153\t145\t\t',
    'Ferritin\tµg/L\t\t40\tneg\tlow',
    '\t\t\t\t\t',
  ].join('\n')

  test('reads one result per date column and skips empty cells', () => {
    expect(extractCells(parseTable(sheet), wideMapping)).toEqual({
      cells: [
        {
          column: 3,
          date: '2026-03-01',
          metric: 'Hb',
          reference_high: 153,
          reference_low: 117,
          row: 2,
          unit: 'g/L',
          value: 145,
        },
        { column: 3, date: '2026-03-01', metric: 'Ferritin', row: 3, unit: 'µg/L', value: 40 },
      ],
      errors: [{ column: 4, date: '2026-06-15', error: 'Not a number: neg', metric: 'Ferritin', row: 3 }],
      skipped: [],
    })
  })

  test('needs a header row', () => {
    expect(extractCells(parseTable(sheet), { ...wideMapping, has_header: false })).toEqual({
      error: 'A wide sheet needs a header row with the dates',
    })
  })

  test('chosen date columns must have a date header', () => {
    const header = parseTable(sheet)[0]
    expect(wideDateColumns(header, { ...wideMapping, date_columns: [3] })).toEqual({
      columns: [{ column: 3, date: '2026-03-01' }],
    })
    expect(wideDateColumns(header, { ...wideMapping, date_columns: [5] })).toEqual({
      error: 'The header of column 6 is not a date: "Kommentar"',
    })
  })

  test('a sheet without any date header is refused', () => {
    expect(wideDateColumns(['Analys', 'Värde'], wideMapping)).toEqual({
      error: 'No column header reads as a date',
    })
  })
})
