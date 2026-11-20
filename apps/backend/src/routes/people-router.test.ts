import type { RequestHandler } from 'express'

import express from 'express'
import supertest from 'supertest'
import { describe, expect, test } from 'vitest'

import type { PeopleDeps } from '../services/people.ts'

import { fakePeopleDeps } from '../test/fake-people-deps.ts'
import { createPeopleRouter } from './people-router.ts'

const auth: RequestHandler = (req, _res, next) => {
  req.user = 'tester'
  next()
}

const app = (deps: PeopleDeps) => {
  const server = express()
  server.use(express.json())
  server.use('/people', createPeopleRouter(auth, deps))
  return supertest(server)
}

const ACTOR = {
  actor_uri: 'https://example.social/users/anna',
  handle: '@anna@example.social',
  icon: null,
  name: 'Anna',
}

const setup = () => {
  const fake = fakePeopleDeps()
  fake.actors.set('@anna@example.social', ACTOR)
  return { ...fake, http: app(fake.deps) }
}

describe('/people', () => {
  test('POST creates a person and GET lists them with the relationship suggestions', async () => {
    const { http } = setup()
    const created = await http
      .post('/people')
      .send({ birth_date: '--04-12', name: 'Anna', relationship: 'friend' })
    expect(created.status).toBe(200)
    expect(created.body.person).toMatchObject({ birth_date: '--04-12', name: 'Anna', relationship: 'friend' })

    const listed = await http.get('/people')
    expect(listed.body.people).toHaveLength(1)
    expect(listed.body.relationship_suggestions).toContain('partner')
  })

  test('invalid bodies are 400s', async () => {
    const { http } = setup()
    expect((await http.post('/people').send({ name: '' })).status).toBe(400)
    expect((await http.post('/people').send({ birth_date: '2027-02-29', name: 'X' })).status).toBe(400)
    expect((await http.post('/people').send({ handle: 'not a handle', name: 'X' })).status).toBe(400)
  })

  test('a handle that does not resolve is a 400, a duplicate actor a 409', async () => {
    const { http } = setup()
    const unresolved = await http.post('/people').send({ handle: '@x@nowhere', name: 'X' })
    expect(unresolved.status).toBe(400)
    expect(unresolved.body.error).toBe('Could not resolve an actor for “@x@nowhere”.')
    expect((await http.post('/people').send({ handle: '@anna@example.social', name: 'Anna' })).status).toBe(
      200,
    )
    const duplicate = await http.post('/people').send({ handle: 'anna@example.social', name: 'Annie' })
    expect(duplicate.status).toBe(409)
  })

  test('GET /:id gives the dates and recent activities; PATCH changes; unknown ids are 404s', async () => {
    const { http } = setup()
    const { id } = (await http.post('/people').send({ name: 'Anna' })).body.person
    await http.post(`/people/${id}/dates`).send({ day: 1, kind: 'anniversary', label: 'Wedding', month: 6 })
    const detail = await http.get(`/people/${id}`)
    expect(detail.body.person).toMatchObject({ dates: [{ label: 'Wedding' }], recent_activities: [] })

    const patched = await http.patch(`/people/${id}`).send({ pronouns: 'she/her' })
    expect(patched.body.person.pronouns).toBe('she/her')
    expect((await http.patch(`/people/${id}`).send({})).status).toBe(400)
    expect((await http.get('/people/99999999-9999-4999-8999-999999999999')).status).toBe(404)
  })

  test('DELETE soft-deletes, ?deleted=true lists, restore brings back, ?purge=true removes for good', async () => {
    const { http, people } = setup()
    const { id } = (await http.post('/people').send({ name: 'Anna' })).body.person
    expect((await http.delete(`/people/${id}`)).status).toBe(200)
    expect((await http.get(`/people/${id}`)).status).toBe(404)
    expect((await http.get('/people?deleted=true')).body.people[0]).toMatchObject({
      id,
      purge_at: expect.any(String),
    })
    expect((await http.post(`/people/${id}/restore`)).body.person.id).toBe(id)
    expect((await http.delete(`/people/${id}?purge=true`)).status).toBe(200)
    expect(people.size).toBe(0)
    expect((await http.delete(`/people/${id}`)).status).toBe(404)
  })

  test('dates: list, change, delete', async () => {
    const { http } = setup()
    const { id } = (await http.post('/people').send({ name: 'Anna' })).body.person
    const date = await http.post(`/people/${id}/dates`).send({ day: 31, label: 'X', month: 4 })
    expect(date.status).toBe(400)
    const { date: created } = (await http.post(`/people/${id}/dates`).send({ day: 30, label: 'X', month: 4 }))
      .body
    expect((await http.get(`/people/${id}/dates`)).body.dates).toHaveLength(1)
    const changed = await http.patch(`/people/${id}/dates/${created.id}`).send({ notify_days_before: 2 })
    expect(changed.body.date.notify_days_before).toBe(2)
    expect((await http.delete(`/people/${id}/dates/${created.id}`)).status).toBe(200)
    expect((await http.delete(`/people/${id}/dates/${created.id}`)).status).toBe(404)
  })

  test('GET /dates lists occurrences in a window and refuses a too-long one', async () => {
    const { http } = setup()
    await http.post('/people').send({ birth_date: '1990-12-24', name: 'Anna' })
    const res = await http.get('/people/dates?from=2026-12-01&to=2026-12-31')
    expect(res.status).toBe(200)
    expect(res.body.dates).toEqual([
      {
        date: '2026-12-24',
        date_id: null,
        kind: 'birthday',
        label: "Anna's birthday",
        person: { id: expect.any(String), name: 'Anna' },
        years: 36,
      },
    ])
    expect((await http.get('/people/dates?from=2026-01-01&to=2027-06-01')).status).toBe(400)
    expect((await http.get('/people/dates?from=nope')).status).toBe(400)
  })

  test('GET /:id/posts lists the posts of a person with a handle, 404 without one', async () => {
    const { http, posts } = setup()
    const withHandle = (await http.post('/people').send({ handle: '@anna@example.social', name: 'Anna' }))
      .body.person
    const without = (await http.post('/people').send({ name: 'Bo' })).body.person
    posts.set(ACTOR.actor_uri, [{ id: 'p1' } as never])
    expect((await http.get(`/people/${withHandle.id}/posts?limit=5`)).body.entries).toEqual([{ id: 'p1' }])
    expect((await http.get(`/people/${without.id}/posts`)).status).toBe(404)
    expect((await http.get(`/people/${withHandle.id}/posts?limit=51`)).status).toBe(400)
  })
})
