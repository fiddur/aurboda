import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../db/index.ts'
import { loadMetricCatalog } from './metric-catalog.ts'
import {
  addReport,
  deleteReportById,
  getLatestMetric,
  getReport,
  prepareReportEntries,
  queryReports,
  updateReport,
} from './reports.ts'

const TX = vi.hoisted(() => ({ tx: true }))

vi.mock('../db', () => ({
  adoptCatalogMetric: vi.fn(),
  deleteNotesForEntityIn: vi.fn(),
  getCustomMetricDefinitions: vi.fn().mockResolvedValue([]),
  deleteReport: vi.fn(),
  getLatestMetricValue: vi.fn(),
  getReportById: vi.fn(),
  getReportEntryMetrics: vi.fn(),
  getReports: vi.fn(),
  insertReport: vi.fn(),
  insertTimeSeries: vi.fn(),
  query: vi.fn(),
  updateNoteTimesForEntity: vi.fn(),
  updateReport: vi.fn(),
  withUserTransaction: vi.fn((_user: string, fn: (tx: unknown) => Promise<unknown>) => fn(TX)),
}))

const mockInsertReport = vi.mocked(db.insertReport)
const mockInsertTimeSeries = vi.mocked(db.insertTimeSeries)
const mockGetReportById = vi.mocked(db.getReportById)
const mockGetReports = vi.mocked(db.getReports)
const mockDeleteReport = vi.mocked(db.deleteReport)
const mockGetReportEntryMetrics = vi.mocked(db.getReportEntryMetrics)
const mockGetLatestMetricValue = vi.mocked(db.getLatestMetricValue)
const mockQuery = vi.mocked(db.query)
const mockUpdateReport = vi.mocked(db.updateReport)
const mockUpdateNoteTimesForEntity = vi.mocked(db.updateNoteTimesForEntity)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('addReport', () => {
  test('creates report and writes through to time_series', async () => {
    const mockReport = {
      created_at: new Date('2025-05-08T10:00:00Z'),
      entries: [
        {
          confidence: 'measured' as const,
          id: 'entry-1',
          method: 'bia_segmental',
          metric: 'weight',
          report_id: 'report-1',
          unit: 'kg',
          value: 99.5,
        },
        {
          confidence: 'measured' as const,
          id: 'entry-2',
          method: 'bia_segmental',
          metric: 'body_fat',
          report_id: 'report-1',
          unit: '%',
          value: 17.5,
        },
      ],
      id: 'report-1',
      location: 'Genki gym',
      notes: 'Clean scan',
      report_date: new Date('2025-05-08T09:23:00Z'),
      report_type: 'inbody',
    }

    mockInsertReport.mockResolvedValue(mockReport)

    const result = await addReport('testuser', {
      date: '2025-05-08T09:23:00Z',
      entries: [
        { confidence: 'measured', method: 'bia_segmental', metric: 'weight', unit: 'kg', value: 99.5 },
        { confidence: 'measured', method: 'bia_segmental', metric: 'body_fat', unit: '%', value: 17.5 },
      ],
      location: 'Genki gym',
      notes: 'Clean scan',
      report_type: 'inbody',
    })

    expect(result.success).toBe(true)
    expect(result.data).toBeDefined()
    expect(result.data!.id).toBe('report-1')
    expect(result.data!.report_type).toBe('inbody')
    expect(result.data!.entries).toHaveLength(2)

    expect(mockInsertTimeSeries).toHaveBeenCalledWith('testuser', [
      {
        metric: 'weight',
        source: 'lab_report',
        time: new Date('2025-05-08T09:23:00Z'),
        unit: 'kg',
        value: 99.5,
      },
      {
        metric: 'body_fat',
        source: 'lab_report',
        time: new Date('2025-05-08T09:23:00Z'),
        unit: '%',
        value: 17.5,
      },
    ])

    // DB insertReport should NOT receive value/unit in entries (those go only to time_series)
    const insertCall = mockInsertReport.mock.calls[0][1]
    for (const entry of insertCall.entries) {
      expect(entry).not.toHaveProperty('value')
      expect(entry).not.toHaveProperty('unit')
    }
  })

  test('auto-derives flag from reference range when not set', async () => {
    mockInsertReport.mockImplementation(async (_user, input) => ({
      created_at: new Date(),
      entries: input.entries.map((e, i) => ({
        confidence: e.confidence as 'measured' | 'estimated' | 'derived' | undefined,
        flag: e.flag as 'critical_low' | 'low' | 'normal' | 'high' | 'critical_high' | undefined,
        id: `entry-${i}`,
        method: e.method,
        metric: e.metric,
        reference_high: e.reference_high,
        reference_low: e.reference_low,
        report_id: 'report-1',
        unit: 'ng/mL',
        value: 45,
      })),
      id: 'report-1',
      report_date: input.report_date,
      report_type: input.report_type,
    }))

    await addReport('testuser', {
      date: '2025-03-15T08:00:00Z',
      entries: [
        { metric: 'ferritin', reference_high: 200, reference_low: 20, unit: 'ng/mL', value: 45 },
        { metric: 'iron', reference_high: 170, reference_low: 60, unit: 'ug/dL', value: 250 },
        { metric: 'b12', reference_high: 900, reference_low: 200, unit: 'pg/mL', value: 100 },
      ],
      report_type: 'blood_panel',
    })

    const insertCall = mockInsertReport.mock.calls[0][1]
    expect(insertCall.entries[0].flag).toBe('normal') // 45 is within [20, 200]
    expect(insertCall.entries[1].flag).toBe('high') // 250 is above 170
    expect(insertCall.entries[2].flag).toBe('low') // 100 is below 200
  })
})

