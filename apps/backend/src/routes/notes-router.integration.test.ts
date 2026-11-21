import express from 'express'
import supertest from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

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
