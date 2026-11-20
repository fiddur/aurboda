import { describe, expect, test, vi } from 'vitest'

vi.mock('../../services/audit-log', () => ({
  auditError: vi.fn(),
  auditInfo: vi.fn(),
  auditWarn: vi.fn(),
}))

import express from 'express'
import request from 'supertest'

import {
  createStravaWebhookRouter,
  type StravaWebhookRouterDeps,
  stravaWebhookBodyParser,
} from './webhook-router.ts'

const createDeps = (overrides?: Partial<StravaWebhookRouterDeps>): StravaWebhookRouterDeps => ({
  enqueueActivityFetch: vi.fn(),
  getUsernameByStravaAthleteId: vi.fn().mockResolvedValue('testuser'),
  handleDeauthorization: vi.fn(),
  softDeleteStravaActivity: vi.fn(),
  verifyToken: 'test-verify-token',
  ...overrides,
})

const createApp = (deps: StravaWebhookRouterDeps) => {
  const app = express()
  app.use('/webhooks/strava', stravaWebhookBodyParser())
  app.use(express.json())
  app.use('/webhooks/strava', createStravaWebhookRouter(deps))
  return app
}

describe('Strava webhook router', () => {
  describe('GET / (subscription validation)', () => {
    test('responds with hub.challenge on valid verification', async () => {
      const deps = createDeps()
      const app = createApp(deps)

      const res = await request(app).get('/webhooks/strava').query({
        'hub.challenge': '15f7d1a91c1f40f8a748fd134752feb3',
        'hub.mode': 'subscribe',
        'hub.verify_token': 'test-verify-token',
      })

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ 'hub.challenge': '15f7d1a91c1f40f8a748fd134752feb3' })
    })

    test('responds 403 on invalid verify token', async () => {
      const deps = createDeps()
      const app = createApp(deps)

      const res = await request(app).get('/webhooks/strava').query({
        'hub.challenge': 'abc',
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong-token',
      })

      expect(res.status).toBe(403)
    })
  })

  describe('POST / (event handler)', () => {
    test('responds 200 immediately and enqueues activity fetch on create', async () => {
      const deps = createDeps()
      const app = createApp(deps)

      const res = await request(app).post('/webhooks/strava').send({
        aspect_type: 'create',
        event_time: 1516126040,
        object_id: 12345678,
        object_type: 'activity',
        owner_id: 87654321,
        subscription_id: 1,
      })

      expect(res.status).toBe(200)

      // Wait for async handler
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(deps.getUsernameByStravaAthleteId).toHaveBeenCalledWith('87654321')
      expect(deps.enqueueActivityFetch).toHaveBeenCalledWith('testuser', '12345678', 1)
    })

    test('enqueues activity fetch on update', async () => {
      const deps = createDeps()
      const app = createApp(deps)

      await request(app)
        .post('/webhooks/strava')
        .send({
          aspect_type: 'update',
          event_time: 1516126040,
          object_id: 12345678,
          object_type: 'activity',
          owner_id: 87654321,
          subscription_id: 1,
          updates: { title: 'New Title' },
        })

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(deps.enqueueActivityFetch).toHaveBeenCalledWith('testuser', '12345678', 1)
    })

    test('soft-deletes activity on delete event', async () => {
      const deps = createDeps()
      const app = createApp(deps)

      await request(app).post('/webhooks/strava').send({
        aspect_type: 'delete',
        event_time: 1516126040,
        object_id: 12345678,
        object_type: 'activity',
        owner_id: 87654321,
        subscription_id: 1,
      })

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(deps.softDeleteStravaActivity).toHaveBeenCalledWith('testuser', '12345678')
    })

    test('handles athlete deauthorization', async () => {
      const deps = createDeps()
      const app = createApp(deps)

      await request(app).post('/webhooks/strava').send({
        aspect_type: 'delete',
        event_time: 1516126040,
        object_id: 87654321,
        object_type: 'athlete',
        owner_id: 87654321,
        subscription_id: 1,
      })

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(deps.handleDeauthorization).toHaveBeenCalledWith('87654321')
    })

    test('ignores events for unknown athletes', async () => {
      const deps = createDeps({
        getUsernameByStravaAthleteId: vi.fn().mockResolvedValue(null),
      })
      const app = createApp(deps)

      await request(app).post('/webhooks/strava').send({
        aspect_type: 'create',
        event_time: 1516126040,
        object_id: 12345678,
        object_type: 'activity',
        owner_id: 99999,
        subscription_id: 1,
      })

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(deps.enqueueActivityFetch).not.toHaveBeenCalled()
    })

    const postRaw = (app: express.Express, body: string) =>
      request(app).post('/webhooks/strava').set('Content-Type', 'application/json').send(body)

    const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

    test('passes 64-bit ids exactly on create', async () => {
      const deps = createDeps()
      const app = createApp(deps)

      const res = await postRaw(
        app,
        '{"aspect_type":"create","event_time":1516126040,"object_id":9007199254740993,"object_type":"activity","owner_id":9223372036854775807,"subscription_id":1}',
      )
      expect(res.status).toBe(200)
      expect(res.text).toBe('EVENT_RECEIVED')
      await settle()

      expect(deps.getUsernameByStravaAthleteId).toHaveBeenCalledWith('9223372036854775807')
      expect(deps.enqueueActivityFetch).toHaveBeenCalledWith('testuser', '9007199254740993', 1)
    })

    test('passes 64-bit ids exactly on delete', async () => {
      const deps = createDeps()
      const app = createApp(deps)

      await postRaw(
        app,
        '{"aspect_type":"delete","event_time":1516126040,"object_id":9007199254740993,"object_type":"activity","owner_id":9223372036854775807,"subscription_id":1}',
      )
      await settle()

      expect(deps.getUsernameByStravaAthleteId).toHaveBeenCalledWith('9223372036854775807')
      expect(deps.softDeleteStravaActivity).toHaveBeenCalledWith('testuser', '9007199254740993')
    })

    test('passes a 64-bit athlete id exactly on deauthorization', async () => {
      const deps = createDeps()
      const app = createApp(deps)

      await postRaw(
        app,
        '{"aspect_type":"delete","event_time":1516126040,"object_id":9223372036854775807,"object_type":"athlete","owner_id":9223372036854775807,"subscription_id":1}',
      )
      await settle()

      expect(deps.handleDeauthorization).toHaveBeenCalledWith('9223372036854775807')
    })

    test.each([
      [
        'a non-numeric owner_id',
        '{"aspect_type":"create","object_id":1,"object_type":"activity","owner_id":"abc"}',
      ],
      [
        'a fractional owner_id',
        '{"aspect_type":"create","object_id":1,"object_type":"activity","owner_id":1.5}',
      ],
      [
        'an object as object_id',
        '{"aspect_type":"create","object_id":{},"object_type":"activity","owner_id":2}',
      ],
      [
        'an owner_id above int64',
        '{"aspect_type":"create","object_id":1,"object_type":"activity","owner_id":9223372036854775808}',
      ],
      [
        'an athlete owner_id above int64',
        '{"aspect_type":"delete","object_id":1,"object_type":"athlete","owner_id":9223372036854775808}',
      ],
      [
        'a non-numeric athlete owner_id',
        '{"aspect_type":"delete","object_id":1,"object_type":"athlete","owner_id":"abc"}',
      ],
    ])('ignores an event with %s', async (_, body) => {
      const deps = createDeps()
      const app = createApp(deps)

      const res = await postRaw(app, body)
      expect(res.status).toBe(200)
      await settle()

      expect(deps.getUsernameByStravaAthleteId).not.toHaveBeenCalled()
      expect(deps.enqueueActivityFetch).not.toHaveBeenCalled()
      expect(deps.softDeleteStravaActivity).not.toHaveBeenCalled()
      expect(deps.handleDeauthorization).not.toHaveBeenCalled()
    })
  })
})
