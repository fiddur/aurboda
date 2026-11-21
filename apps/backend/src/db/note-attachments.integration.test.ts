import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { query } from './connection.ts'
import {
  getDeletedNoteAttachments,
  getNoteAttachment,
  getNoteAttachmentBytes,
  getNoteAttachmentsForNoteIds,
  getNoteAttachmentUsage,
  insertNoteAttachment,
  insertNoteAttachmentWithinLimits,
  type NewNoteAttachment,
  purgeNoteAttachment,
  restoreNoteAttachment,
  restoreNoteAttachmentWithinLimit,
  softDeleteNoteAttachment,
} from './note-attachments.ts'
import { insertNoteTemplate, softDeleteNoteTemplate } from './note-templates.ts'
import {
  deleteNote,
  getNotesForTimeRange,
  insertNote,
  pruneDeletedNotes,
  searchNotes,
  softDeleteNote,
} from './notes.ts'

const CONTAINER_TIMEOUT = 120_000

const picture = (size = 5): NewNoteAttachment => ({
  bytes: Buffer.alloc(size, 7),
  height: 40,
  kind: 'image',
  mime: 'image/webp',
  width: 20,
})

const recording: NewNoteAttachment = {
  bytes: Buffer.from('OggS-recording'),
  kind: 'audio',
  mime: 'audio/ogg',
}

const dayEntry = (user: string, content = '') =>
  insertNote(user, 'day', null, content, undefined, undefined, { date: '2024-01-15' })

const DAY = { end: new Date('2024-01-15T23:59:59Z'), start: new Date('2024-01-15T00:00:00Z') }

