import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { createReportsRouter } from './reports-router.ts'

vi.mock('../services/reports.ts', () => ({
  addReport: vi.fn(),
  deleteReportById: vi.fn(),
  getReport: vi.fn(),
  queryReports: vi.fn(),
  REPORT_NOT_FOUND: 'Report not found',
  updateReport: vi.fn(),
}))
vi.mock('../services/report-import.ts', () => ({ importReports: vi.fn() }))

const { addReport, deleteReportById, getReport, queryReports, updateReport } =
  await import('../services/reports.ts')
const { importReports } = await import('../services/report-import.ts')

const REPORT_ID = '11111111-1111-4111-8111-111111111111'

const report = {
  date: '2026-03-01T08:00:00.000Z',
  entries: [{ metric: 'ferritin', unit: 'ng/mL', value: 80 }],
  id: REPORT_ID,
  report_type: 'blood_panel',
}

const buildApp = () => {
  const app = express()
  app.use(express.json())
  const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = 'tester'
    next()
  }
  app.use('/reports', createReportsRouter(auth) as unknown as express.RequestHandler)
  return app
}

const importBody = {
  mapping: { date: 0, layout: 'long', metric: 1, value: 2 },
  report_type: 'blood_panel',
  text: 'date\ttest\tvalue\n2026-03-01\tferritin\t80',
}

const importResult = {
  dry_run: true,
  rows: [{ date: '2026-03-01', metric: 'ferritin', row: 2, status: 'new', value: 80 }],
  rows_truncated: false,
  summary: { entries_existing: 0, entries_new: 1, errors: 0, reports_new: 1, reports_updated: 0 },
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /reports', () => {
  test('lists the reports with the filters given', async () => {
    vi.mocked(queryReports).mockResolvedValue({ data: [report], success: true } as never)
    const res = await supertest(buildApp()).get(
      '/reports?report_type=blood_panel&start=2026-01-01T00:00:00Z&end=2026-04-01T00:00:00Z',
    )
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: [report], success: true })
    expect(queryReports).toHaveBeenCalledWith('tester', {
      end: '2026-04-01T00:00:00Z',
      report_type: 'blood_panel',
      start: '2026-01-01T00:00:00Z',
    })
  })

  test('400 for a malformed date filter', async () => {
    const res = await supertest(buildApp()).get('/reports?start=yesterday')
    expect(res.status).toBe(400)
    expect(queryReports).not.toHaveBeenCalled()
  })
})

describe('GET /reports/:id', () => {
  test('returns the report', async () => {
    vi.mocked(getReport).mockResolvedValue({ data: report, success: true } as never)
    const res = await supertest(buildApp()).get(`/reports/${REPORT_ID}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: report, success: true })
    expect(getReport).toHaveBeenCalledWith('tester', REPORT_ID)
  })

  test('404 for an unknown report', async () => {
    vi.mocked(getReport).mockResolvedValue({ error: 'Report not found', success: false })
    const res = await supertest(buildApp()).get(`/reports/${REPORT_ID}`)
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Report not found', success: false })
  })
})

describe('POST /reports', () => {
  const body = {
    date: '2026-03-01T08:00:00Z',
    entries: [{ metric: 'ferritin', unit: 'ng/mL', value: 80 }],
    location: 'Lab',
    report_type: 'blood_panel',
  }

  test('creates the report', async () => {
    vi.mocked(addReport).mockResolvedValue({ data: report, success: true } as never)
    const res = await supertest(buildApp()).post('/reports').send(body)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: report, success: true })
    expect(addReport).toHaveBeenCalledWith('tester', {
      date: body.date,
      entries: body.entries,
      location: 'Lab',
      notes: undefined,
      report_type: 'blood_panel',
    })
  })

  test('400 for a report without entries', async () => {
    const res = await supertest(buildApp())
      .post('/reports')
      .send({ ...body, entries: [] })
    expect(res.status).toBe(400)
    expect(addReport).not.toHaveBeenCalled()
  })

  test('400 with the service’s error when an entry is refused', async () => {
    vi.mocked(addReport).mockResolvedValue({ error: 'Cannot convert mg to ng/mL', success: false })
    const res = await supertest(buildApp()).post('/reports').send(body)
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'Cannot convert mg to ng/mL', success: false })
  })
})

describe('PATCH /reports/:id', () => {
  test('updates the report, clearing a field given as null', async () => {
    vi.mocked(updateReport).mockResolvedValue({ data: report, success: true } as never)
    const res = await supertest(buildApp()).patch(`/reports/${REPORT_ID}`).send({ notes: null })
    expect(res.status).toBe(200)
    expect(updateReport).toHaveBeenCalledWith('tester', REPORT_ID, {
      date: undefined,
      entries: undefined,
      location: undefined,
      notes: null,
      report_type: undefined,
    })
  })

  test('404 for an unknown report, 400 for any other refusal', async () => {
    vi.mocked(updateReport).mockResolvedValueOnce({ error: 'Report not found', success: false })
    const missing = await supertest(buildApp()).patch(`/reports/${REPORT_ID}`).send({ notes: 'x' })
    expect(missing.status).toBe(404)
    vi.mocked(updateReport).mockResolvedValueOnce({ error: 'Cannot convert', success: false })
    const refused = await supertest(buildApp()).patch(`/reports/${REPORT_ID}`).send({ notes: 'x' })
    expect(refused.status).toBe(400)
    expect(refused.body).toEqual({ error: 'Cannot convert', success: false })
  })

  test('400 for an empty report type', async () => {
    const res = await supertest(buildApp()).patch(`/reports/${REPORT_ID}`).send({ report_type: '' })
    expect(res.status).toBe(400)
    expect(updateReport).not.toHaveBeenCalled()
  })
})

describe('DELETE /reports/:id', () => {
  test('deletes the report', async () => {
    vi.mocked(deleteReportById).mockResolvedValue({ success: true })
    const res = await supertest(buildApp()).delete(`/reports/${REPORT_ID}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(deleteReportById).toHaveBeenCalledWith('tester', REPORT_ID)
  })

  test('404 for an unknown report', async () => {
    vi.mocked(deleteReportById).mockResolvedValue({ error: 'Report not found', success: false })
    const res = await supertest(buildApp()).delete(`/reports/${REPORT_ID}`)
    expect(res.status).toBe(404)
  })
})

describe('POST /reports/import', () => {
  test('passes the body with its defaults to the import and returns its result', async () => {
    vi.mocked(importReports).mockResolvedValue({ data: importResult } as never)
    const res = await supertest(buildApp()).post('/reports/import').send(importBody)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: importResult, success: true })
    expect(importReports).toHaveBeenCalledWith('tester', {
      ...importBody,
      dry_run: false,
      mapping: { ...importBody.mapping, date_order: 'dmy', has_header: true },
    })
  })

  test('400 for a long sheet without a value column', async () => {
    const res = await supertest(buildApp())
      .post('/reports/import')
      .send({ ...importBody, mapping: { date: 0, layout: 'long', metric: 1 } })
    expect(res.status).toBe(400)
    expect(importReports).not.toHaveBeenCalled()
  })

  test('400 with the import’s error', async () => {
    vi.mocked(importReports).mockResolvedValue({ error: 'The table has no rows' })
    const res = await supertest(buildApp()).post('/reports/import').send(importBody)
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'The table has no rows', success: false })
  })
})
