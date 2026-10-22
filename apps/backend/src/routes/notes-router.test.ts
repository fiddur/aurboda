import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { createNotesRouter } from './notes-router.ts'

vi.mock('../services/mutations.ts', () => ({
  addNote: vi.fn(),
  deleteNoteById: vi.fn(),
  getNotesForEntity: vi.fn(),
  getNotesInRange: vi.fn(),
  updateNote: vi.fn(),
}))

const mutations = await import('../services/mutations.ts')

const NOTE_ID = '9d0124e7-d161-4855-a54f-fa8bdb45c4f2'
const ENTITY_ID = '2d0124e7-d161-4855-a54f-fa8bdb45c4f3'

const buildApp = () => {
  const app = express()
  app.use(express.json())
  const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = 'tester'
    next()
  }
  app.use(createNotesRouter(auth) as unknown as express.RequestHandler)
  return app
}

const noteData = {
  content: 'Felt dizzy',
  created_at: '2024-01-15T12:00:00.000Z',
  entity_id: null,
  entity_type: 'time' as const,
  id: NOTE_ID,
  replies: [],
  start_time: '2024-01-15T12:00:00.000Z',
  updated_at: '2024-01-15T12:00:00.000Z',
}

describe('GET /notes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('lists an entity’s comments when entity params are given', async () => {
    vi.mocked(mutations.getNotesForEntity).mockResolvedValue([noteData])

    const res = await supertest(buildApp()).get('/').query({ entity_id: ENTITY_ID, entity_type: 'activity' })

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(mutations.getNotesForEntity).toHaveBeenCalledWith('tester', 'activity', ENTITY_ID)
    expect(mutations.getNotesInRange).not.toHaveBeenCalled()
  })

  test('lists comments in a time range when from/to are given', async () => {
    vi.mocked(mutations.getNotesInRange).mockResolvedValue([noteData])

    const res = await supertest(buildApp())
      .get('/')
      .query({ from: '2024-01-15T00:00:00Z', to: '2024-01-15T23:59:59Z' })

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(mutations.getNotesInRange).toHaveBeenCalledWith(
      'tester',
      new Date('2024-01-15T00:00:00Z'),
      new Date('2024-01-15T23:59:59Z'),
    )
    expect(mutations.getNotesForEntity).not.toHaveBeenCalled()
  })

  test('400s when a range query is missing `to`', async () => {
    const res = await supertest(buildApp()).get('/').query({ from: '2024-01-15T00:00:00Z' })

    expect(res.status).toBe(400)
    expect(mutations.getNotesInRange).not.toHaveBeenCalled()
  })

  test('400s when neither shape matches', async () => {
    const res = await supertest(buildApp()).get('/')

    expect(res.status).toBe(400)
    expect(mutations.getNotesForEntity).not.toHaveBeenCalled()
    expect(mutations.getNotesInRange).not.toHaveBeenCalled()
  })
})

describe('POST /notes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('creates a time comment', async () => {
    vi.mocked(mutations.addNote).mockResolvedValue({ data: noteData, success: true })

    const res = await supertest(buildApp())
      .post('/')
      .send({ content: 'Felt dizzy', entity_type: 'time', start_time: '2024-01-15T12:00:00Z' })

    expect(res.status).toBe(200)
    expect(mutations.addNote).toHaveBeenCalledWith('tester', {
      content: 'Felt dizzy',
      end_time: undefined,
      entity_id: undefined,
      entity_type: 'time',
      start_time: '2024-01-15T12:00:00Z',
    })
  })

  test('400s on a time comment without start_time', async () => {
    const res = await supertest(buildApp()).post('/').send({ content: 'When?', entity_type: 'time' })

    expect(res.status).toBe(400)
    expect(mutations.addNote).not.toHaveBeenCalled()
  })

  test('400s when times are set on a comment anchored to an entity', async () => {
    const res = await supertest(buildApp()).post('/').send({
      content: 'Nope',
      entity_id: ENTITY_ID,
      entity_type: 'activity',
      start_time: '2024-01-15T12:00:00Z',
    })

    expect(res.status).toBe(400)
    expect(mutations.addNote).not.toHaveBeenCalled()
  })

  test('400s when the service rejects the shape', async () => {
    vi.mocked(mutations.addNote).mockResolvedValue({
      error: 'Comment to reply to not found',
      success: false,
    })

    const res = await supertest(buildApp())
      .post('/')
      .send({ content: 'Me too', entity_id: NOTE_ID, entity_type: 'note' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Comment to reply to not found')
  })
})

describe('PATCH /notes/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('updates the content', async () => {
    vi.mocked(mutations.updateNote).mockResolvedValue({ data: noteData, success: true })

    const res = await supertest(buildApp()).patch(`/${NOTE_ID}`).send({ content: 'Reworded' })

    expect(res.status).toBe(200)
    expect(mutations.updateNote).toHaveBeenCalledWith('tester', NOTE_ID, {
      content: 'Reworded',
      end_time: undefined,
      start_time: undefined,
    })
  })

  test('400s when no field is provided', async () => {
    const res = await supertest(buildApp()).patch(`/${NOTE_ID}`).send({})

    expect(res.status).toBe(400)
    expect(mutations.updateNote).not.toHaveBeenCalled()
  })

  test('404s when the note does not exist', async () => {
    vi.mocked(mutations.updateNote).mockResolvedValue({ error: 'Note not found', success: false })

    const res = await supertest(buildApp()).patch(`/${NOTE_ID}`).send({ content: 'Reworded' })

    expect(res.status).toBe(404)
  })

  test('400s when times are set on a comment anchored to an entity', async () => {
    vi.mocked(mutations.updateNote).mockResolvedValue({
      error: 'Times can only be set on a time-anchored comment',
      success: false,
    })

    const res = await supertest(buildApp()).patch(`/${NOTE_ID}`).send({ start_time: '2024-01-15T12:00:00Z' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Times can only be set on a time-anchored comment')
  })
})

describe('DELETE /notes/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('deletes the comment', async () => {
    vi.mocked(mutations.deleteNoteById).mockResolvedValue({ deleted: true, success: true })

    const res = await supertest(buildApp()).delete(`/${NOTE_ID}`)

    expect(res.status).toBe(200)
    expect(mutations.deleteNoteById).toHaveBeenCalledWith('tester', NOTE_ID)
  })

  test('404s when nothing was deleted', async () => {
    vi.mocked(mutations.deleteNoteById).mockResolvedValue({ deleted: false, success: false })

    const res = await supertest(buildApp()).delete(`/${NOTE_ID}`)

    expect(res.status).toBe(404)
  })
})