describe('getReport', () => {
  test('returns formatted report when found', async () => {
    mockGetReportById.mockResolvedValue({
      created_at: new Date('2025-05-08T10:00:00Z'),
      entries: [{ id: 'e1', metric: 'weight', report_id: 'report-1', unit: 'kg', value: 99.5 }],
      id: 'report-1',
      location: 'Genki gym',
      report_date: new Date('2025-05-08T09:23:00Z'),
      report_type: 'inbody',
    })

    const result = await getReport('testuser', 'report-1')

    expect(result.success).toBe(true)
    expect(result.data!.date).toBe('2025-05-08T09:23:00.000Z')
    expect(result.data!.entries[0].metric).toBe('weight')
  })

  test('returns error when not found', async () => {
    mockGetReportById.mockResolvedValue(null)

    const result = await getReport('testuser', 'nonexistent')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Report not found')
    expect(db.deleteNotesForEntityIn).not.toHaveBeenCalled()
  })
})

describe('queryReports', () => {
  test('returns formatted reports', async () => {
    mockGetReports.mockResolvedValue([
      {
        created_at: new Date('2025-05-08T10:00:00Z'),
        entries: [],
        id: 'report-1',
        report_date: new Date('2025-05-08T09:23:00Z'),
        report_type: 'inbody',
      },
    ])

    const result = await queryReports('testuser', { report_type: 'inbody' })

    expect(result.success).toBe(true)
    expect(result.data).toHaveLength(1)
    expect(result.data![0].report_type).toBe('inbody')
  })

  test('passes date filters to db', async () => {
    mockGetReports.mockResolvedValue([])

    await queryReports('testuser', {
      end: '2025-12-31T23:59:59Z',
      start: '2025-01-01T00:00:00Z',
    })

    expect(mockGetReports).toHaveBeenCalledWith('testuser', {
      end: new Date('2025-12-31T23:59:59Z'),
      report_type: undefined,
      start: new Date('2025-01-01T00:00:00Z'),
    })
  })
})

