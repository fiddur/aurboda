import express from 'express'
import supertest from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { query } from '../db/connection.ts'
import { insertPerson, restorePerson, softDeletePerson } from '../db/people.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { createNotesRouter } from './notes-router.ts'

const CONTAINER_TIMEOUT = 120_000

const buildApp = (user: string) => {
  const app = express()
  app.use(express.json())
  const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = user
    next()
  }
  app.use('/notes', createNotesRouter(auth) as unknown as express.RequestHandler)
  return app
}

describe('notes about a person', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('a deleted person has no notes, and restoring them brings the notes back', async () => {
    const user = getTestUser()
    const anna = await insertPerson(user, { name: 'Anna' })
    const request = supertest(buildApp(user))
    const added = await request
      .post('/notes')
      .send({ content: 'Loves rhubarb', entity_id: anna.id, entity_type: 'person' })
    expect(added.status).toBe(200)
    const list = () => request.get('/notes').query({ entity_id: anna.id, entity_type: 'person' })

    expect((await list()).body.data).toHaveLength(1)
    await softDeletePerson(user, anna.id)
    const hidden = await list()
    expect(hidden.status).toBe(200)
    expect(hidden.body.data).toEqual([])
    await restorePerson(user, anna.id)
    expect((await list()).body.data.map((n: { content: string }) => n.content)).toEqual(['Loves rhubarb'])
  })

  test('a malformed or unknown person id answers an empty list, and adding to one is refused', async () => {
    const user = getTestUser()
    const request = supertest(buildApp(user))
    for (const id of ['not-a-uuid', '99999999-9999-4999-8999-999999999999']) {
      const res = await request.get('/notes').query({ entity_id: id, entity_type: 'person' })
      expect(res.status).toBe(200)
      expect(res.body.data).toEqual([])
    }
    const malformed = await request
      .post('/notes')
      .send({ content: 'x', entity_id: 'not-a-uuid', entity_type: 'person' })
    expect(malformed.status).toBe(400)
    const unknown = await request
      .post('/notes')
      .send({ content: 'x', entity_id: '99999999-9999-4999-8999-999999999999', entity_type: 'person' })
    expect(unknown.status).toBe(400)
    expect(unknown.body.error).toBe('Person not found')
  })
})

describe('notes related to people and activities', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('related is written, answered, replaced, filtered on and refused for an unknown target', async () => {
    const user = getTestUser()
    const anna = await insertPerson(user, { name: 'Anna' })
    const bo = await insertPerson(user, { name: 'Bo' })
    const request = supertest(buildApp(user))

    const added = await request.post('/notes').send({
      content: 'Dinner',
      date: '2026-11-20',
      entity_type: 'day',
      related: [{ entity_id: anna.id, entity_type: 'person' }],
    })
    expect(added.status).toBe(200)
    expect(added.body.data.related).toEqual([{ entity_id: anna.id, entity_type: 'person', label: 'Anna' }])
    const id = added.body.data.id as string

    const unknown = await request.patch(`/notes/${id}`).send({
      related: [{ entity_id: '99999999-9999-4999-8999-999999999999', entity_type: 'activity' }],
    })
    expect(unknown.status).toBe(400)
    expect(unknown.body.error).toBe('Unknown activity: 99999999-9999-4999-8999-999999999999')

    const replaced = await request.patch(`/notes/${id}`).send({
      expected_updated_at: added.body.data.updated_at,
      related: [{ entity_id: bo.id, entity_type: 'person' }],
    })
    expect(replaced.status).toBe(200)
    expect(replaced.body.data.related.map((r: { label: string }) => r.label)).toEqual(['Bo'])
    expect(replaced.body.data.content).toBe('Dinner')

    const stale = await request.patch(`/notes/${id}`).send({
      expected_updated_at: added.body.data.updated_at,
      related: [],
    })
    expect(stale.status).toBe(409)

    const revisions = await request.get(`/notes/${id}/revisions`)
    expect(revisions.body.data).toEqual([])

    const search = (personId: string) =>
      request.get('/notes/search').query({ related_id: personId, related_type: 'person' })
    expect((await search(bo.id)).body.data.map((n: { id: string }) => n.id)).toEqual([id])
    expect((await search(anna.id)).body.data).toEqual([])

    const reply = await request.post('/notes').send({
      content: 'Reply',
      entity_id: id,
      entity_type: 'note',
      related: [{ entity_id: bo.id, entity_type: 'person' }],
    })
    expect(reply.status).toBe(400)
  })
})

