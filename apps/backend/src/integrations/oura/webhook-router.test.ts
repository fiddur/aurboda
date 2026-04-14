import express, { json } from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { createOuraWebhookRouter, type OuraWebhookRouterDeps } from './webhook-router.ts'

describe('oura-webhook-router', () => {
  const createDeps = (): OuraWebhookRouterDeps => ({
    getUsernameByOuraUserId: vi.fn().mockResolvedValue('testuser'),
    syncOuraDataTypeForUser: vi.fn().mockResolvedValue(undefined),
    verificationToken: 'test-verification-token',
  })

  const createApp = (deps: OuraWebhookRouterDeps) => {
    const app = express()
    app.use(json())
    app.use('/webhooks/oura', createOuraWebhookRouter(deps))
    return app
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  describe('GET /webhooks/oura - challenge verification', () => {
    test('returns 200 with challenge echoed back', async () => {
      const deps = createDeps()
      const app = createApp(deps)

      const response = await request(app).get('/webhooks/oura?challenge=abc123')

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ challenge: 'abc123' })
    })

    test('returns 400 when challenge query param is missing', async () => {
      const deps = createDeps()
      const app = createApp(deps)

      const response = await request(app).get('/webhooks/oura')

      expect(response.status).toBe(400)
    })
  })

  describe('POST /webhooks/oura - notification handling', () => {
    test('returns 200 and triggers sync for valid notification', async () => {
      const deps = createDeps()
      const app = createApp(deps)

      const response = await request(app).post('/webhooks/oura').send({
        data_type: 'daily_sleep',
        event_type: 'create',
        user_id: 'oura-user-123',
        verification_token: 'test-verification-token',
      })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ status: 'ok' })
      expect(deps.getUsernameByOuraUserId).toHaveBeenCalledWith('oura-user-123')

      // Sync is debounced, advance timer
      await vi.advanceTimersByTimeAsync(5000)

      expect(deps.syncOuraDataTypeForUser).toHaveBeenCalledWith('testuser', 'dailySleep')
    })

    test('returns 200 but skips sync for unknown data type', async () => {
      const deps = createDeps()
      const app = createApp(deps)

      const response = await request(app).post('/webhooks/oura').send({
        data_type: 'unknown_type',
        event_type: 'create',
        user_id: 'oura-user-123',
        verification_token: 'test-verification-token',
      })

      expect(response.status).toBe(200)
      await vi.advanceTimersByTimeAsync(5000)
      expect(deps.syncOuraDataTypeForUser).not.toHaveBeenCalled()
    })

    test('returns 200 but skips sync for unknown user', async () => {
      const deps = createDeps()
      vi.mocked(deps.getUsernameByOuraUserId).mockResolvedValue(null)
      const app = createApp(deps)

      const response = await request(app).post('/webhooks/oura').send({
        data_type: 'daily_sleep',
        event_type: 'create',
        user_id: 'unknown-user',
        verification_token: 'test-verification-token',
      })

      expect(response.status).toBe(200)
      await vi.advanceTimersByTimeAsync(5000)
      expect(deps.syncOuraDataTypeForUser).not.toHaveBeenCalled()
    })

    test('returns 403 for invalid verification token', async () => {
      const deps = createDeps()
      const app = createApp(deps)

      const response = await request(app).post('/webhooks/oura').send({
        data_type: 'daily_sleep',
        event_type: 'create',
        user_id: 'oura-user-123',
        verification_token: 'wrong-token',
      })

      expect(response.status).toBe(403)
    })

    test('debounces multiple notifications for same user+dataType', async () => {
      const deps = createDeps()
      const app = createApp(deps)

      const body = {
        data_type: 'daily_sleep',
        event_type: 'create',
        user_id: 'oura-user-123',
        verification_token: 'test-verification-token',
      }

      await request(app).post('/webhooks/oura').send(body)
      await vi.advanceTimersByTimeAsync(2000)
      await request(app).post('/webhooks/oura').send(body)
      await vi.advanceTimersByTimeAsync(2000)
      await request(app).post('/webhooks/oura').send(body)

      // Not enough time passed since last notification
      expect(deps.syncOuraDataTypeForUser).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(5000)

      // Only one sync despite 3 notifications
      expect(deps.syncOuraDataTypeForUser).toHaveBeenCalledTimes(1)
    })

    test('maps all known Oura data types correctly', async () => {
      const deps = createDeps()
      const app = createApp(deps)

      const dataTypeMappings: Array<[string, string]> = [
        ['daily_cardiovascular_age', 'dailyCardiovascularAge'],
        ['daily_readiness', 'dailyReadiness'],
        ['daily_resilience', 'dailyResilience'],
        ['daily_sleep', 'dailySleep'],
        ['session', 'sessions'],
        ['sleep', 'sleep'],
        ['enhanced_tag', 'tags'],
      ]

      for (const [ouraType, expectedType] of dataTypeMappings) {
        vi.mocked(deps.syncOuraDataTypeForUser).mockClear()

        await request(app)
          .post('/webhooks/oura')
          .send({
            data_type: ouraType,
            event_type: 'create',
            user_id: `user-${ouraType}`,
            verification_token: 'test-verification-token',
          })

        await vi.advanceTimersByTimeAsync(5000)

        expect(deps.syncOuraDataTypeForUser).toHaveBeenCalledWith('testuser', expectedType)
      }
    })
  })

  describe('cleanup', () => {
    test('clearPendingWebhookSyncs cancels pending syncs', async () => {
      const deps = createDeps()
      const router = createOuraWebhookRouter(deps)
      const app = express()
      app.use(json())
      app.use('/webhooks/oura', router)

      await request(app).post('/webhooks/oura').send({
        data_type: 'daily_sleep',
        event_type: 'create',
        user_id: 'oura-user-123',
        verification_token: 'test-verification-token',
      })

      router.clearPendingWebhookSyncs()

      await vi.advanceTimersByTimeAsync(5000)

      expect(deps.syncOuraDataTypeForUser).not.toHaveBeenCalled()
    })
  })
})