describe('deleteReportById', () => {
  test('deletes report and cleans up time_series', async () => {
    mockGetReportEntryMetrics.mockResolvedValue([
      { metric: 'weight', report_date: new Date('2025-05-08T09:23:00Z') },
      { metric: 'body_fat', report_date: new Date('2025-05-08T09:23:00Z') },
    ])
    mockDeleteReport.mockResolvedValue(true)
    mockQuery.mockResolvedValue({ command: 'DELETE', fields: [], oid: 0, rowCount: 1, rows: [] })

    const result = await deleteReportById('testuser', 'report-1')

    expect(result.success).toBe(true)
    expect(db.withUserTransaction).toHaveBeenCalledWith('testuser', expect.any(Function))
    expect(mockDeleteReport).toHaveBeenCalledWith(TX, 'report-1')
    expect(db.deleteNotesForEntityIn).toHaveBeenCalledWith(TX, 'report', 'report-1')

    // Should clean up time_series entries
    expect(mockQuery).toHaveBeenCalledTimes(2)
    expect(mockQuery).toHaveBeenCalledWith(
      TX,
      `DELETE FROM time_series WHERE metric = $1 AND time = $2 AND source = 'lab_report'`,
      ['weight', new Date('2025-05-08T09:23:00Z')],
    )
  })

  test('returns error when report not found', async () => {
    mockGetReportEntryMetrics.mockResolvedValue([])
    mockDeleteReport.mockResolvedValue(false)

    const result = await deleteReportById('testuser', 'nonexistent')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Report not found')
  })
})

describe('getLatestMetric', () => {
  test('returns the latest metric value', async () => {
    mockGetLatestMetricValue.mockResolvedValue({
      source: 'lab_report',
      time: new Date('2025-05-08T09:23:00Z'),
      unit: 'kg',
      value: 99.5,
    })

    const result = await getLatestMetric('testuser', 'weight')

    expect(result.success).toBe(true)
    expect(result.metric).toBe('weight')
    expect(result.value).toBe(99.5)
    expect(result.unit).toBe('kg')
    expect(result.source).toBe('lab_report')
    expect(result.time).toBe('2025-05-08T09:23:00.000Z')
  })

  test('returns error when no data found', async () => {
    mockGetLatestMetricValue.mockResolvedValue(null)

    const result = await getLatestMetric('testuser', 'nonexistent')

    expect(result.success).toBe(false)
    expect(result.error).toContain('No data found')
  })
})

