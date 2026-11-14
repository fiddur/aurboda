import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { query } from '../db/connection.ts'
import { getCustomMetricByName, getCustomMetricDefinitions } from '../db/custom-metrics.ts'
import { getNoteById, getNotesForEntity, insertNote } from '../db/notes.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { addReport, deleteReportById, getReport, queryReports, updateReport } from './reports.ts'

const CONTAINER_TIMEOUT = 120_000

const newReport = async (user: string, date: string): Promise<string> => {
  const result = await addReport(user, {
    date,
    entries: [{ metric: 'weight', unit: 'kg', value: 80 }],
    report_type: 'inbody',
  })
  if (!result.data) throw new Error(result.error ?? 'report not created')
  return result.data.id
}

describe('deleteReportById integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test("removes the report's comment threads and leaves other reports' alone", async () => {
    const user = getTestUser()
    const start = new Date('2026-05-08T09:00:00Z')
    const reportId = await newReport(user, start.toISOString())
    const otherId = await newReport(user, '2026-05-09T09:00:00Z')
    const root = await insertNote(user, 'report', reportId, 'Looks off', start)
    const reply = await insertNote(user, 'note', root.id, 'Re-measure', start)
    const otherRoot = await insertNote(user, 'report', otherId, 'Fine', start)

    expect((await deleteReportById(user, reportId)).success).toBe(true)

    expect(await getNotesForEntity(user, 'report', reportId)).toEqual([])
    expect(await getNoteById(user, root.id)).toBeNull()
    expect(await getNoteById(user, reply.id)).toBeNull()
    expect(await getNoteById(user, otherRoot.id)).not.toBeNull()
  })

  test('leaves comments alone when the report does not exist', async () => {
    const user = getTestUser()
    const orphanTarget = '00000000-0000-4000-8000-000000000000'
    const note = await insertNote(user, 'report', orphanTarget, 'Kept', new Date('2026-05-08T09:00:00Z'))

    expect((await deleteReportById(user, orphanTarget)).success).toBe(false)
    expect(await getNoteById(user, note.id)).not.toBeNull()
  })
})

describe('reports with catalogue metrics', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  const seriesRows = async (user: string) =>
    (
      await query(
        user,
        `SELECT metric, time, value, unit FROM time_series WHERE source = 'lab_report' AND deleted_at IS NULL ORDER BY metric, time`,
      )
    ).rows.map((row) => ({
      metric: row.metric,
      time: new Date(row.time).toISOString(),
      unit: row.unit,
      value: row.value,
    }))

  const ldlReport = (user: string) =>
    addReport(user, {
      date: '2026-05-08T09:00:00.000Z',
      entries: [
        { metric: 'ldl', reference_high: 130, reference_low: 0, unit: 'mg/dL', value: 100 },
        { metric: 'ferritin', unit: 'µg/L', value: 80 },
      ],
      report_type: 'blood_panel',
    })

  test('an alias with an accepted unit adopts the metric, converts the series and reads back as printed', async () => {
    const user = getTestUser()
    const result = await ldlReport(user)
    expect(result.success).toBe(true)

    expect(await getCustomMetricByName(user, 'ldl_cholesterol')).toMatchObject({
      description: 'LDL cholesterol',
      unit: 'mmol/L',
    })
    expect(await seriesRows(user)).toEqual([
      { metric: 'ferritin', time: '2026-05-08T09:00:00.000Z', unit: 'µg/L', value: 80 },
      { metric: 'ldl_cholesterol', time: '2026-05-08T09:00:00.000Z', unit: 'mmol/L', value: 2.586 },
    ])

    const read = await getReport(user, result.data!.id)
    const ldl = read.data!.entries.find((e) => e.metric === 'ldl_cholesterol')
    expect(ldl).toMatchObject({
      flag: 'normal',
      stored_unit: 'mmol/L',
      stored_value: 2.586,
      unit: 'mg/dL',
      value: 100,
    })
    const ferritin = read.data!.entries.find((e) => e.metric === 'ferritin')
    expect(ferritin).toMatchObject({ unit: 'µg/L', value: 80 })
    expect(ferritin).not.toHaveProperty('stored_value')
    expect(ferritin).not.toHaveProperty('stored_unit')

    const listed = await queryReports(user, {})
    expect(listed.data![0].entries.find((e) => e.metric === 'ldl_cholesterol')).toMatchObject({
      stored_value: 2.586,
      unit: 'mg/dL',
      value: 100,
    })
  })

  test('a refused unit writes nothing at all', async () => {
    const user = getTestUser()
    const result = await addReport(user, {
      date: '2026-05-08T09:00:00.000Z',
      entries: [
        { metric: 'ldl', unit: 'mg/dL', value: 100 },
        { metric: 'ferritin', unit: 'mmol/L', value: 1 },
      ],
      report_type: 'blood_panel',
    })

    expect(result.success).toBe(false)
    expect((await queryReports(user, {})).data).toEqual([])
    expect(await seriesRows(user)).toEqual([])
    expect(await getCustomMetricDefinitions(user)).toEqual([])
  })

  test('an unknown metric is written as before', async () => {
    const user = getTestUser()
    const result = await addReport(user, {
      date: '2026-05-08T09:00:00.000Z',
      entries: [{ metric: 'hair_mercury', unit: 'ppm', value: 0.2 }],
      report_type: 'hair_mineral_analysis',
    })

    expect(result.data!.entries).toEqual([
      expect.objectContaining({ metric: 'hair_mercury', unit: 'ppm', value: 0.2 }),
    ])
    expect(result.data!.entries[0]).not.toHaveProperty('stored_value')
    expect(await seriesRows(user)).toEqual([
      { metric: 'hair_mercury', time: '2026-05-08T09:00:00.000Z', unit: 'ppm', value: 0.2 },
    ])
    expect(await getCustomMetricDefinitions(user)).toEqual([])
  })

  test('a date-only update keeps the series converted and the entry as printed', async () => {
    const user = getTestUser()
    const id = (await ldlReport(user)).data!.id

    const updated = await updateReport(user, id, { date: '2026-05-09T09:00:00.000Z' })

    expect(updated.success).toBe(true)
    expect(updated.data!.entries.find((e) => e.metric === 'ldl_cholesterol')).toMatchObject({
      stored_unit: 'mmol/L',
      stored_value: 2.586,
      unit: 'mg/dL',
      value: 100,
    })
    expect(await seriesRows(user)).toEqual([
      { metric: 'ferritin', time: '2026-05-09T09:00:00.000Z', unit: 'µg/L', value: 80 },
      { metric: 'ldl_cholesterol', time: '2026-05-09T09:00:00.000Z', unit: 'mmol/L', value: 2.586 },
    ])
  })

  test('delete removes the series rows of a converted entry', async () => {
    const user = getTestUser()
    const id = (await ldlReport(user)).data!.id

    expect((await deleteReportById(user, id)).success).toBe(true)
    expect(await seriesRows(user)).toEqual([])
  })
})