describe('journal tags', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('are listed, and merging rewrites hashtags and explicit tags, keeping a revision', async () => {
    const user = getTestUser()
    const request = supertest(buildApp(user))
    const byHashtag = await request.post('/notes').send({
      content: 'Went #Running by the river',
      entity_type: 'time',
      start_time: '2024-01-15T08:00:00Z',
    })
    const byTag = await request.post('/notes').send({
      content: 'Long day',
      entity_type: 'time',
      start_time: '2024-01-16T08:00:00Z',
      tags: ['running', 'travel'],
    })
    expect(byHashtag.status).toBe(200)
    expect(byTag.status).toBe(200)

    const listed = await request.get('/notes/tags').query({ tz: 'UTC' })
    expect(listed.status).toBe(200)
    expect(listed.body.data).toEqual([
      { count: 2, last_used: '2024-01-16T08:00:00.000Z', tag: 'running' },
      { count: 1, last_used: '2024-01-16T08:00:00.000Z', tag: 'travel' },
    ])

    const merged = await request.post('/notes/tags/merge').send({ from: ['running'], into: 'run' })
    expect(merged.status).toBe(200)
    expect(merged.body.data).toEqual({ changed: 2 })

    const first = await request.get(`/notes/${byHashtag.body.data.id}`)
    expect(first.body.data.content).toBe('Went #run by the river')
    expect(first.body.data.tags).toEqual(['run'])
    const second = await request.get(`/notes/${byTag.body.data.id}`)
    expect(second.body.data.tags).toEqual(['run', 'travel'])

    const revisions = await request.get(`/notes/${byHashtag.body.data.id}/revisions`)
    expect(revisions.body.data.map((r: { content: string }) => r.content)).toEqual([
      'Went #Running by the river',
    ])
    expect(
      (await request.get('/notes/tags').query({ tz: 'UTC' })).body.data.map((t: { tag: string }) => t.tag),
    ).toEqual(['run', 'travel'])
  })
})

const insertActivity = async (
  user: string,
  type: string,
  start: string,
  end: string,
  title: string | null = null,
): Promise<string> => {
  const result = await query<{ id: string }>(
    user,
    `INSERT INTO activities (source, activity_type, start_time, end_time, title)
     VALUES ('aurboda', $1, $2, $3, $4) RETURNING id`,
    [type, start, end, title],
  )
  return result.rows[0]!.id
}

interface SuggestionBody {
  entity_id: string
  entity_type: string
  label: string
  reason: string
}