describe('Note attachments integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('insertNoteAttachment stores the bytes and answers the metadata without them', async () => {
    const user = getTestUser()
    const note = await dayEntry(user)
    const stored = await insertNoteAttachment(user, note.id, 1, picture(7))
    expect(stored).toEqual({
      created_at: expect.any(Date),
      deleted_at: undefined,
      height: 40,
      id: expect.any(String),
      kind: 'image',
      mime: 'image/webp',
      note_id: note.id,
      position: 1,
      size: 7,
      width: 20,
    })
    const audio = await insertNoteAttachment(user, note.id, 2, recording)
    expect(audio).toMatchObject({ height: undefined, kind: 'audio', mime: 'audio/ogg', width: undefined })
  })

  test('parallel uploads at the per-entry cap store exactly the cap, at unique contiguous positions', async () => {
    const user = getTestUser()
    const note = await dayEntry(user)
    await insertNoteAttachment(user, note.id, 1, picture())
    await insertNoteAttachment(user, note.id, 2, picture())
    const limits = { account_bytes: 1_000_000, per_note: 6 }

    const results = await Promise.all(
      Array.from({ length: 10 }, () => insertNoteAttachmentWithinLimits(user, note.id, picture(), limits)),
    )

    expect(results.filter((r) => r.ok)).toHaveLength(4)
    expect(results.filter((r) => !r.ok).map((r) => !r.ok && r.reason)).toEqual(Array(6).fill('note_limit'))
    const stored = (await getNoteAttachmentsForNoteIds(user, [note.id])).get(note.id) ?? []
    expect(stored.map((a) => a.position)).toEqual([1, 2, 3, 4, 5, 6])
  })

  test('parallel uploads cannot pass the account cap together', async () => {
    const user = getTestUser()
    const note = await dayEntry(user)
    const other = await dayEntry(user)
    await insertNoteAttachment(user, other.id, 1, picture(40))
    const limits = { account_bytes: 100, per_note: 30 }

    const results = await Promise.all(
      Array.from({ length: 8 }, () => insertNoteAttachmentWithinLimits(user, note.id, picture(10), limits)),
    )

    expect(results.filter((r) => r.ok)).toHaveLength(6)
    expect(results.filter((r) => !r.ok).map((r) => !r.ok && r.reason)).toEqual([
      'account_limit',
      'account_limit',
    ])
    expect((await getNoteAttachmentUsage(user, note.id)).account_bytes).toBe(100)
  })

  test('a capped restore brings one back, refuses at the cap, answers a live one as it is', async () => {
    const user = getTestUser()
    const note = await dayEntry(user)
    const first = await insertNoteAttachment(user, note.id, 1, picture())
    const second = await insertNoteAttachment(user, note.id, 2, picture())
    await softDeleteNoteAttachment(user, note.id, first.id)
    await softDeleteNoteAttachment(user, note.id, second.id)
    await insertNoteAttachment(user, note.id, 3, picture())

    const restored = await restoreNoteAttachmentWithinLimit(user, note.id, first.id, 2)
    expect(restored).toMatchObject({ ok: true, value: { deleted_at: undefined, id: first.id } })
    expect(await restoreNoteAttachmentWithinLimit(user, note.id, second.id, 2)).toEqual({
      ok: false,
      reason: 'note_limit',
    })
    expect(await restoreNoteAttachmentWithinLimit(user, note.id, first.id, 2)).toMatchObject({
      ok: true,
      value: { id: first.id },
    })
    expect(
      await restoreNoteAttachmentWithinLimit(user, note.id, '00000000-0000-4000-8000-000000000000', 2),
    ).toBeNull()
  })

  test('list and metadata reads never carry the bytes', async () => {
    const user = getTestUser()
    const note = await dayEntry(user)
    const stored = await insertNoteAttachment(user, note.id, 1, picture())
    await softDeleteNoteAttachment(
      user,
      note.id,
      (await insertNoteAttachment(user, note.id, 2, picture())).id,
    )

    const live = (await getNoteAttachmentsForNoteIds(user, [note.id])).get(note.id)!
    const deleted = await getDeletedNoteAttachments(user, note.id)
    const one = await getNoteAttachment(user, note.id, stored.id)
    for (const record of [...live, ...deleted, one!]) expect(record).not.toHaveProperty('bytes')
  })

  test('getNoteAttachmentBytes serves a live attachment of a live note only', async () => {
    const user = getTestUser()
    const note = await dayEntry(user)
    const stored = await insertNoteAttachment(user, note.id, 1, recording)
    expect(await getNoteAttachmentBytes(user, note.id, stored.id)).toEqual({
      bytes: recording.bytes,
      kind: 'audio',
      mime: 'audio/ogg',
    })
    expect(await getNoteAttachmentBytes(user, '00000000-0000-4000-8000-000000000000', stored.id)).toBeNull()

    await softDeleteNote(user, note.id)
    expect(await getNoteAttachmentBytes(user, note.id, stored.id)).toBeNull()
    expect(await getNoteAttachment(user, note.id, stored.id)).toBeNull()
  })

  test('getNoteAttachmentsForNoteIds groups the live ones by note in position order', async () => {
    const user = getTestUser()
    const first = await dayEntry(user)
    const second = await dayEntry(user)
    await insertNoteAttachment(user, first.id, 2, picture())
    await insertNoteAttachment(user, first.id, 1, recording)
    const gone = await insertNoteAttachment(user, first.id, 3, picture())
    await softDeleteNoteAttachment(user, first.id, gone.id)
    await insertNoteAttachment(user, second.id, 1, picture())

    const map = await getNoteAttachmentsForNoteIds(user, [first.id, second.id])
    expect(map.get(first.id)!.map((a) => a.position)).toEqual([1, 2])
    expect(map.get(second.id)).toHaveLength(1)
    expect(await getNoteAttachmentsForNoteIds(user, [])).toEqual(new Map())
  })

  test('getNoteAttachmentUsage counts the live ones, the highest position and the account bytes', async () => {
    const user = getTestUser()
    const note = await dayEntry(user)
    const other = await dayEntry(user)
    expect(await getNoteAttachmentUsage(user, note.id)).toEqual({
      account_bytes: 0,
      live_count: 0,
      max_position: null,
    })

    await insertNoteAttachment(user, note.id, 1, picture(10))
    const deleted = await insertNoteAttachment(user, note.id, 4, picture(20))
    await softDeleteNoteAttachment(user, note.id, deleted.id)
    await insertNoteAttachment(user, other.id, 1, picture(30))

    expect(await getNoteAttachmentUsage(user, note.id)).toEqual({
      account_bytes: 60,
      live_count: 1,
      max_position: 4,
    })
  })

  test('soft delete, restore and purge, only through a live note', async () => {
    const user = getTestUser()
    const note = await dayEntry(user)
    const stored = await insertNoteAttachment(user, note.id, 1, picture())

    expect(await softDeleteNoteAttachment(user, note.id, stored.id)).toBe(true)
    expect(await softDeleteNoteAttachment(user, note.id, stored.id)).toBe(false)
    expect(await getNoteAttachment(user, note.id, stored.id)).toBeNull()
    const deleted = await getNoteAttachment(user, note.id, stored.id, { include_deleted: true })
    expect(deleted?.deleted_at).toBeInstanceOf(Date)
    expect((await getDeletedNoteAttachments(user, note.id)).map((a) => a.id)).toEqual([stored.id])

    const restored = await restoreNoteAttachment(user, note.id, stored.id)
    expect(restored).toMatchObject({ deleted_at: undefined, id: stored.id })

    await softDeleteNote(user, note.id)
    expect(await softDeleteNoteAttachment(user, note.id, stored.id)).toBe(false)
    expect(await purgeNoteAttachment(user, note.id, stored.id)).toBe(false)
    expect(await restoreNoteAttachment(user, note.id, stored.id)).toBeNull()
  })

  test('purgeNoteAttachment removes it for good', async () => {
    const user = getTestUser()
    const note = await dayEntry(user)
    const stored = await insertNoteAttachment(user, note.id, 1, picture())
    expect(await purgeNoteAttachment(user, note.id, stored.id)).toBe(true)
    expect(await getNoteAttachment(user, note.id, stored.id, { include_deleted: true })).toBeNull()
  })

  test('a purged note takes its attachments along', async () => {
    const user = getTestUser()
    const note = await dayEntry(user)
    await insertNoteAttachment(user, note.id, 1, picture())
    await deleteNote(user, note.id)
    const left = await query(user, `SELECT COUNT(*)::int AS n FROM note_attachments`)
    expect(left.rows[0].n).toBe(0)
  })

  test('needs_text keeps the entries with a live picture and no text', async () => {
    const user = getTestUser()
    const blank = await dayEntry(user, '  \n ')
    const written = await dayEntry(user, 'Transcribed')
    const audioOnly = await dayEntry(user, '')
    const deletedPicture = await dayEntry(user, '')
    await dayEntry(user, '')
    await insertNoteAttachment(user, blank.id, 1, picture())
    await insertNoteAttachment(user, written.id, 1, picture())
    await insertNoteAttachment(user, audioOnly.id, 1, recording)
    const gone = await insertNoteAttachment(user, deletedPicture.id, 1, picture())
    await softDeleteNoteAttachment(user, deletedPicture.id, gone.id)

    const days = { from: '2024-01-15', to: '2024-01-15' }
    const ranged = await getNotesForTimeRange(user, DAY.start, DAY.end, days, { needs_text: true })
    expect(ranged.map((n) => n.id)).toEqual([blank.id])
    expect(await getNotesForTimeRange(user, DAY.start, DAY.end, days)).toHaveLength(5)

    const searched = await searchNotes(user, {
      entity_types: ['time', 'day'],
      limit: 50,
      needs_text: true,
      tz: 'UTC',
    })
    expect(searched.notes.map((n) => n.id)).toEqual([blank.id])
  })

  test('pruneDeletedNotes removes the attachments and templates deleted over 30 days ago', async () => {
    const user = getTestUser()
    const note = await dayEntry(user)
    const old = await insertNoteAttachment(user, note.id, 1, picture())
    const recent = await insertNoteAttachment(user, note.id, 2, picture())
    const live = await insertNoteAttachment(user, note.id, 3, picture())
    await softDeleteNoteAttachment(user, note.id, old.id)
    await softDeleteNoteAttachment(user, note.id, recent.id)
    await query(user, `UPDATE note_attachments SET deleted_at = NOW() - interval '31 days' WHERE id = $1`, [
      old.id,
    ])

    const oldTemplate = await insertNoteTemplate(user, { content: 'x', name: 'Old' })
    const recentTemplate = await insertNoteTemplate(user, { content: 'x', name: 'Recent' })
    await softDeleteNoteTemplate(user, oldTemplate.id)
    await softDeleteNoteTemplate(user, recentTemplate.id)
    await query(user, `UPDATE note_templates SET deleted_at = NOW() - interval '31 days' WHERE id = $1`, [
      oldTemplate.id,
    ])

    expect(await pruneDeletedNotes(user, 30)).toBe(2)

    const attachments = await query(user, `SELECT id FROM note_attachments ORDER BY position`)
    expect(attachments.rows.map((r) => r.id)).toEqual([recent.id, live.id])
    const templates = await query(user, `SELECT id FROM note_templates`)
    expect(templates.rows.map((r) => r.id)).toEqual([recentTemplate.id])
  })
})
