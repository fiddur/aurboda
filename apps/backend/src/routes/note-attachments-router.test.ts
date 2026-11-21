import express from 'express'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import supertest from 'supertest'
import { describe, expect, test, vi } from 'vitest'

import type { NoteAttachmentRecord } from '../db/index.ts'
import type { Note } from '../db/types.ts'

import { type NoteAttachmentDeps, processNoteAttachment } from '../services/note-attachments.ts'
import { createNoteAttachmentsRouter } from './note-attachments-router.ts'

const NOTE_ID = '9d0124e7-d161-4855-a54f-fa8bdb45c4f2'

const entry: Note = {
  content: '',
  created_at: new Date('2026-11-01T08:00:00Z'),
  date: '2026-11-01',
  entity_id: null,
  entity_type: 'day',
  id: NOTE_ID,
  updated_at: new Date('2026-11-01T08:00:00Z'),
}

const record = (overrides: Partial<NoteAttachmentRecord> = {}): NoteAttachmentRecord => ({
  created_at: new Date('2026-11-01T08:00:00Z'),
  height: 40,
  id: randomUUID(),
  kind: 'image',
  mime: 'image/webp',
  note_id: NOTE_ID,
  position: 1,
  size: 100,
  width: 20,
  ...overrides,
})

const makeDeps = (overrides: Partial<NoteAttachmentDeps> = {}): NoteAttachmentDeps => ({
  getAttachment: vi.fn(async () => record()),
  getBytes: vi.fn(async () => ({ bytes: Buffer.from('webp-bytes'), kind: 'image', mime: 'image/webp' })),
  getNoteById: vi.fn(async (user: string) => (user === 'tester' ? entry : null)),
  getStripMetadata: vi.fn(async () => false),
  getUsage: vi.fn(async () => ({ account_bytes: 0, live_count: 0, max_position: null })),
  insert: vi.fn(async (_user, _note, a) => ({
    ok: true as const,
    value: record({ height: a.height, kind: a.kind, mime: a.mime, size: a.bytes.length, width: a.width }),
  })),
  listDeleted: vi.fn(async () => [record({ deleted_at: new Date('2026-11-02T08:00:00Z') })]),
  listLive: vi.fn(async () => new Map([[NOTE_ID, [record()]]])),
  process: processNoteAttachment,
  purge: vi.fn(async () => true),
  resize: vi.fn(async () => Buffer.from('small')),
  restore: vi.fn(async () => ({ ok: true as const, value: record() })),
  softDelete: vi.fn(async () => true),
  toAssistantImage: vi.fn(async () => Buffer.from('jpeg')),
  ...overrides,
})

const buildApp = (deps: NoteAttachmentDeps, user = 'tester') => {
  const app = express()
  const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = user
    next()
  }
  app.use('/notes', createNoteAttachmentsRouter(auth, deps) as unknown as express.RequestHandler)
  return supertest(app)
}

const png = () =>
  sharp({ create: { background: { b: 0, g: 0, r: 255 }, channels: 3, height: 30, width: 60 } })
    .png()
    .toBuffer()

describe('POST /notes/:id/attachments', () => {
  test('stores an uploaded picture as WebP and answers its metadata', async () => {
    const deps = makeDeps()
    const res = await buildApp(deps)
      .post(`/notes/${NOTE_ID}/attachments`)
      .attach('file', await png(), { contentType: 'image/png', filename: 'page1.png' })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({
      height: 30,
      kind: 'image',
      mime: 'image/webp',
      position: 1,
      width: 60,
    })
    expect(res.body.data).not.toHaveProperty('bytes')
  })

  test('keeps a recording with the type its bytes say, not the claimed one', async () => {
    const deps = makeDeps()
    const ogg = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(64, 2)])
    const res = await buildApp(deps)
      .post(`/notes/${NOTE_ID}/attachments`)
      .attach('file', ogg, { contentType: 'audio/webm', filename: 'memo.webm' })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ kind: 'audio', mime: 'audio/ogg' })
  })

  test('refuses a file that is neither a picture nor a recording', async () => {
    const res = await buildApp(makeDeps())
      .post(`/notes/${NOTE_ID}/attachments`)
      .attach('file', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), {
        contentType: 'image/png',
        filename: 'x.png',
      })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('That is not a picture or a recording Aurboda can keep.')
  })

  test('answers 413 for a file over 20 MB', async () => {
    const res = await buildApp(makeDeps())
      .post(`/notes/${NOTE_ID}/attachments`)
      .attach('file', Buffer.alloc(20 * 1024 * 1024 + 1), { contentType: 'image/jpeg', filename: 'big.jpg' })
    expect(res.status).toBe(413)
  })

  test('answers 409 at the per-entry cap and 404 for another user’s entry', async () => {
    const full = makeDeps({
      getUsage: vi.fn(async () => ({ account_bytes: 0, live_count: 30, max_position: 30 })),
    })
    const res = await buildApp(full)
      .post(`/notes/${NOTE_ID}/attachments`)
      .attach('file', await png(), { contentType: 'image/png', filename: 'p.png' })
    expect(res.status).toBe(409)

    const other = await buildApp(makeDeps(), 'mallory')
      .post(`/notes/${NOTE_ID}/attachments`)
      .attach('file', await png(), { contentType: 'image/png', filename: 'p.png' })
    expect(other.status).toBe(404)
  })

  test('answers 400 without a file', async () => {
    const res = await buildApp(makeDeps()).post(`/notes/${NOTE_ID}/attachments`)
    expect(res.status).toBe(400)
  })
})