describe('journal link suggestions', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test("suggest the people named, the night's sleep and the day's activities, and remember a dismissal", async () => {
    const user = getTestUser()
    const sara = await insertPerson(user, { name: 'Sara' })
    await insertPerson(user, { archived: true, name: 'Anna' })
    const bo = await insertPerson(user, { name: 'Bo' })
    const sleep = await insertActivity(user, 'sleep', '2026-11-19T22:00:00Z', '2026-11-20T06:30:00Z')
    const walk = await insertActivity(
      user,
      'walking',
      '2026-11-20T15:00:00Z',
      '2026-11-20T16:00:00Z',
      'Evening walk',
    )
    await insertActivity(user, 'location_visit', '2026-11-20T10:00:00Z', '2026-11-20T11:00:00Z')
    const request = supertest(buildApp(user))

    const added = await request.post('/notes').send({
      content: 'Fika med Saras syster, Anna och Bo',
      entity_type: 'time',
      related: [{ entity_id: bo.id, entity_type: 'person' }],
      start_time: '2026-11-20T07:30:00Z',
    })
    expect(added.status).toBe(200)
    const id = added.body.data.id as string

    const first = await request.get(`/notes/${id}/link-suggestions`)
    expect(first.status).toBe(200)
    const suggestions = first.body.data as SuggestionBody[]
    expect(suggestions.map((s) => [s.entity_type, s.entity_id, s.reason])).toEqual([
      ['person', sara.id, 'name_in_text'],
      ['activity', sleep, 'night_sleep'],
      ['activity', walk, 'same_day'],
    ])
    expect(suggestions[0]!.label).toBe('Sara')
    expect(suggestions[1]!.label).toBe('Sleep, 2026-11-20')
    expect(suggestions[2]!.label).toBe('Evening walk, 2026-11-20')

    const dismissed = await request
      .post(`/notes/${id}/link-suggestions/dismissals`)
      .send({ entity_id: sara.id, entity_type: 'person' })
    expect(dismissed.status).toBe(200)
    expect(dismissed.body).toEqual({ success: true })
    const again = await request
      .post(`/notes/${id}/link-suggestions/dismissals`)
      .send({ entity_id: sara.id, entity_type: 'person' })
    expect(again.status).toBe(200)

    const after = await request.get(`/notes/${id}/link-suggestions`)
    expect((after.body.data as SuggestionBody[]).map((s) => s.entity_id)).toEqual([sleep, walk])
  })

  test('refuse what is not a live journal entry, and a malformed dismissal', async () => {
    const user = getTestUser()
    const walk = await insertActivity(user, 'walking', '2026-11-20T15:00:00Z', '2026-11-20T16:00:00Z')
    const request = supertest(buildApp(user))
    const comment = await request
      .post('/notes')
      .send({ content: 'Nice', entity_id: walk, entity_type: 'activity' })
    expect(comment.status).toBe(200)

    for (const id of [comment.body.data.id as string, '99999999-9999-4999-8999-999999999999', 'not-a-uuid']) {
      expect((await request.get(`/notes/${id}/link-suggestions`)).status).toBe(404)
      const dismiss = await request
        .post(`/notes/${id}/link-suggestions/dismissals`)
        .send({ entity_id: walk, entity_type: 'activity' })
      expect(dismiss.status).toBe(404)
    }

    const entry = await request.post('/notes').send({ content: 'x', date: '2026-11-20', entity_type: 'day' })
    const malformed = await request
      .post(`/notes/${entry.body.data.id}/link-suggestions/dismissals`)
      .send({ entity_id: 'nope', entity_type: 'activity' })
    expect(malformed.status).toBe(400)
  })

  test('page through the entries with suggestions, leaving out linked ones unless asked', async () => {
    const user = getTestUser()
    const sara = await insertPerson(user, { name: 'Sara Lind' })
    const bo = await insertPerson(user, { name: 'Bo' })
    const request = supertest(buildApp(user))
    const entry = async (
      date: string,
      content: string,
      related: { entity_id: string; entity_type: string }[] = [],
    ) =>
      (await request.post('/notes').send({ content, date, entity_type: 'day', related })).body.data
        .id as string
    const oldest = await entry('2026-11-18', 'Met Sara at the station')
    await entry('2026-11-19', 'Nothing to tell')
    const linked = await entry('2026-11-20', 'Sara again', [{ entity_id: bo.id, entity_type: 'person' }])

    const ids: string[] = []
    let cursor: string | undefined
    let pages = 0
    do {
      const res = await request
        .get('/notes/link-suggestions')
        .query({ limit: 1, ...(cursor ? { cursor } : {}) })
      expect(res.status).toBe(200)
      ids.push(...(res.body.data.entries as { id: string }[]).map((e) => e.id))
      cursor = res.body.data.next_cursor
      pages++
    } while (cursor && pages < 10)
    expect(ids).toEqual([oldest])

    const all = await request.get('/notes/link-suggestions').query({ unlinked_only: 'false' })
    expect(all.status).toBe(200)
    expect(all.body.data.next_cursor).toBeUndefined()
    const entries = all.body.data.entries as {
      id: string
      excerpt: string
      related: { entity_id: string }[]
      suggestions: SuggestionBody[]
      updated_at: string
    }[]
    expect(entries.map((e) => e.id)).toEqual([linked, oldest])
    expect(entries[0]!.related.map((r) => r.entity_id)).toEqual([bo.id])
    expect(entries[0]!.suggestions.map((s) => s.entity_id)).toEqual([sara.id])
    expect(entries[1]).toMatchObject({
      entity_type: 'day',
      date: '2026-11-18',
      excerpt: 'Met Sara at the station',
    })
    expect(typeof entries[1]!.updated_at).toBe('string')

    const ranged = await request
      .get('/notes/link-suggestions')
      .query({ from: '2026-11-19', unlinked_only: 'false' })
    expect((ranged.body.data.entries as { id: string }[]).map((e) => e.id)).toEqual([linked])

    const backwards = await request
      .get('/notes/link-suggestions')
      .query({ from: '2026-11-20', to: '2026-11-19' })
    expect(backwards.status).toBe(400)
  })
})