describe('updateReport', () => {
  const existingReport = {
    created_at: new Date('2025-05-08T10:00:00Z'),
    entries: [
      { id: 'e1', metric: 'weight', report_id: 'r1', unit: 'kg', value: 99.5 },
      { id: 'e2', metric: 'body_fat', report_id: 'r1', unit: '%', value: 17.5 },
    ],
    id: 'r1',
    location: 'Genki gym',
    report_date: new Date('2025-05-08T09:23:00Z'),
    report_type: 'inbody',
  }

  test('updates metadata only — cleans and re-inserts time_series', async () => {
    mockGetReportById.mockResolvedValue(existingReport)
    mockGetReportEntryMetrics.mockResolvedValue([
      { metric: 'weight', report_date: new Date('2025-05-08T09:23:00Z') },
      { metric: 'body_fat', report_date: new Date('2025-05-08T09:23:00Z') },
    ])
    mockUpdateReport.mockResolvedValue({
      ...existingReport,
      location: 'New location',
    })
    mockQuery.mockResolvedValue({ command: 'DELETE', fields: [], oid: 0, rowCount: 1, rows: [] })

    const result = await updateReport('testuser', 'r1', { location: 'New location' })

    expect(result.success).toBe(true)
    expect(mockUpdateReport).toHaveBeenCalledWith('testuser', 'r1', { location: 'New location' })

    // Should clean old time_series and re-insert
    expect(mockQuery).toHaveBeenCalledWith(
      'testuser',
      `DELETE FROM time_series WHERE metric = $1 AND time = $2 AND source = 'lab_report'`,
      ['weight', new Date('2025-05-08T09:23:00Z')],
    )
    expect(mockInsertTimeSeries).toHaveBeenCalled()
  })

  test('replaces entries and updates time_series', async () => {
    mockGetReportById.mockResolvedValue(existingReport)
    mockGetReportEntryMetrics.mockResolvedValue([
      { metric: 'weight', report_date: new Date('2025-05-08T09:23:00Z') },
      { metric: 'body_fat', report_date: new Date('2025-05-08T09:23:00Z') },
    ])
    const updatedReport = {
      ...existingReport,
      entries: [
        { id: 'e3', metric: 'weight', report_id: 'r1', unit: 'kg', value: 100 },
        { id: 'e4', metric: 'skeletal_muscle_mass', report_id: 'r1', unit: 'kg', value: 45 },
      ],
    }
    mockUpdateReport.mockResolvedValue(updatedReport)
    mockQuery.mockResolvedValue({ command: 'DELETE', fields: [], oid: 0, rowCount: 1, rows: [] })

    const result = await updateReport('testuser', 'r1', {
      entries: [
        { metric: 'weight', unit: 'kg', value: 100 },
        { metric: 'skeletal_muscle_mass', unit: 'kg', value: 45 },
      ],
    })

    expect(result.success).toBe(true)

    // DB updateReport should NOT receive value/unit in entries
    const updateCall = mockUpdateReport.mock.calls[0][2]
    for (const entry of updateCall.entries!) {
      expect(entry).not.toHaveProperty('value')
      expect(entry).not.toHaveProperty('unit')
    }

    expect(mockInsertTimeSeries).toHaveBeenCalledWith('testuser', [
      {
        metric: 'weight',
        source: 'lab_report',
        time: new Date('2025-05-08T09:23:00Z'),
        unit: 'kg',
        value: 100,
      },
      {
        metric: 'skeletal_muscle_mass',
        source: 'lab_report',
        time: new Date('2025-05-08T09:23:00Z'),
        unit: 'kg',
        value: 45,
      },
    ])
  })

  test('updates date — syncs note times', async () => {
    mockGetReportById.mockResolvedValue(existingReport)
    mockGetReportEntryMetrics.mockResolvedValue([
      { metric: 'weight', report_date: new Date('2025-05-08T09:23:00Z') },
    ])
    mockUpdateReport.mockResolvedValue({
      ...existingReport,
      report_date: new Date('2025-06-01T10:00:00Z'),
      entries: [{ id: 'e1', metric: 'weight', report_id: 'r1', unit: 'kg', value: 99.5 }],
    })
    mockQuery.mockResolvedValue({ command: 'DELETE', fields: [], oid: 0, rowCount: 1, rows: [] })

    const result = await updateReport('testuser', 'r1', { date: '2025-06-01T10:00:00Z' })

    expect(result.success).toBe(true)

    expect(mockUpdateNoteTimesForEntity).toHaveBeenCalledWith(
      'testuser',
      'report',
      'r1',
      new Date('2025-06-01T10:00:00Z'),
      undefined,
    )
  })

  test('returns error for nonexistent report', async () => {
    mockGetReportById.mockResolvedValue(null)

    const result = await updateReport('testuser', 'nonexistent', { location: 'New' })

    expect(result.success).toBe(false)
    expect(result.error).toBe('Report not found')
  })

  test('auto-derives flags on new entries', async () => {
    mockGetReportById.mockResolvedValue(existingReport)
    mockGetReportEntryMetrics.mockResolvedValue([
      { metric: 'weight', report_date: new Date('2025-05-08T09:23:00Z') },
    ])
    mockUpdateReport.mockResolvedValue({
      ...existingReport,
      entries: [{ id: 'e1', metric: 'ferritin', report_id: 'r1', unit: 'ng/mL', value: 15 }],
    })
    mockQuery.mockResolvedValue({ command: 'DELETE', fields: [], oid: 0, rowCount: 1, rows: [] })

    await updateReport('testuser', 'r1', {
      entries: [{ metric: 'ferritin', reference_high: 200, reference_low: 20, unit: 'ng/mL', value: 15 }],
    })

    const updateCall = mockUpdateReport.mock.calls[0][2]
    expect(updateCall.entries![0].flag).toBe('low') // 15 is below 20
  })
})

