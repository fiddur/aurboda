import type { ImportReportsBody } from '@aurboda/api-spec'

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { getUserSettings, upsertUserSettings } from '../db/settings.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { importReports } from './report-import.ts'
import { addReport, queryReports } from './reports.ts'

const CONTAINER_TIMEOUT = 120_000

const wideBody = (text: string, dry_run = false): ImportReportsBody => ({
  dry_run,
  mapping: { date_order: 'dmy', has_header: true, layout: 'wide', metric: 0, reference_range: 2, unit: 1 },
  report_type: 'blood_panel',
  text,
})

const sheet = ['Analys\tEnhet\tReferens\t1/3-26', 'Hb\tg/L\t117-153\t145', 'Ferritin\tµg/L\t\t40'].join('\n')
const sheetWithNewColumn = [
  'Analys\tEnhet\tReferens\t1/3-26\t15.6.2026',
  'Hb\tg/L\t117-153\t145\t139',
  'Ferritin\tµg/L\t\t40\t<10',
].join('\n')

describe('importReports integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('a dry run writes nothing', async () => {
    const user = getTestUser()
    const result = await importReports(user, wideBody(sheet, true))
    expect('data' in result && result.data.summary).toEqual({
      entries_existing: 0,
      entries_new: 2,
      errors: 0,
      reports_new: 1,
      reports_updated: 0,
    })
    expect((await queryReports(user, {})).data).toEqual([])
    expect((await getUserSettings(user))?.report_import_mapping).toBeUndefined()
  })

  test('importing the same sheet twice changes nothing, and a new column adds one report', async () => {
    const user = getTestUser()
    await upsertUserSettings(user, { device_timezone: 'Europe/Stockholm' })

    const first = await importReports(user, wideBody(sheet))
    expect('data' in first && first.data.summary).toMatchObject({ entries_new: 2, reports_new: 1 })
    const reports = (await queryReports(user, {})).data!
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ date: '2026-02-28T23:00:00.000Z', report_type: 'blood_panel' })
    expect(
      reports[0].entries
        .map((e) => [e.metric, e.value, e.reference_low, e.reference_high, e.flag])
        .toSorted((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([
      ['ferritin', 40, undefined, undefined, undefined],
      ['hemoglobin', 145, 117, 153, 'normal'],
    ])
    expect((await getUserSettings(user))?.report_import_mapping).toMatchObject({ layout: 'wide', metric: 0 })

    const again = await importReports(user, wideBody(sheet))
    expect('data' in again && again.data).toMatchObject({
      message: 'Nothing new to import; nothing was written',
      report_ids: [],
      summary: { entries_existing: 2, entries_new: 0, reports_new: 0 },
    })
    expect((await queryReports(user, {})).data).toHaveLength(1)

    const later = await importReports(user, wideBody(sheetWithNewColumn))
    expect('data' in later && later.data.summary).toEqual({
      entries_existing: 2,
      entries_new: 1,
      errors: 1,
      reports_new: 1,
      reports_updated: 0,
    })
    expect('data' in later && later.data.rows[0]).toMatchObject({
      error: 'Not a number: <10',
      status: 'error',
    })
    expect((await queryReports(user, {})).data).toHaveLength(2)
  })

  test('new results for a date with a report of the same type are added to it', async () => {
    const user = getTestUser()
    const existing = await addReport(user, {
      date: '2026-03-01T08:30:00.000Z',
      entries: [{ metric: 'hemoglobin', unit: 'g/L', value: 145 }],
      report_type: 'blood_panel',
    })

    const result = await importReports(user, wideBody(sheet))
    expect('data' in result && result.data).toMatchObject({
      report_ids: [existing.data!.id],
      summary: { entries_existing: 1, entries_new: 1, reports_new: 0, reports_updated: 1 },
    })
    const reports = (await queryReports(user, {})).data!
    expect(reports).toHaveLength(1)
    expect(reports[0].entries.map((e) => e.metric).toSorted()).toEqual(['ferritin', 'hemoglobin'])
  })

  test('a table that cannot be read is refused as a whole', async () => {
    const user = getTestUser()
    expect(await importReports(user, wideBody('Analys\tVärde\nHb\t145'))).toEqual({
      error: 'No column header reads as a date',
    })
    expect(await importReports(user, wideBody('Analys\t1/3-26'))).toEqual({
      error: 'The table has no rows to import',
    })
  })
})
