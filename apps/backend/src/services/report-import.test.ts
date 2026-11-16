import { describe, expect, test } from 'vitest'

import type { ImportCell } from './report-import-parse.ts'

import { loadMetricCatalog } from './metric-catalog.ts'
import {
  type ExistingReport,
  MAX_RESPONSE_ROWS,
  orderedRows,
  planImport,
  summarize,
} from './report-import.ts'

const catalog = loadMetricCatalog()

const cell = (row: number, date: string, metric: string, value: number, unit?: string): ImportCell => ({
  date,
  metric,
  row,
  value,
  ...(unit ? { unit } : {}),
})

const table = (cells: ImportCell[]) => ({ cells, errors: [], skipped: [] })

describe('planImport', () => {
  test('groups the new results into one report per date', () => {
    const plan = planImport(
      table([
        cell(2, '2026-03-01', 'Hb', 145, 'g/L'),
        cell(3, '2026-03-01', 'Ferritin', 40, 'µg/L'),
        cell(4, '2026-06-15', 'Hb', 140, 'g/L'),
      ]),
      [],
      'blood_panel',
      [],
      catalog,
    )
    expect(plan.dates.map((d) => [d.date, d.entries.map((e) => e.metric), d.update])).toEqual([
      ['2026-03-01', ['Hb', 'Ferritin'], undefined],
      ['2026-06-15', ['Hb'], undefined],
    ])
    expect(plan.rows.map((r) => r.status)).toEqual(['new', 'new', 'new'])
    expect(summarize(plan.rows, plan.dates)).toEqual({
      entries_existing: 0,
      entries_new: 3,
      errors: 0,
      reports_new: 2,
      reports_updated: 0,
    })
  })

  test('a result the user already has on that date, under any alias and report type, exists', () => {
    const existing: ExistingReport[] = [
      {
        date: '2026-03-01',
        entries: [{ metric: 'hemoglobin', unit: 'g/L', value: 145 }],
        id: 'r1',
        report_type: 'other_type',
      },
    ]
    const plan = planImport(
      table([cell(2, '2026-03-01', 'Hb', 145, 'g/L')]),
      existing,
      'blood_panel',
      [],
      catalog,
    )
    expect(plan.dates).toEqual([])
    expect(plan.rows).toEqual([
      { date: '2026-03-01', metric: 'Hb', row: 2, status: 'exists', unit: 'g/L', value: 145 },
    ])
  })

  test('new results for a date with a report of the same type are added to it', () => {
    const existing: ExistingReport[] = [
      {
        date: '2026-03-01',
        entries: [{ metric: 'hemoglobin', unit: 'g/L', value: 145 }],
        id: 'r1',
        report_type: 'blood_panel',
      },
    ]
    const plan = planImport(
      table([cell(2, '2026-03-01', 'Hb', 145, 'g/L'), cell(3, '2026-03-01', 'Ferritin', 40, 'µg/L')]),
      existing,
      'blood_panel',
      [],
      catalog,
    )
    expect(plan.dates).toHaveLength(1)
    expect(plan.dates[0].update?.id).toBe('r1')
    expect(plan.dates[0].entries.map((e) => e.metric)).toEqual(['hemoglobin', 'Ferritin'])
    expect(summarize(plan.rows, plan.dates)).toMatchObject({
      entries_existing: 1,
      entries_new: 1,
      reports_updated: 1,
    })
  })

  test('a date the service would refuse is an error on all its rows and does not block other dates', () => {
    const plan = planImport(
      table([
        cell(2, '2026-03-01', 'Hb', 145, 'g/L'),
        cell(3, '2026-03-01', 'LDL', 3, 'furlongs'),
        cell(4, '2026-06-15', 'Hb', 140, 'g/L'),
      ]),
      [],
      'blood_panel',
      [],
      catalog,
    )
    expect(plan.dates.map((d) => d.date)).toEqual(['2026-06-15'])
    const refused = plan.rows.filter((r) => r.date === '2026-03-01')
    expect(refused.map((r) => r.status)).toEqual(['error', 'error'])
    expect(refused[0].error).toContain('furlongs')
  })

  test('the same catalogue metric twice on a date refuses that date', () => {
    const plan = planImport(
      table([cell(2, '2026-03-01', 'Hb', 145, 'g/L'), cell(3, '2026-03-01', 'hemoglobin', 140, 'g/L')]),
      [],
      'blood_panel',
      [],
      catalog,
    )
    expect(plan.dates).toEqual([])
    expect(plan.rows.every((r) => r.status === 'error' && r.error?.includes('same metric'))).toBe(true)
  })

  test('a metric outside the catalogue listed twice is an error on the second', () => {
    const plan = planImport(
      table([cell(2, '2026-03-01', 'Zonulin', 1, 'ng/mL'), cell(3, '2026-03-01', 'Zonulin', 2, 'ng/mL')]),
      [],
      'blood_panel',
      [],
      catalog,
    )
    expect(plan.dates[0].entries).toHaveLength(1)
    expect(plan.rows.map((r) => r.status)).toEqual(['new', 'error'])
  })

  test('without a unit the catalogue unit is used, and a metric it does not know is an error', () => {
    const plan = planImport(
      table([cell(2, '2026-03-01', 'Hb', 145), cell(3, '2026-03-01', 'Zonulin', 1)]),
      [],
      'blood_panel',
      [],
      catalog,
    )
    expect(plan.dates[0].entries).toEqual([{ metric: 'Hb', unit: 'g/L', value: 145 }])
    expect(plan.rows[1]).toMatchObject({ error: 'No unit for "Zonulin": add a unit column', status: 'error' })
  })

  test('keeps the extraction errors and skipped rows', () => {
    const plan = planImport(
      { cells: [], errors: [{ error: 'Not a number: <0,2', metric: 'CRP', row: 4 }], skipped: [{ row: 5 }] },
      [],
      'blood_panel',
      [],
      catalog,
    )
    expect(plan.rows).toEqual([
      { error: 'Not a number: <0,2', metric: 'CRP', row: 4, status: 'error' },
      { row: 5, status: 'skipped' },
    ])
  })
})

describe('orderedRows', () => {
  test('puts errors first and caps the list', () => {
    const rows = [
      ...Array.from({ length: MAX_RESPONSE_ROWS }, (_, i) => ({ row: i + 2, status: 'new' as const })),
      { error: 'x', row: 9999, status: 'error' as const },
    ]
    const ordered = orderedRows(rows)
    expect(ordered.truncated).toBe(true)
    expect(ordered.rows).toHaveLength(MAX_RESPONSE_ROWS)
    expect(ordered.rows[0]).toMatchObject({ row: 9999, status: 'error' })
  })
})