describe('GET /notes/:id/attachments/:attachment_id', () => {
  test('serves the bytes with the stored type and the safety and cache headers', async () => {
    const res = await buildApp(makeDeps()).get(`/notes/${NOTE_ID}/attachments/${randomUUID()}`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/webp')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['content-disposition']).toBe('inline')
    expect(res.headers['cache-control']).toBe('private, max-age=31536000, immutable')
    expect(Buffer.from(res.body).toString()).toBe('webp-bytes')
  })

  test('downscales with max_edge and refuses any other size', async () => {
    const deps = makeDeps()
    const id = randomUUID()
    const res = await buildApp(deps).get(`/notes/${NOTE_ID}/attachments/${id}`).query({ max_edge: '400' })
    expect(res.status).toBe(200)
    expect(Buffer.from(res.body).toString()).toBe('small')
    expect(deps.resize).toHaveBeenCalledWith(Buffer.from('webp-bytes'), 400)

    const bad = await buildApp(deps).get(`/notes/${NOTE_ID}/attachments/${id}`).query({ max_edge: '999' })
    expect(bad.status).toBe(400)
  })

  test('is a 404 to anyone but the owner and for a deleted one', async () => {
    const deps = makeDeps({ getAttachment: vi.fn(async () => null) })
    const res = await buildApp(deps).get(`/notes/${NOTE_ID}/attachments/${randomUUID()}`)
    expect(res.status).toBe(404)
    expect(deps.getBytes).not.toHaveBeenCalled()
  })
})

describe('listing, deleting and restoring', () => {
  test('lists the live ones, or the deleted ones with purge_at', async () => {
    const live = await buildApp(makeDeps()).get(`/notes/${NOTE_ID}/attachments`)
    expect(live.status).toBe(200)
    expect(live.body.data).toHaveLength(1)

    const deleted = await buildApp(makeDeps()).get(`/notes/${NOTE_ID}/attachments`).query({ deleted: 'true' })
    expect(deleted.body.data[0]).toMatchObject({
      deleted_at: '2026-11-02T08:00:00.000Z',
      purge_at: '2026-12-02T08:00:00.000Z',
    })
  })

  test('deletes softly, purges on request, and 404s what is not there', async () => {
    const deps = makeDeps()
    const id = randomUUID()
    expect((await buildApp(deps).delete(`/notes/${NOTE_ID}/attachments/${id}`)).status).toBe(200)
    expect(deps.softDelete).toHaveBeenCalledWith('tester', NOTE_ID, id)
    expect((await buildApp(deps).delete(`/notes/${NOTE_ID}/attachments/${id}?purge=true`)).status).toBe(200)
    expect(deps.purge).toHaveBeenCalledWith('tester', NOTE_ID, id)

    const missing = makeDeps({ softDelete: vi.fn(async () => false) })
    expect((await buildApp(missing).delete(`/notes/${NOTE_ID}/attachments/${id}`)).status).toBe(404)
  })

  test('restores, and answers 409 at the cap', async () => {
    const deleted = () => record({ deleted_at: new Date('2026-11-02T08:00:00Z') })
    const ok = await buildApp(makeDeps({ getAttachment: vi.fn(async () => deleted()) })).post(
      `/notes/${NOTE_ID}/attachments/${randomUUID()}/restore`,
    )
    expect(ok.status).toBe(200)

    const full = makeDeps({
      getAttachment: vi.fn(async () => deleted()),
      restore: vi.fn(async () => ({ ok: false as const, reason: 'note_limit' as const })),
    })
    const refused = await buildApp(full).post(`/notes/${NOTE_ID}/attachments/${randomUUID()}/restore`)
    expect(refused.status).toBe(409)
  })
})
