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
  forgetGrant: vi.fn(async () => {}),
  getClientId: vi.fn(async () => CLIENT_ID),
  getDisabledDataTypes: vi.fn(async () => []),
  getUsernameByGarminUserId: vi.fn(async () => 'alice'),
  insertRawRecords: vi.fn(async () => {}),
  insertTimeSeries: vi.fn(async () => {}),
  isReadOnly: vi.fn(async () => false),
  logWarn: vi.fn(),
  now: () => new Date('2026-11-17T10:00:00Z'),
  onActivitySynced: vi.fn(),
  probeGrant: vi.fn(async () => ({ status: 'gone' as const })),
  processGarminData: vi.fn(async () => 1),
  pushToken: TOKEN,
  syncActivityFile: vi.fn(async () => {}),
  updateGrantScopes: vi.fn(async () => true),
  upsertSyncState: vi.fn(async () => {}),
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
  test('answers 200 with an empty body, stores, then queues the processing', async () => {
    const deps = makeDeps()
    const { app, jobs } = makeApp(deps)
    const res = await request(app).post(`/webhooks/garmin/${TOKEN}`).send(body)
    expect(res.status).toBe(200)
    expect(res.text).toBe('')
    expect(deps.insertRawRecords).toHaveBeenCalledWith('alice', [
      expect.objectContaining({ external_id: 'sd-1' }),
    ])
    expect(deps.processGarminData).not.toHaveBeenCalled()
    expect(jobs).toHaveLength(1)
    await jobs[0]!()
    expect(deps.processGarminData).toHaveBeenCalled()
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
  const makeParserApp = () => {
    const reached = vi.fn()
    const app = express()
    app.use('/webhooks/garmin', garminPushBodyParser(TOKEN))
    app.use(express.json({ limit: '1kb' }))
    app.post('/webhooks/garmin/:token', (req, res) => {
      reached(req.body)
      res.status(200).end()
    })
    return { app, reached }
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
})
