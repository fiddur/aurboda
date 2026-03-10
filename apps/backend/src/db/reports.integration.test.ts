import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper'
import { deleteReport, getLatestMetricValue, getReportById, getReports, insertReport } from './reports'
import { insertTimeSeries } from './time-series'

const CONTAINER_TIMEOUT = 60_000

describe('Reports Integration Tests', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  describe('insertReport', () => {
    test('creates a report with entries and returns generated IDs', async () => {
      const user = getTestUser()

      const report = await insertReport(user, {
        entries: [
          { confidence: 'measured', method: 'bia_segmental', metric: 'weight', unit: 'kg', value: 99.5 },
          { confidence: 'measured', method: 'bia_segmental', metric: 'body_fat', unit: '%', value: 17.5 },
          { confidence: 'derived', method: 'bia_segmental', metric: 'bmi', unit: 'kg/m2', value: 27.6 },
        ],
        location: 'Genki gym',
        notes: 'Clean scan - no exercise before',
        report_date: new Date('2025-05-08T09:23:00Z'),
        report_type: 'inbody',
      })

      expect(report.id).toBeDefined()
      expect(report.report_type).toBe('inbody')
      expect(report.report_date).toEqual(new Date('2025-05-08T09:23:00Z'))
      expect(report.location).toBe('Genki gym')
      expect(report.notes).toBe('Clean scan - no exercise before')
      expect(report.created_at).toBeInstanceOf(Date)
      expect(report.entries).toHaveLength(3)

      // Entries should have generated IDs
      for (const entry of report.entries) {
        expect(entry.id).toBeDefined()
        expect(entry.report_id).toBe(report.id)
      }
    })

    test('creates a report with minimal fields', async () => {
      const user = getTestUser()

      const report = await insertReport(user, {
        entries: [{ metric: 'ferritin', unit: 'ng/mL', value: 45 }],
        report_date: new Date('2025-03-15T08:00:00Z'),
        report_type: 'blood_panel',
      })

      expect(report.id).toBeDefined()
      expect(report.report_type).toBe('blood_panel')
      expect(report.location).toBeUndefined()
      expect(report.notes).toBeUndefined()
      expect(report.entries).toHaveLength(1)
      expect(report.entries[0].method).toBeUndefined()
      expect(report.entries[0].confidence).toBeUndefined()
    })

    test('stores reference range and flag on entries', async () => {
      const user = getTestUser()

      const report = await insertReport(user, {
        entries: [
          {
            confidence: 'measured',
            flag: 'normal',
            method: 'bia_segmental',
            metric: 'ecw_ratio',
            reference_high: 0.39,
            reference_low: 0.36,
            unit: 'ratio',
            value: 0.377,
          },
        ],
        report_date: new Date('2025-05-08T09:23:00Z'),
        report_type: 'inbody',
      })

      const entry = report.entries[0]
      expect(entry.reference_low).toBe(0.36)
      expect(entry.reference_high).toBe(0.39)
      expect(entry.flag).toBe('normal')
    })
  })

  describe('getReportById', () => {
    test('retrieves report by ID with entries', async () => {
      const user = getTestUser()

      const created = await insertReport(user, {
        entries: [
          { metric: 'weight', unit: 'kg', value: 99.5 },
          { metric: 'body_fat', unit: '%', value: 17.5 },
        ],
        report_date: new Date('2025-05-08T09:23:00Z'),
        report_type: 'inbody',
      })

      const found = await getReportById(user, created.id)

      expect(found).not.toBeNull()
      expect(found!.id).toBe(created.id)
      expect(found!.report_type).toBe('inbody')
      expect(found!.entries).toHaveLength(2)
    })

    test('returns null for non-existent report', async () => {
      const user = getTestUser()
      const found = await getReportById(user, '00000000-0000-0000-0000-000000000000')
      expect(found).toBeNull()
    })
  })

  describe('getReports', () => {
    test('returns all reports ordered by date descending', async () => {
      const user = getTestUser()

      await insertReport(user, {
        entries: [{ metric: 'weight', unit: 'kg', value: 100 }],
        report_date: new Date('2024-12-15T10:00:00Z'),
        report_type: 'inbody',
      })
      await insertReport(user, {
        entries: [{ metric: 'weight', unit: 'kg', value: 99.5 }],
        report_date: new Date('2025-05-08T09:23:00Z'),
        report_type: 'inbody',
      })

      const reports = await getReports(user, {})

      expect(reports).toHaveLength(2)
      expect(reports[0].report_date.getTime()).toBeGreaterThan(reports[1].report_date.getTime())
    })

    test('filters by report_type', async () => {
      const user = getTestUser()

      await insertReport(user, {
        entries: [{ metric: 'weight', unit: 'kg', value: 99.5 }],
        report_date: new Date('2025-05-08T09:23:00Z'),
        report_type: 'inbody',
      })
      await insertReport(user, {
        entries: [{ metric: 'ferritin', unit: 'ng/mL', value: 45 }],
        report_date: new Date('2025-03-15T08:00:00Z'),
        report_type: 'blood_panel',
      })

      const reports = await getReports(user, { report_type: 'inbody' })

      expect(reports).toHaveLength(1)
      expect(reports[0].report_type).toBe('inbody')
    })

    test('filters by date range', async () => {
      const user = getTestUser()

      await insertReport(user, {
        entries: [{ metric: 'weight', unit: 'kg', value: 100 }],
        report_date: new Date('2024-06-01T10:00:00Z'),
        report_type: 'inbody',
      })
      await insertReport(user, {
        entries: [{ metric: 'weight', unit: 'kg', value: 99.5 }],
        report_date: new Date('2025-05-08T09:23:00Z'),
        report_type: 'inbody',
      })

      const reports = await getReports(user, {
        end: new Date('2025-12-31T23:59:59Z'),
        start: new Date('2025-01-01T00:00:00Z'),
      })

      expect(reports).toHaveLength(1)
      expect(reports[0].report_date.getFullYear()).toBe(2025)
    })

    test('returns empty array when no reports match', async () => {
      const user = getTestUser()
      const reports = await getReports(user, { report_type: 'nonexistent' })
      expect(reports).toEqual([])
    })

    test('includes entries for each report', async () => {
      const user = getTestUser()

      await insertReport(user, {
        entries: [
          { metric: 'weight', unit: 'kg', value: 99.5 },
          { metric: 'body_fat', unit: '%', value: 17.5 },
        ],
        report_date: new Date('2025-05-08T09:23:00Z'),
        report_type: 'inbody',
      })

      const reports = await getReports(user, {})

      expect(reports).toHaveLength(1)
      expect(reports[0].entries).toHaveLength(2)
    })
  })

  describe('deleteReport', () => {
    test('deletes report and its entries via CASCADE', async () => {
      const user = getTestUser()

      const report = await insertReport(user, {
        entries: [
          { metric: 'weight', unit: 'kg', value: 99.5 },
          { metric: 'body_fat', unit: '%', value: 17.5 },
        ],
        report_date: new Date('2025-05-08T09:23:00Z'),
        report_type: 'inbody',
      })

      const deleted = await deleteReport(user, report.id)
      expect(deleted).toBe(true)

      const found = await getReportById(user, report.id)
      expect(found).toBeNull()
    })

    test('returns false for non-existent report', async () => {
      const user = getTestUser()
      const deleted = await deleteReport(user, '00000000-0000-0000-0000-000000000000')
      expect(deleted).toBe(false)
    })
  })

  describe('getLatestMetricValue', () => {
    test('returns the most recent value for a metric', async () => {
      const user = getTestUser()

      await insertTimeSeries(user, [
        {
          metric: 'weight',
          source: 'lab_report',
          time: new Date('2024-12-15T10:00:00Z'),
          unit: 'kg',
          value: 100,
        },
        {
          metric: 'weight',
          source: 'lab_report',
          time: new Date('2025-05-08T09:23:00Z'),
          unit: 'kg',
          value: 99.5,
        },
        { metric: 'weight', source: 'oura', time: new Date('2025-01-15T08:00:00Z'), unit: 'kg', value: 99.8 },
      ])

      const latest = await getLatestMetricValue(user, 'weight')

      expect(latest).not.toBeNull()
      expect(latest!.value).toBe(99.5)
      expect(latest!.source).toBe('lab_report')
      expect(latest!.time).toEqual(new Date('2025-05-08T09:23:00Z'))
    })

    test('returns null when no data exists for metric', async () => {
      const user = getTestUser()
      const latest = await getLatestMetricValue(user, 'nonexistent_metric')
      expect(latest).toBeNull()
    })
  })

  describe('custom report types', () => {
    test('supports arbitrary report_type strings', async () => {
      const user = getTestUser()

      const report = await insertReport(user, {
        entries: [
          { confidence: 'measured', method: 'hair_analysis', metric: 'calcium', unit: 'mg%', value: 42 },
          { confidence: 'measured', method: 'hair_analysis', metric: 'magnesium', unit: 'mg%', value: 6.2 },
          { confidence: 'measured', method: 'hair_analysis', metric: 'sodium', unit: 'mg%', value: 25 },
          { confidence: 'measured', method: 'hair_analysis', metric: 'potassium', unit: 'mg%', value: 10 },
        ],
        location: 'Trace Elements Lab',
        report_date: new Date('2025-02-20T14:00:00Z'),
        report_type: 'hair_mineral_analysis',
      })

      expect(report.report_type).toBe('hair_mineral_analysis')
      expect(report.entries).toHaveLength(4)

      // Can filter by custom type
      const results = await getReports(user, { report_type: 'hair_mineral_analysis' })
      expect(results).toHaveLength(1)
    })
  })
})