describe('prepareReportEntries', () => {
  const catalog = loadMetricCatalog()

  test('resolves an alias, converts to the stored unit and adopts the metric', () => {
    expect(prepareReportEntries([{ metric: 'ldl', unit: 'mg/dL', value: 100 }], [], catalog)).toEqual({
      adopt: [
        {
          aggregation: 'avg',
          description: 'LDL cholesterol',
          include_in_daily_summary: false,
          name: 'ldl_cholesterol',
          unit: 'mmol/L',
        },
      ],
      entries: [
        { metric: 'ldl_cholesterol', series_unit: 'mmol/L', series_value: 2.586, unit: 'mg/dL', value: 100 },
      ],
    })
  })

  test('converts to the unit of the user’s own metric and adopts nothing', () => {
    expect(
      prepareReportEntries(
        [{ metric: 'ferritin', unit: 'µg/L', value: 80 }],
        [{ name: 'ferritin', unit: 'ng/mL' }],
        catalog,
      ),
    ).toEqual({
      adopt: [],
      entries: [{ metric: 'ferritin', series_unit: 'ng/mL', series_value: 80, unit: 'µg/L', value: 80 }],
    })
  })

  test('keeps an unknown metric and a built-in metric with another unit as given', () => {
    expect(
      prepareReportEntries(
        [
          { metric: 'hair_mercury', unit: 'ppm', value: 0.2 },
          { metric: 'weight', unit: 'lb', value: 180 },
        ],
        [],
        catalog,
      ),
    ).toEqual({
      adopt: [],
      entries: [
        { metric: 'hair_mercury', series_unit: 'ppm', series_value: 0.2, unit: 'ppm', value: 0.2 },
        { metric: 'weight', series_unit: 'lb', series_value: 180, unit: 'lb', value: 180 },
      ],
    })
  })

  test('refuses a unit a catalogue metric does not accept, one line per entry', () => {
    expect(
      prepareReportEntries(
        [
          { metric: 'serum ferritin', unit: 'mmol/L', value: 1 },
          { metric: 'ldl', unit: 'g', value: 1 },
          { metric: 'weight', unit: 'kg', value: 80 },
        ],
        [],
        catalog,
      ),
    ).toEqual({
      errors: [
        'Entry "serum ferritin": Unit "mmol/L" is not accepted for "ferritin", which is stored in µg/L. Accepted units: µg/L, ng/mL.',
        'Entry "ldl": Unit "g" is not accepted for "ldl_cholesterol", which is stored in mmol/L. Accepted units: mmol/L, mg/dL.',
      ],
    })
  })

  test('refuses two entries of the same catalogue metric', () => {
    expect(
      prepareReportEntries(
        [
          { metric: 'ldl', unit: 'mg/dL', value: 100 },
          { metric: 'ldl_cholesterol', unit: 'mmol/L', value: 2.6 },
        ],
        [],
        catalog,
      ),
    ).toEqual({ errors: ['"ldl" and "ldl_cholesterol" are the same metric'] })
  })
})

