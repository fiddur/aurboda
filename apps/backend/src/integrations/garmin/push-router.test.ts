import express from 'express'
import request from 'supertest'
import { describe, expect, test, vi } from 'vitest'

import { createGarminPushRouter, garminPushBodyParser } from './push-router.ts'
import { garminPushToken, type GarminPushDeps, receiveGarminPush } from './push.ts'

const TOKEN = garminPushToken('fake-session-secret')
const CLIENT_ID = 'fake-client-id'

const makeDeps = (overrides: Partial<GarminPushDeps> = {}): GarminPushDeps => ({
  auditError: vi.fn(async () => {}),
  auditInfo: vi.fn(async () => {}),
  auditWarn: vi.fn(async () => {}),
  enqueuePush: vi.fn(async () => {}),
  forgetGrant: vi.fn(async () => {}),
  getClientId: vi.fn(async () => CLIENT_ID),
  getDisabledDataTypes: vi.fn(async () => []),
  getUsernameByGarminUserId: vi.fn(async () => 'alice'),
  insertRawRecords: vi.fn(async () => {}),
  isReadOnly: vi.fn(async () => false),
  logWarn: vi.fn(),
  now: () => new Date('2026-11-17T10:00:00Z'),
  probeGrant: vi.fn(async () => ({ status: 'gone' as const })),
  pushToken: TOKEN,
  updateGrantScopes: vi.fn(async () => true),
  ...overrides,
})

const makeApp = (deps: GarminPushDeps) => {
  const jobs: (() => Promise<void>)[] = []
  const logError = vi.fn()
  const app = express()
  app.use(express.json())
  app.use(
    '/webhooks/garmin',
    createGarminPushRouter({
      enqueue: (job) => jobs.push(job),
      logError,
      receive: (req) => receiveGarminPush(deps, req),
    }),
  )
  return { app, jobs, logError }
}

const body = {
  dailies: [{ calendarDate: '2026-11-16', steps: 10, summaryId: 'sd-1', userId: 'garmin-user-1' }],
}

describe('Garmin push router', () => {
  test('answers 200 with an empty body once the records are stored and their processing is queued', async () => {
    const deps = makeDeps()
    const { app, jobs } = makeApp(deps)
    const res = await request(app).post(`/webhooks/garmin/${TOKEN}`).send(body)
    expect(res.status).toBe(200)
    expect(res.text).toBe('')
    expect(deps.insertRawRecords).toHaveBeenCalledWith('alice', [
      expect.objectContaining({ external_id: 'sd-1' }),
    ])
    expect(deps.enqueuePush).toHaveBeenCalledWith({
      records: [{ external_id: 'sd-1', type: 'dailies' }],
      user: 'alice',
    })
    expect(jobs).toHaveLength(0)
  })

  test('a connection notice is handled in this process after the answer', async () => {
    const deps = makeDeps()
    const { app, jobs } = makeApp(deps)
    const res = await request(app)
      .post(`/webhooks/garmin/${TOKEN}`)
      .send({ deregistrations: [{ userId: 'garmin-user-1' }] })
    expect(res.status).toBe(200)
    expect(deps.probeGrant).not.toHaveBeenCalled()
    expect(jobs).toHaveLength(1)
    await jobs[0]!()
    expect(deps.probeGrant).toHaveBeenCalledWith('alice')
  })

  test('a failure to queue the processing is a 500', async () => {
    const deps = makeDeps({ enqueuePush: vi.fn().mockRejectedValue(new Error('queue down')) })
    const res = await request(makeApp(deps).app).post(`/webhooks/garmin/${TOKEN}`).send(body)
    expect(res.status).toBe(500)
  })

  test('a wrong token is a 404 with an empty body', async () => {
    const deps = makeDeps()
    const res = await request(makeApp(deps).app).post('/webhooks/garmin/not-the-token').send(body)
    expect(res.status).toBe(404)
    expect(res.text).toBe('')
    expect(deps.insertRawRecords).not.toHaveBeenCalled()
  })

  test('without a configured client id it is a 404', async () => {
    const deps = makeDeps({ getClientId: vi.fn(async () => null) })
    const res = await request(makeApp(deps).app).post(`/webhooks/garmin/${TOKEN}`).send(body)
    expect(res.status).toBe(404)
  })

  test('a mismatching garmin-client-id header is a 403; the matching one passes', async () => {
    const deps = makeDeps()
    const { app } = makeApp(deps)
    const refused = await request(app)
      .post(`/webhooks/garmin/${TOKEN}`)
      .set('garmin-client-id', 'another-client')
      .send(body)
    expect(refused.status).toBe(403)
    const accepted = await request(app)
      .post(`/webhooks/garmin/${TOKEN}`)
      .set('garmin-client-id', CLIENT_ID)
      .send(body)
    expect(accepted.status).toBe(200)
  })

  test('a failure to store raw records is a 500 and queues nothing', async () => {
    const deps = makeDeps({ insertRawRecords: vi.fn().mockRejectedValue(new Error('db down')) })
    const { app, jobs } = makeApp(deps)
    const res = await request(app).post(`/webhooks/garmin/${TOKEN}`).send(body)
    expect(res.status).toBe(500)
    expect(jobs).toHaveLength(0)
  })

  test('an unexpected failure is a 500 and the log line holds no token', async () => {
    const deps = makeDeps({ getClientId: vi.fn().mockRejectedValue(new Error('central db down')) })
    const { app, logError } = makeApp(deps)
    const res = await request(app).post(`/webhooks/garmin/${TOKEN}`).send(body)
    expect(res.status).toBe(500)
    expect(JSON.stringify(logError.mock.calls)).not.toContain(TOKEN)
  })

  test('a payload with nothing it understands is still a 200', async () => {
    const deps = makeDeps({ getUsernameByGarminUserId: vi.fn(async () => null) })
    const res = await request(makeApp(deps).app).post(`/webhooks/garmin/${TOKEN}`).send({ whatever: 1 })
    expect(res.status).toBe(200)
  })
})

