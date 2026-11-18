import type { RequestHandler } from 'express'

import express from 'express'
import supertest from 'supertest'
import { describe, expect, test } from 'vitest'

import type { ReminderRecord } from '../db/index.ts'
import type { ReminderDeps } from '../services/reminders.ts'

import { createRemindersRouter } from './reminders-router.ts'

const ID = '11111111-1111-4111-8111-111111111111'
const MISSING = '99999999-9999-4999-8999-999999999999'
const NOW = new Date('2026-11-18T10:00:00Z')

const auth: RequestHandler = (req, _res, next) => {
  req.user = 'tester'
  next()
}

const record = (overrides: Partial<ReminderRecord> = {}): ReminderRecord => ({
  body: null,
  created_at: NOW,
  enabled: true,
  id: ID,
  link: '/reports',
  not_before: new Date('2026-11-01T00:00:00Z'),
  time_of_day: '20:00',
  title: 'Evening questionnaire',
  updated_at: NOW,
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  ...overrides,
})

const fakeDeps = (rows: ReminderRecord[] = [record()]) => {
  const store = new Map(rows.map((r) => [r.id, r]))
  const deps: ReminderDeps = {
    delete: async (_user, id) => store.delete(id),
    get: async (_user, id) => store.get(id) ?? null,
    getTimezone: async () => 'Europe/Stockholm',
    insert: async (_user, input) => {
      const row = record({
        ...input,
        body: input.body ?? null,
        id: '22222222-2222-4222-8222-222222222222',
        link: input.link ?? null,
      })
      store.set(row.id, row)
      return row
    },
    list: async () => [...store.values()],
    markRead: async () => 0,
    now: () => NOW,
    raise: async () => {},
    update: async (_user, id, patch) => {
      const existing = store.get(id)
      if (!existing) return null
      const next = { ...existing, ...patch } as ReminderRecord
      store.set(id, next)
      return next
    },
  }
  return { deps, store }
}

const app = (deps: ReminderDeps) => {
  const server = express()
  server.use(express.json())
  server.use('/reminders', createRemindersRouter(auth, deps))
  return supertest(server)
}

describe('GET /reminders', () => {
  test('lists reminders with next_due_at and the time zone', async () => {
    const { deps } = fakeDeps()
    const res = await app(deps).get('/reminders')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      next_due_at: '2026-11-18T19:00:00.000Z',
      reminders: [
        { id: ID, link: '/reports', next_due_at: '2026-11-18T19:00:00.000Z', time_of_day: '20:00' },
      ],
      success: true,
      timezone: 'Europe/Stockholm',
    })
  })
})

describe('POST /reminders', () => {
  test('creates with defaults for weekdays and enabled', async () => {
    const { deps } = fakeDeps([])
    const res = await app(deps).post('/reminders').send({ time_of_day: '07:30', title: '  Stretch ' })
    expect(res.status).toBe(200)
    expect(res.body.reminder).toMatchObject({
      enabled: true,
      time_of_day: '07:30',
      title: 'Stretch',
      weekdays: [1, 2, 3, 4, 5, 6, 7],
    })
  })

  test.each([
    [{ time_of_day: '07:32', title: 'Off grid' }],
    [{ time_of_day: '24:00', title: 'Bad hour' }],
    [{ time_of_day: '07:30', title: '' }],
    [{ time_of_day: '07:30', title: 'Days', weekdays: [] }],
    [{ time_of_day: '07:30', title: 'Days', weekdays: [1, 1] }],
    [{ time_of_day: '07:30', title: 'Days', weekdays: [8] }],
    [{ link: 'https://example.com', time_of_day: '07:30', title: 'Link' }],
    [{ link: '//example.com', time_of_day: '07:30', title: 'Link' }],
  ])('rejects %j', async (body) => {
    const { deps } = fakeDeps([])
    expect((await app(deps).post('/reminders').send(body)).status).toBe(400)
  })
})

describe('PATCH /reminders/:id', () => {
  test('updates the given fields', async () => {
    const { deps } = fakeDeps()
    const res = await app(deps).patch(`/reminders/${ID}`).send({ enabled: false, link: null })
    expect(res.status).toBe(200)
    expect(res.body.reminder).toMatchObject({ enabled: false, link: null, next_due_at: null })
  })

  test('needs at least one field', async () => {
    const { deps } = fakeDeps()
    expect((await app(deps).patch(`/reminders/${ID}`).send({})).status).toBe(400)
  })

  test('404 for an unknown or malformed id', async () => {
    const { deps } = fakeDeps()
    expect((await app(deps).patch(`/reminders/${MISSING}`).send({ title: 'x' })).status).toBe(404)
    expect((await app(deps).patch('/reminders/nope').send({ title: 'x' })).status).toBe(404)
  })
})

describe('DELETE /reminders/:id', () => {
  test('deletes, then 404', async () => {
    const { deps, store } = fakeDeps()
    expect((await app(deps).delete(`/reminders/${ID}`)).body).toEqual({ success: true })
    expect(store.size).toBe(0)
    expect((await app(deps).delete(`/reminders/${ID}`)).status).toBe(404)
    expect((await app(deps).delete('/reminders/nope')).status).toBe(404)
  })
})
