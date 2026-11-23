import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { query } from './connection.ts'
import { getNoteLinkDismissalsForNoteIds, insertNoteLinkDismissal } from './note-link-dismissals.ts'
import { deleteNote, insertNote } from './notes.ts'

const CONTAINER_TIMEOUT = 120_000
const PERSON = '11111111-1111-4111-8111-111111111111'
const ACTIVITY = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'

const dismissalCount = async (user: string): Promise<number> =>
  Number((await query<{ n: string }>(user, 'SELECT COUNT(*) AS n FROM note_link_dismissals')).rows[0]!.n)

describe('Note link dismissals Integration Tests', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('insertNoteLinkDismissal is idempotent and getNoteLinkDismissalsForNoteIds groups them by note', async () => {
    const user = getTestUser()
    const one = await insertNote(user, 'day', null, 'One', undefined, undefined, { date: '2026-11-20' })
    const two = await insertNote(user, 'day', null, 'Two', undefined, undefined, { date: '2026-11-21' })
    const other = await insertNote(user, 'day', null, 'Other', undefined, undefined, { date: '2026-11-22' })

    await insertNoteLinkDismissal(user, one.id, { entity_id: PERSON, entity_type: 'person' })
    await insertNoteLinkDismissal(user, one.id, { entity_id: PERSON, entity_type: 'person' })
    await insertNoteLinkDismissal(user, one.id, { entity_id: ACTIVITY, entity_type: 'activity' })
    await insertNoteLinkDismissal(user, two.id, {
      entity_id: ACTIVITY.toLowerCase(),
      entity_type: 'activity',
    })
    await insertNoteLinkDismissal(user, other.id, { entity_id: PERSON, entity_type: 'person' })

    expect(await dismissalCount(user)).toBe(4)
    const byNote = await getNoteLinkDismissalsForNoteIds(user, [one.id, two.id])
    expect(byNote.get(one.id)).toEqual([
      { entity_id: PERSON, entity_type: 'person' },
      { entity_id: ACTIVITY.toLowerCase(), entity_type: 'activity' },
    ])
    expect(byNote.get(two.id)).toEqual([{ entity_id: ACTIVITY.toLowerCase(), entity_type: 'activity' }])
    expect(byNote.has(other.id)).toBe(false)
    expect(await getNoteLinkDismissalsForNoteIds(user, [])).toEqual(new Map())
  })

  test('purging a note removes its dismissals with it', async () => {
    const user = getTestUser()
    const note = await insertNote(user, 'day', null, 'Gone', undefined, undefined, { date: '2026-11-20' })
    await insertNoteLinkDismissal(user, note.id, { entity_id: PERSON, entity_type: 'person' })
    expect(await dismissalCount(user)).toBe(1)

    await deleteNote(user, note.id)

    expect(await dismissalCount(user)).toBe(0)
  })
})