describe('Garmin push body parser', () => {
  const makeParserApp = (limit?: string) => {
    const reached = vi.fn()
    const logWarn = vi.fn()
    const app = express()
    app.use('/webhooks/garmin', garminPushBodyParser(TOKEN, { limit, logWarn }))
    app.use(express.json({ limit: '1kb' }))
    app.post('/webhooks/garmin/:token', (req, res) => {
      reached(req.body)
      res.status(200).end()
    })
    return { app, logWarn, reached }
  }
  const large = { dailies: [{ note: 'x'.repeat(5000), summaryId: 'sd-1', userId: 'garmin-user-1' }] }

  test('parses a body over the general limit for the right token', async () => {
    const { app, reached } = makeParserApp()
    const res = await request(app).post(`/webhooks/garmin/${TOKEN}`).send(large)
    expect(res.status).toBe(200)
    expect(reached).toHaveBeenCalledWith(large)
  })

  test('answers 404 for a wrong token without reading the body', async () => {
    const { app, reached } = makeParserApp()
    const res = await request(app)
      .post('/webhooks/garmin/not-the-token')
      .set('content-type', 'application/json')
      .send('{ not json')
    expect(res.status).toBe(404)
    expect(res.text).toBe('')
    expect(reached).not.toHaveBeenCalled()
  })

  test('answers 404 for a longer path under the right token', async () => {
    const { app, reached } = makeParserApp()
    const res = await request(app).post(`/webhooks/garmin/${TOKEN}/more`).send(large)
    expect(res.status).toBe(404)
    expect(reached).not.toHaveBeenCalled()
  })

  test.each([
    ['a body that is not JSON', '{ not json'],
    ['a bare JSON string', '"just a string"'],
  ])('answers 200 with an empty body to %s, logging a count without the path or the body', async (_, raw) => {
    const { app, logWarn, reached } = makeParserApp()
    const res = await request(app)
      .post(`/webhooks/garmin/${TOKEN}`)
      .set('content-type', 'application/json')
      .send(raw)
    expect(res.status).toBe(200)
    expect(res.text).toBe('')
    expect(reached).not.toHaveBeenCalled()
    expect(logWarn).toHaveBeenCalledWith('Garmin push: 1 unreadable body dropped')
    expect(JSON.stringify(logWarn.mock.calls)).not.toContain(TOKEN)
    expect(JSON.stringify(logWarn.mock.calls)).not.toContain('not json')
  })

  test('still answers 413 to a body over the limit', async () => {
    const { app, reached } = makeParserApp('1kb')
    const res = await request(app).post(`/webhooks/garmin/${TOKEN}`).send(large)
    expect(res.status).toBe(413)
    expect(res.text).toBe('')
    expect(reached).not.toHaveBeenCalled()
  })

  test('a wrong token is still a 404 before an unreadable body is read', async () => {
    const { app, logWarn } = makeParserApp()
    const res = await request(app)
      .post('/webhooks/garmin/not-the-token')
      .set('content-type', 'application/json')
      .send('"just a string"')
    expect(res.status).toBe(404)
    expect(logWarn).not.toHaveBeenCalled()
  })
})
