import { beforeEach, describe, expect, test, vi } from 'vitest'
import * as db from '../db'
import { addReport, deleteReportById, getLatestMetric, getReport, queryReports } from './reports'

// Mock the db module
vi.mock('../db', () => ({
  deleteReport: vi.fn(),
  getLatestMetricValue: vi.fn(),
  getReportById: vi.fn(),
  getReportEntryMetrics: vi.fn(),
  getReports: vi.fn(),
  insertReport: vi.fn(),
  insertTimeSeries: vi.fn(),
  query: vi.fn(),
}))

const mockInsertReport = vi.mocked(db.insertReport)
const mockInsertTimeSeries = vi.mocked(db.insertTimeSeries)
const mockGetReportById = vi.mocked(db.getReportById)
const mockGetReports = vi.mocked(db.getReports)
const mockDeleteReport = vi.mocked(db.deleteReport)
const mockGetReportEntryMetrics = vi.mocked(db.getReportEntryMetrics)
const mockGetLatestMetricValue = vi.mocked(db.getLatestMetricValue)
const mockQuery = vi.mocked(db.query)

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

    // Should write through to time_series
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
        unit: e.unit,
        value: e.value,
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

    // Check that the entries passed to insertReport have auto-derived flags
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
    expect(mockDeleteReport).toHaveBeenCalledWith('testuser', 'report-1')

    // Should clean up time_series entries
    expect(mockQuery).toHaveBeenCalledTimes(2)
    expect(mockQuery).toHaveBeenCalledWith(
      'testuser',
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
