import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { getNoteById, getNotesForEntity, insertNote } from '../db/notes.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { addReport, deleteReportById } from './reports.ts'

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
