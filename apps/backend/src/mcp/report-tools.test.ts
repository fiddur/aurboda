import { addReportBodySchema, importReportsBodySchema, updateReportBodySchema } from '@aurboda/api-spec'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { McpServer } from './helpers.ts'

import { registerReportTools } from './report-tools.ts'

vi.mock('../services/reports.ts', () => ({
  addReport: vi.fn(),
  deleteReportById: vi.fn(),
  getLatestMetric: vi.fn(),
  getReport: vi.fn(),
  queryReports: vi.fn(),
  updateReport: vi.fn(),
}))
vi.mock('../services/report-import.ts', () => ({ importReports: vi.fn() }))

const { addReport, deleteReportById, getReport, queryReports, updateReport } =
  await import('../services/reports.ts')
const { importReports } = await import('../services/report-import.ts')

type ToolResult = { content: Array<{ text: string }> }
type ToolHandler = (params: Record<string, unknown>) => Promise<ToolResult>

const tools = (): Map<string, ToolHandler> => {
  const registered = new Map<string, ToolHandler>()
  const server = {
    tool: (name: string, _desc: string, _shape: unknown, handler: ToolHandler) => {
      registered.set(name, handler)
    },
  } as unknown as McpServer
  registerReportTools(server, 'tester')
  return registered
}

const call = (name: string, params: Record<string, unknown>) => tools().get(name)!(params)
const parsed = (result: ToolResult) => JSON.parse(result.content[0].text)

const REPORT_ID = '11111111-1111-4111-8111-111111111111'
const report = {
  date: '2026-03-01T08:00:00.000Z',
  entries: [{ metric: 'ferritin', unit: 'ng/mL', value: 80 }],
  id: REPORT_ID,
  report_type: 'blood_panel',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('report tools', () => {
  test('registers the CRUD and import tools', () => {
    expect([...tools().keys()].sort()).toEqual([
      'add_report',
      'delete_report',
      'get_latest_metric',
      'get_report',
      'import_reports',
      'query_reports',
      'update_report',
    ])
  })

  test('add_report creates the report', async () => {
    vi.mocked(addReport).mockResolvedValue({ data: report, success: true } as never)
    const result = await call('add_report', {
      date: report.date,
      entries: report.entries,
      report_type: 'blood_panel',
    })
    expect(parsed(result)).toEqual({ data: report, success: true })
    expect(addReport).toHaveBeenCalledWith('tester', {
      date: report.date,
      entries: report.entries,
      location: undefined,
      notes: undefined,
      report_type: 'blood_panel',
    })
  })

  test('add_report returns the service’s refusal as an error', async () => {
    vi.mocked(addReport).mockResolvedValue({ error: 'Cannot convert mg to ng/mL', success: false })
    const result = await call('add_report', { date: report.date, entries: report.entries, report_type: 'x' })
    expect(result.content[0].text).toBe('Cannot convert mg to ng/mL')
  })

  test('get_report and delete_report answer an unknown id with an error', async () => {
    vi.mocked(getReport).mockResolvedValue({ error: 'Report not found', success: false })
    vi.mocked(deleteReportById).mockResolvedValue({ error: 'Report not found', success: false })
    for (const name of ['get_report', 'delete_report']) {
      const result = await call(name, { id: REPORT_ID })
      expect(result.content[0].text).toBe('Report not found')
    }
  })

  test('get_report returns the report', async () => {
    vi.mocked(getReport).mockResolvedValue({ data: report, success: true } as never)
    expect(parsed(await call('get_report', { id: REPORT_ID }))).toEqual({ data: report, success: true })
    expect(getReport).toHaveBeenCalledWith('tester', REPORT_ID)
  })

  test('query_reports passes the filters', async () => {
    vi.mocked(queryReports).mockResolvedValue({ data: [report], success: true } as never)
    const result = await call('query_reports', { report_type: 'blood_panel', start: '2026-01-01T00:00:00Z' })
    expect(parsed(result)).toEqual({ data: [report], success: true })
    expect(queryReports).toHaveBeenCalledWith('tester', {
      end: undefined,
      report_type: 'blood_panel',
      start: '2026-01-01T00:00:00Z',
    })
  })

  test('update_report passes the patch without the id', async () => {
    vi.mocked(updateReport).mockResolvedValue({ data: report, success: true } as never)
    await call('update_report', { id: REPORT_ID, notes: null })
    expect(updateReport).toHaveBeenCalledWith('tester', REPORT_ID, { notes: null })
  })

  test('delete_report deletes', async () => {
    vi.mocked(deleteReportById).mockResolvedValue({ success: true })
    expect(parsed(await call('delete_report', { id: REPORT_ID }))).toEqual({ success: true })
  })

  test('import_reports returns the import’s result, or its error', async () => {
    const data = { dry_run: true, rows: [], rows_truncated: false, summary: {} }
    vi.mocked(importReports).mockResolvedValueOnce({ data } as never)
    const params = {
      dry_run: true,
      mapping: { date: 0, layout: 'long', metric: 1, value: 2 },
      report_type: 'blood_panel',
      text: 'a\tb\tc',
    }
    expect(parsed(await call('import_reports', params))).toEqual({ data, success: true })
    expect(importReports).toHaveBeenCalledWith('tester', params)

    vi.mocked(importReports).mockResolvedValueOnce({ error: 'The table has no rows' })
    const failed = await call('import_reports', params)
    expect(failed.content[0].text).toBe('The table has no rows')
  })
})

describe('report tool input validation', () => {
  test('add_report needs at least one entry', () => {
    expect(
      addReportBodySchema.safeParse({ date: report.date, entries: [], report_type: 'blood_panel' }).success,
    ).toBe(false)
  })

  test('update_report refuses an empty report type', () => {
    expect(updateReportBodySchema.safeParse({ report_type: '' }).success).toBe(false)
  })

  test('import_reports needs a value column for a long sheet', () => {
    const result = importReportsBodySchema.safeParse({
      mapping: { date: 0, layout: 'long', metric: 1 },
      report_type: 'blood_panel',
      text: 'x',
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].message).toBe('A long sheet needs a value column')
  })
})
