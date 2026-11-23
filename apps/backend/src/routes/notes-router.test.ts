import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { createNotesRouter } from './notes-router.ts'

vi.mock('../services/mutations.ts', () => ({
  addNote: vi.fn(),
  deleteNoteById: vi.fn(),
  getJournalNeighbors: vi.fn(),
  getNoteForUser: vi.fn(),
  getNoteRevisionsById: vi.fn(),
  getNotesForEntity: vi.fn(),
  getNotesInRange: vi.fn(),
  listDeletedNotes: vi.fn(),
  listNoteTagsForUser: vi.fn(),
  mergeNoteTags: vi.fn(),
  restoreNoteById: vi.fn(),
  searchNotesForUser: vi.fn(),
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
  tags: [],
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
      undefined,
      { needs_text: undefined },
    )
    expect(mutations.getNotesForEntity).not.toHaveBeenCalled()
  })

  test('reads the day entries in the given timezone', async () => {
    vi.mocked(mutations.getNotesInRange).mockResolvedValue([])

    const res = await supertest(buildApp())
      .get('/')
      .query({ from: '2024-01-15T00:00:00Z', to: '2024-01-15T23:59:59Z', tz: 'Europe/Stockholm' })

    expect(res.status).toBe(200)
    expect(vi.mocked(mutations.getNotesInRange).mock.calls[0]![3]).toBe('Europe/Stockholm')
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

describe('GET /notes/search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('passes the query to the search and answers the page', async () => {
    vi.mocked(mutations.searchNotesForUser).mockResolvedValue({
      data: [noteData],
      next_cursor: 'abc',
      success: true,
    })

    const res = await supertest(buildApp())
      .get('/search')
      .query({ from: '2024-01-01', limit: '10', q: 'walk', tags: 'travel', tz: 'Europe/Stockholm' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: [noteData], next_cursor: 'abc', success: true })
    expect(mutations.searchNotesForUser).toHaveBeenCalledWith('tester', {
      from: '2024-01-01',
      limit: 10,
      q: 'walk',
      tags: 'travel',
      tz: 'Europe/Stockholm',
    })
  })

  test.each([
    ['replies as a root type', { entity_types: 'note' }],
    ['an invalid tag', { tags: 'not a tag' }],
    ['a limit over 200', { limit: '201' }],
    ['an unknown timezone', { tz: 'Mars/Olympus' }],
    ['a date off the calendar', { on_this_day: '2023-02-29' }],
  ])('400s on %s', async (_label, query) => {
    const res = await supertest(buildApp()).get('/search').query(query)

    expect(res.status).toBe(400)
    expect(mutations.searchNotesForUser).not.toHaveBeenCalled()
  })

  test('400s when the service refuses', async () => {
    vi.mocked(mutations.searchNotesForUser).mockResolvedValue({
      error: 'Not a valid cursor',
      errorCode: 'invalid',
      success: false,
    })

    const res = await supertest(buildApp()).get('/search').query({ cursor: 'x' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Not a valid cursor')
  })
})

describe('GET /notes/deleted', () => {
  test('lists what can be restored', async () => {
    const deleted = {
      ...noteData,
      deleted_at: '2024-01-16T00:00:00.000Z',
      purge_at: '2024-02-15T00:00:00.000Z',
    }
    vi.mocked(mutations.listDeletedNotes).mockResolvedValue([deleted])

    const res = await supertest(buildApp()).get('/deleted')

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([deleted])
  })
})

describe('POST /notes/:id/restore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('answers the restored comment', async () => {
    vi.mocked(mutations.restoreNoteById).mockResolvedValue({ data: noteData, success: true })

    const res = await supertest(buildApp()).post(`/${NOTE_ID}/restore`)

    expect(res.status).toBe(200)
    expect(mutations.restoreNoteById).toHaveBeenCalledWith('tester', NOTE_ID)
  })

  test('409s on a reply whose root is deleted, 404s on an unknown one', async () => {
    vi.mocked(mutations.restoreNoteById).mockResolvedValueOnce({
      error: 'Restore the comment it replies to first',
      errorCode: 'conflict',
      success: false,
    })
    vi.mocked(mutations.restoreNoteById).mockResolvedValueOnce({
      error: 'Note not found',
      errorCode: 'not_found',
      success: false,
    })

    expect((await supertest(buildApp()).post(`/${NOTE_ID}/restore`)).status).toBe(409)
    expect((await supertest(buildApp()).post(`/${NOTE_ID}/restore`)).status).toBe(404)
  })
})

