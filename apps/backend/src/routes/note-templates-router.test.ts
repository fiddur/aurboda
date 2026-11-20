import express from 'express'
import { randomUUID } from 'node:crypto'
import supertest from 'supertest'
import { describe, expect, test, vi } from 'vitest'

import type { NoteTemplateRecord } from '../db/index.ts'
import type { NoteTemplateDeps } from '../services/note-templates.ts'

import { createNoteTemplatesRouter } from './note-templates-router.ts'

const ID = randomUUID()

const record = (overrides: Partial<NoteTemplateRecord> = {}): NoteTemplateRecord => ({
  content: '## Mood',
  created_at: new Date('2026-11-01T08:00:00Z'),
  id: ID,
  name: 'Evening',
  updated_at: new Date('2026-11-01T08:00:00Z'),
  ...overrides,
})

const makeDeps = (overrides: Partial<NoteTemplateDeps> = {}): NoteTemplateDeps => ({
  insert: vi.fn(async (_user, t) => record(t)),
  list: vi.fn(async () => [record()]),
  purge: vi.fn(async () => true),
  restore: vi.fn(async () => record()),
  softDelete: vi.fn(async () => true),
  update: vi.fn(async (_user, _id, fields) => record(fields)),
  ...overrides,
})

const buildApp = (deps: NoteTemplateDeps) => {
  const app = express()
  app.use(express.json())
  const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = 'tester'
    next()
  }
  app.use('/note-templates', createNoteTemplatesRouter(auth, deps) as unknown as express.RequestHandler)
  return supertest(app)
}

describe('/note-templates', () => {
  test('lists the live templates, or the deleted ones', async () => {
    const deps = makeDeps()
    const res = await buildApp(deps).get('/note-templates')
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([
      {
        content: '## Mood',
        created_at: '2026-11-01T08:00:00.000Z',
        id: ID,
        name: 'Evening',
        updated_at: '2026-11-01T08:00:00.000Z',
      },
    ])
    await buildApp(deps).get('/note-templates').query({ deleted: 'true' })
    expect(deps.list).toHaveBeenLastCalledWith('tester', { deleted: true })
  })

  test('adds one, trimming the name, and refuses an invalid body', async () => {
    const deps = makeDeps()
    const res = await buildApp(deps).post('/note-templates').send({ content: 'Today', name: ' Morning ' })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ content: 'Today', name: 'Morning' })
    expect((await buildApp(deps).post('/note-templates').send({ content: '', name: 'x' })).status).toBe(400)
  })

  test('updates one, needs a field, and 404s a missing one', async () => {
    const deps = makeDeps()
    const res = await buildApp(deps).patch(`/note-templates/${ID}`).send({ name: 'Night' })
    expect(res.status).toBe(200)
    expect(res.body.data.name).toBe('Night')
    expect((await buildApp(deps).patch(`/note-templates/${ID}`).send({})).status).toBe(400)
    const missing = makeDeps({ update: vi.fn(async () => null) })
    expect((await buildApp(missing).patch(`/note-templates/${ID}`).send({ name: 'x' })).status).toBe(404)
  })

  test('deletes softly, purges on request, and restores', async () => {
    const deps = makeDeps()
    expect((await buildApp(deps).delete(`/note-templates/${ID}`)).status).toBe(200)
    expect(deps.softDelete).toHaveBeenCalledWith('tester', ID)
    expect((await buildApp(deps).delete(`/note-templates/${ID}?purge=true`)).status).toBe(200)
    expect(deps.purge).toHaveBeenCalledWith('tester', ID)
    const restored = await buildApp(deps).post(`/note-templates/${ID}/restore`)
    expect(restored.status).toBe(200)
    expect(restored.body.data.id).toBe(ID)

    const missing = makeDeps({ restore: vi.fn(async () => null), softDelete: vi.fn(async () => false) })
    expect((await buildApp(missing).delete(`/note-templates/${ID}`)).status).toBe(404)
    expect((await buildApp(missing).post(`/note-templates/${ID}/restore`)).status).toBe(404)
  })
})