describe('reports with catalogue metrics', () => {
  test('addReport writes nothing when an entry is refused', async () => {
    const result = await addReport('testuser', {
      date: '2025-05-08T09:00:00Z',
      entries: [{ metric: 'ferritin', unit: 'mmol/L', value: 1 }],
      report_type: 'blood_panel',
    })

    expect(result).toEqual({
      error:
        'Entry "ferritin": Unit "mmol/L" is not accepted for "ferritin", which is stored in µg/L. Accepted units: µg/L, ng/mL.',
      success: false,
    })
    expect(db.adoptCatalogMetric).not.toHaveBeenCalled()
    expect(mockInsertTimeSeries).not.toHaveBeenCalled()
    expect(mockInsertReport).not.toHaveBeenCalled()
  })

  test('addReport writes the converted value to the series and the printed one to the entry', async () => {
    mockInsertReport.mockResolvedValue({
      created_at: new Date('2025-05-08T10:00:00Z'),
      entries: [],
      id: 'r1',
      report_date: new Date('2025-05-08T09:00:00Z'),
      report_type: 'blood_panel',
    })

    await addReport('testuser', {
      date: '2025-05-08T09:00:00Z',
      entries: [{ metric: 'ldl', reference_high: 130, reference_low: 0, unit: 'mg/dL', value: 100 }],
      report_type: 'blood_panel',
    })

    expect(db.adoptCatalogMetric).toHaveBeenCalledWith(
      'testuser',
      expect.objectContaining({ name: 'ldl_cholesterol' }),
    )
    expect(mockInsertTimeSeries).toHaveBeenCalledWith('testuser', [
      {
        metric: 'ldl_cholesterol',
        source: 'lab_report',
        time: new Date('2025-05-08T09:00:00Z'),
        unit: 'mmol/L',
        value: 2.586,
      },
    ])
    expect(mockInsertReport).toHaveBeenCalledWith(
      'testuser',
      expect.objectContaining({
        entries: [
          expect.objectContaining({
            flag: 'normal',
            metric: 'ldl_cholesterol',
            reported_unit: 'mg/dL',
            reported_value: 100,
          }),
        ],
      }),
    )
  })

  test('updateReport refuses before touching anything', async () => {
    mockGetReportById.mockResolvedValue({
      created_at: new Date('2025-05-08T10:00:00Z'),
      entries: [],
      id: 'r1',
      report_date: new Date('2025-05-08T09:00:00Z'),
      report_type: 'blood_panel',
    })

    const result = await updateReport('testuser', 'r1', { entries: [{ metric: 'ldl', unit: 'g', value: 1 }] })

    expect(result.success).toBe(false)
    expect(mockQuery).not.toHaveBeenCalled()
    expect(mockInsertTimeSeries).not.toHaveBeenCalled()
    expect(mockUpdateReport).not.toHaveBeenCalled()
  })

  test('a date-only update re-inserts the series value, not the printed one', async () => {
    const existing = {
      created_at: new Date('2025-05-08T10:00:00Z'),
      entries: [
        {
          id: 'e1',
          metric: 'ldl_cholesterol',
          report_id: 'r1',
          stored_unit: 'mmol/L',
          stored_value: 2.586,
          unit: 'mg/dL',
          value: 100,
        },
      ],
      id: 'r1',
      report_date: new Date('2025-05-08T09:00:00Z'),
      report_type: 'blood_panel',
    }
    mockGetReportById.mockResolvedValue(existing)
    mockGetReportEntryMetrics.mockResolvedValue([
      { metric: 'ldl_cholesterol', report_date: new Date('2025-05-08T09:00:00Z') },
    ])
    mockUpdateReport.mockResolvedValue({ ...existing, report_date: new Date('2025-05-09T09:00:00Z') })
    mockQuery.mockResolvedValue({ command: 'DELETE', fields: [], oid: 0, rowCount: 1, rows: [] })

    const result = await updateReport('testuser', 'r1', { date: '2025-05-09T09:00:00Z' })

    expect(mockInsertTimeSeries).toHaveBeenCalledWith('testuser', [
      {
        metric: 'ldl_cholesterol',
        source: 'lab_report',
        time: new Date('2025-05-09T09:00:00Z'),
        unit: 'mmol/L',
        value: 2.586,
      },
    ])
    expect(result.data?.entries[0]).toMatchObject({
      stored_unit: 'mmol/L',
      stored_value: 2.586,
      unit: 'mg/dL',
      value: 100,
    })
  })
})