describe('GET /notes/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('answers the comment', async () => {
    vi.mocked(mutations.getNoteForUser).mockResolvedValue({ data: noteData, success: true })

    const res = await supertest(buildApp()).get(`/${NOTE_ID}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(noteData)
    expect(mutations.getNoteForUser).toHaveBeenCalledWith('tester', NOTE_ID)
  })

  test('404s on an unknown comment', async () => {
    vi.mocked(mutations.getNoteForUser).mockResolvedValue({
      error: 'Note not found',
      errorCode: 'not_found',
      success: false,
    })

    expect((await supertest(buildApp()).get(`/${NOTE_ID}`)).status).toBe(404)
  })

  test('/search and /deleted are not taken for ids', async () => {
    vi.mocked(mutations.listDeletedNotes).mockResolvedValue([])

    expect((await supertest(buildApp()).get('/deleted')).status).toBe(200)
    expect(mutations.getNoteForUser).not.toHaveBeenCalled()
  })
})

describe('GET /notes/:id/revisions', () => {
  test('lists the revisions', async () => {
    const revision = { content: 'Before', id: ENTITY_ID, saved_at: '2024-01-15T12:00:00.000Z' }
    vi.mocked(mutations.getNoteRevisionsById).mockResolvedValue({ data: [revision], success: true })

    const res = await supertest(buildApp()).get(`/${NOTE_ID}/revisions`)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([revision])
  })

  test('404s on an unknown comment', async () => {
    vi.mocked(mutations.getNoteRevisionsById).mockResolvedValue({ error: 'Note not found', success: false })

    expect((await supertest(buildApp()).get(`/${NOTE_ID}/revisions`)).status).toBe(404)
  })
})

describe('GET /notes/:id/neighbors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('answers the older and newer entries, reading tz', async () => {
    const neighbors = {
      next: { date: '2024-01-16', entity_type: 'day' as const, excerpt: 'Newer', id: ENTITY_ID },
      previous: undefined,
    }
    vi.mocked(mutations.getJournalNeighbors).mockResolvedValue(neighbors)

    const res = await supertest(buildApp()).get(`/${NOTE_ID}/neighbors`).query({ tz: 'Europe/Stockholm' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: { next: neighbors.next }, success: true })
    expect(mutations.getJournalNeighbors).toHaveBeenCalledWith('tester', NOTE_ID, 'Europe/Stockholm')
  })

  test('404 when it is not a Journal entry', async () => {
    vi.mocked(mutations.getJournalNeighbors).mockResolvedValue(null)

    const res = await supertest(buildApp()).get(`/${NOTE_ID}/neighbors`)

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Journal entry not found', success: false })
    expect(mutations.getJournalNeighbors).toHaveBeenCalledWith('tester', NOTE_ID, undefined)
  })

  test('400 for an unknown zone', async () => {
    const res = await supertest(buildApp()).get(`/${NOTE_ID}/neighbors`).query({ tz: 'Mars/Olympus' })

    expect(res.status).toBe(400)
    expect(mutations.getJournalNeighbors).not.toHaveBeenCalled()
  })
})

describe('GET /notes/tags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('answers the tags, passing entity_types and tz on', async () => {
    const tags = [{ count: 2, last_used: '2024-01-15T08:00:00.000Z', tag: 'run' }]
    vi.mocked(mutations.listNoteTagsForUser).mockResolvedValue({ data: tags, success: true })

    const res = await supertest(buildApp()).get('/tags').query({ entity_types: 'time,activity', tz: 'UTC' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: tags, success: true })
    expect(mutations.listNoteTagsForUser).toHaveBeenCalledWith('tester', {
      entity_types: 'time,activity',
      tz: 'UTC',
    })
    expect(mutations.getNoteForUser).not.toHaveBeenCalled()
  })

  test('400 for an entity type that is not a root type', async () => {
    const res = await supertest(buildApp()).get('/tags').query({ entity_types: 'note' })

    expect(res.status).toBe(400)
    expect(mutations.listNoteTagsForUser).not.toHaveBeenCalled()
  })
})

describe('POST /notes/tags/merge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('answers how many notes changed', async () => {
    vi.mocked(mutations.mergeNoteTags).mockResolvedValue({ data: { changed: 3 }, success: true })

    const res = await supertest(buildApp())
      .post('/tags/merge')
      .send({ from: ['running', 'jog'], into: 'run' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: { changed: 3 }, success: true })
    expect(mutations.mergeNoteTags).toHaveBeenCalledWith('tester', { from: ['running', 'jog'], into: 'run' })
  })

  test('400 when into is one of from, a tag is invalid or from is empty', async () => {
    for (const body of [
      { from: ['run', 'jog'], into: '#Run' },
      { from: ['run'], into: '123' },
      { from: [], into: 'run' },
      { into: 'run' },
    ]) {
      const res = await supertest(buildApp()).post('/tags/merge').send(body)
      expect(res.status).toBe(400)
    }
    expect(mutations.mergeNoteTags).not.toHaveBeenCalled()
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

  test('creates a day entry with a title and tags, empty text allowed', async () => {
    vi.mocked(mutations.addNote).mockResolvedValue({ data: noteData, success: true })

    const res = await supertest(buildApp())
      .post('/')
      .send({ content: '', date: '2024-01-20', entity_type: 'day', tags: ['travel'], title: 'Away' })

    expect(res.status).toBe(200)
    expect(mutations.addNote).toHaveBeenCalledWith('tester', {
      content: '',
      date: '2024-01-20',
      entity_type: 'day',
      tags: ['travel'],
      title: 'Away',
    })
  })

  test.each([
    ['a day entry without a date', { content: 'x', entity_type: 'day' }],
    [
      'a date on a time comment',
      { content: 'x', date: '2024-01-20', entity_type: 'time', start_time: '2024-01-20T12:00:00Z' },
    ],
    ['empty text on an entity comment', { content: '', entity_id: ENTITY_ID, entity_type: 'activity' }],
    ['a title on a reply', { content: 'x', entity_id: NOTE_ID, entity_type: 'note', title: 'No' }],
    ['an invalid tag', { content: 'x', date: '2024-01-20', entity_type: 'day', tags: ['two words'] }],
  ])('400s on %s', async (_label, body) => {
    const res = await supertest(buildApp()).post('/').send(body)

    expect(res.status).toBe(400)
    expect(mutations.addNote).not.toHaveBeenCalled()
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

  test('400s on a time comment whose end precedes its start', async () => {
    const res = await supertest(buildApp()).post('/').send({
      content: 'Backwards',
      end_time: '2024-01-15T11:00:00Z',
      entity_type: 'time',
      start_time: '2024-01-15T12:00:00Z',
    })

    expect(res.status).toBe(400)
    expect(mutations.addNote).not.toHaveBeenCalled()
  })

  test.each(['activity', 'productivity', 'report', 'meal', 'note'])(
    '400s on a non-UUID entity_id for entity_type %s',
    async (entityType) => {
      const res = await supertest(buildApp())
        .post('/')
        .send({ content: 'Hm', entity_id: 'not-a-uuid', entity_type: entityType })

      expect(res.status).toBe(400)
      expect(mutations.addNote).not.toHaveBeenCalled()
    },
  )

  test('accepts a composite metric entity_id', async () => {
    vi.mocked(mutations.addNote).mockResolvedValue({ data: noteData, success: true })

    const res = await supertest(buildApp()).post('/').send({
      content: 'Spike',
      entity_id: '2024-01-15T10:30:00.000Z|heart_rate|oura',
      entity_type: 'metric',
    })

    expect(res.status).toBe(200)
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

describe('related on POST and PATCH /notes and the search filter', () => {
  const PERSON_ID = '3d0124e7-d161-4855-a54f-fa8bdb45c4f4'
  const related = [{ entity_id: PERSON_ID, entity_type: 'person' }]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('POST passes related to the service', async () => {
    vi.mocked(mutations.addNote).mockResolvedValue({ data: noteData, success: true })

    const res = await supertest(buildApp())
      .post('/')
      .send({ content: '', date: '2024-01-20', entity_type: 'day', related })

    expect(res.status).toBe(200)
    expect(mutations.addNote).toHaveBeenCalledWith('tester', expect.objectContaining({ related }))
  })

  test('PATCH takes related alone, [] included', async () => {
    vi.mocked(mutations.updateNote).mockResolvedValue({ data: noteData, success: true })

    for (const list of [related, []]) {
      const res = await supertest(buildApp()).patch(`/${NOTE_ID}`).send({ related: list })
      expect(res.status).toBe(200)
    }
    expect(vi.mocked(mutations.updateNote).mock.calls.map((call) => call[2])).toEqual([
      { related },
      { related: [] },
    ])
  })

  test.each([
    ['related on a reply', { content: 'x', entity_id: NOTE_ID, entity_type: 'note', related }],
    [
      'a malformed id',
      {
        content: '',
        date: '2024-01-20',
        entity_type: 'day',
        related: [{ entity_id: 'x', entity_type: 'person' }],
      },
    ],
    [
      'an unknown kind',
      {
        content: '',
        date: '2024-01-20',
        entity_type: 'day',
        related: [{ entity_id: PERSON_ID, entity_type: 'meal' }],
      },
    ],
    [
      'more than 30',
      {
        content: '',
        date: '2024-01-20',
        entity_type: 'day',
        related: Array.from({ length: 31 }, () => related[0]),
      },
    ],
  ])('POST 400s on %s', async (_label, body) => {
    const res = await supertest(buildApp()).post('/').send(body)

    expect(res.status).toBe(400)
    expect(mutations.addNote).not.toHaveBeenCalled()
  })

  test('POST answers the service refusing an unknown target with a 400', async () => {
    vi.mocked(mutations.addNote).mockResolvedValue({
      error: `Unknown person: ${PERSON_ID}`,
      errorCode: 'invalid',
      success: false,
    })

    const res = await supertest(buildApp())
      .post('/')
      .send({ content: '', date: '2024-01-20', entity_type: 'day', related })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe(`Unknown person: ${PERSON_ID}`)
  })

  test('GET /search passes related_type and related_id, and 400s on one without the other', async () => {
    vi.mocked(mutations.searchNotesForUser).mockResolvedValue({ data: [], next_cursor: null, success: true })

    const ok = await supertest(buildApp())
      .get('/search')
      .query({ related_id: PERSON_ID, related_type: 'person' })
    expect(ok.status).toBe(200)
    expect(mutations.searchNotesForUser).toHaveBeenCalledWith('tester', {
      related_id: PERSON_ID,
      related_type: 'person',
    })

    vi.clearAllMocks()
    for (const query of [
      { related_type: 'person' },
      { related_id: PERSON_ID },
      { related_id: 'x', related_type: 'person' },
    ]) {
      const res = await supertest(buildApp()).get('/search').query(query)
      expect(res.status).toBe(400)
    }
    expect(mutations.searchNotesForUser).not.toHaveBeenCalled()
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
    vi.mocked(mutations.updateNote).mockResolvedValue({
      error: 'Note not found',
      errorCode: 'not_found',
      success: false,
    })

    const res = await supertest(buildApp()).patch(`/${NOTE_ID}`).send({ content: 'Reworded' })

    expect(res.status).toBe(404)
  })

  test('400s on an invalid errorCode, whatever the message says', async () => {
    vi.mocked(mutations.updateNote).mockResolvedValue({
      error: 'Note not found',
      errorCode: 'invalid',
      success: false,
    })

    const res = await supertest(buildApp()).patch(`/${NOTE_ID}`).send({ content: 'Reworded' })

    expect(res.status).toBe(400)
  })

  test('passes the journal fields and expected_updated_at through', async () => {
    vi.mocked(mutations.updateNote).mockResolvedValue({ data: noteData, success: true })
    const body = {
      date: '2024-01-20',
      expected_updated_at: '2024-01-15T12:00:00.000Z',
      tags: ['travel'],
      title: null,
    }

    const res = await supertest(buildApp()).patch(`/${NOTE_ID}`).send(body)

    expect(res.status).toBe(200)
    expect(mutations.updateNote).toHaveBeenCalledWith('tester', NOTE_ID, body)
  })

  test('409s with the current comment when it was changed elsewhere', async () => {
    vi.mocked(mutations.updateNote).mockResolvedValue({
      data: noteData,
      error: 'This comment was changed elsewhere',
      errorCode: 'conflict',
      success: false,
    })

    const res = await supertest(buildApp())
      .patch(`/${NOTE_ID}`)
      .send({ content: 'Mine', expected_updated_at: '2024-01-15T11:00:00.000Z' })

    expect(res.status).toBe(409)
    expect(res.body).toEqual({ data: noteData, error: 'This comment was changed elsewhere', success: false })
  })

  test('400s on a date together with a start_time', async () => {
    const res = await supertest(buildApp())
      .patch(`/${NOTE_ID}`)
      .send({ date: '2024-01-20', start_time: '2024-01-20T12:00:00Z' })

    expect(res.status).toBe(400)
    expect(mutations.updateNote).not.toHaveBeenCalled()
  })

  test('400s when the end is moved before the start', async () => {
    const res = await supertest(buildApp())
      .patch(`/${NOTE_ID}`)
      .send({ end_time: '2024-01-15T11:00:00Z', start_time: '2024-01-15T12:00:00Z' })

    expect(res.status).toBe(400)
    expect(mutations.updateNote).not.toHaveBeenCalled()
  })

  test('400s when times are set on a comment anchored to an entity', async () => {
    vi.mocked(mutations.updateNote).mockResolvedValue({
      error: 'Times can only be set on a time-anchored comment',
      errorCode: 'invalid',
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
    expect(mutations.deleteNoteById).toHaveBeenCalledWith('tester', NOTE_ID, { purge: false })
  })

  test('purges with ?purge=true', async () => {
    vi.mocked(mutations.deleteNoteById).mockResolvedValue({ deleted: true, success: true })

    const res = await supertest(buildApp()).delete(`/${NOTE_ID}`).query({ purge: 'true' })

    expect(res.status).toBe(200)
    expect(mutations.deleteNoteById).toHaveBeenCalledWith('tester', NOTE_ID, { purge: true })
  })

  test('400s on a purge flag that is not a boolean', async () => {
    const res = await supertest(buildApp()).delete(`/${NOTE_ID}`).query({ purge: 'maybe' })

    expect(res.status).toBe(400)
    expect(mutations.deleteNoteById).not.toHaveBeenCalled()
  })

  test('404s when nothing was deleted', async () => {
    vi.mocked(mutations.deleteNoteById).mockResolvedValue({ deleted: false, success: false })

    const res = await supertest(buildApp()).delete(`/${NOTE_ID}`)

    expect(res.status).toBe(404)
  })
})
