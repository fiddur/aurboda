import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createSyncRouter, SyncRouterDeps } from './sync-router'

describe('sync router', () => {
  const mockDeps: SyncRouterDeps = {
    getCalendarSyncStates: vi.fn().mockResolvedValue([]),
    getOuraSyncStates: vi.fn().mockResolvedValue([]),
    getRescueTimeSyncStates: vi.fn().mockResolvedValue([]),
    getSettings: vi.fn().mockResolvedValue({ rescueTimeKey: 'test-key' }),
    processDailyAggregate: vi.fn().mockResolvedValue(undefined),
    processHealthConnectData: vi.fn().mockResolvedValue(undefined),
    resetCalendarSyncState: vi.fn().mockResolvedValue(undefined),
    resetOuraSyncState: vi.fn().mockResolvedValue(undefined),
    resetRescueTimeSyncState: vi.fn().mockResolvedValue(undefined),
    syncCalendars: vi.fn().mockResolvedValue([]),
    syncOura: vi.fn().mockResolvedValue({ success: true }),
    syncRescueTime: vi.fn().mockResolvedValue({ success: true }),
  }

  // Simple auth middleware that sets req.user for tests
  const testAuthMiddleware: express.RequestHandler = (req, _res, next) => {
    req.user = 'testuser'
    next()
  }

  const createTestApp = () => {
    const app = express()
    app.use(express.json())
    app.use('/sync', createSyncRouter(mockDeps, testAuthMiddleware))
    return app
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('route ordering - specific routes before generic', () => {
    test('POST /sync/daily-aggregates calls processDailyAggregate, not processHealthConnectData', async () => {
      const app = createTestApp()
      const response = await request(app)
        .post('/sync/daily-aggregates')
        .send({
          data: [{ dataOrigins: ['app1'], date: '2024-01-15', metric: 'steps', value: 1000 }],
        })

      expect(response.status).toBe(200)
      expect(mockDeps.processDailyAggregate).toHaveBeenCalledTimes(1)
      expect(mockDeps.processHealthConnectData).not.toHaveBeenCalled()
    })

    test('POST /sync/oura calls syncOura, not processHealthConnectData', async () => {
      const app = createTestApp()
      const response = await request(app).post('/sync/oura').send({ full_resync: true })

      expect(response.status).toBe(200)
      expect(mockDeps.syncOura).toHaveBeenCalledWith('testuser', {
        fullResync: true,
        startDate: undefined,
      })
      expect(mockDeps.processHealthConnectData).not.toHaveBeenCalled()
    })

    test('POST /sync/rescuetime calls syncRescueTime, not processHealthConnectData', async () => {
      const app = createTestApp()
      const response = await request(app).post('/sync/rescuetime').send({})

      expect(response.status).toBe(200)
      expect(mockDeps.syncRescueTime).toHaveBeenCalled()
      expect(mockDeps.processHealthConnectData).not.toHaveBeenCalled()
    })

    test('POST /sync/HeartRateRecord calls processHealthConnectData (generic route)', async () => {
      const app = createTestApp()
      const response = await request(app)
        .post('/sync/HeartRateRecord')
        .send({ data: [{ metadata: { id: '123' }, startTime: '2024-01-15T10:00:00Z' }] })

      expect(response.status).toBe(200)
      expect(mockDeps.processHealthConnectData).toHaveBeenCalledWith(
        'testuser',
        'HeartRateRecord',
        expect.any(Object),
      )
      // Specific handlers should NOT be called
      expect(mockDeps.processDailyAggregate).not.toHaveBeenCalled()
      expect(mockDeps.syncOura).not.toHaveBeenCalled()
      expect(mockDeps.syncRescueTime).not.toHaveBeenCalled()
    })

    test('POST /sync/WeightRecord calls processHealthConnectData (generic route)', async () => {
      const app = createTestApp()
      const response = await request(app)
        .post('/sync/WeightRecord')
        .send({ data: [{ metadata: { id: '456' }, time: '2024-01-15T08:00:00Z' }] })

      expect(response.status).toBe(200)
      expect(mockDeps.processHealthConnectData).toHaveBeenCalledWith(
        'testuser',
        'WeightRecord',
        expect.any(Object),
      )
    })
  })

  describe('daily-aggregates endpoint', () => {
    test('processes multiple aggregates', async () => {
      const app = createTestApp()
      const aggregates = [
        { dataOrigins: ['app1'], date: '2024-01-15', metric: 'steps', value: 1000 },
        { dataOrigins: ['app1', 'app2'], date: '2024-01-15', metric: 'distance', value: 500 },
      ]
      const response = await request(app).post('/sync/daily-aggregates').send({ data: aggregates })

      expect(response.status).toBe(200)
      expect(mockDeps.processDailyAggregate).toHaveBeenCalledTimes(2)
    })

    test('returns 400 for invalid data (missing required fields)', async () => {
      const app = createTestApp()
      // Missing dataOrigins field
      const response = await request(app)
        .post('/sync/daily-aggregates')
        .send({ data: [{ date: '2024-01-15', metric: 'steps', value: 1000 }] })

      expect(response.status).toBe(400)
      expect(mockDeps.processDailyAggregate).not.toHaveBeenCalled()
    })
  })

  describe('oura endpoints', () => {
    test('GET /sync/oura/status returns sync states', async () => {
      const mockStates = [
        {
          errorMessage: null,
          lastSyncTime: '2024-01-15T10:00:00Z',
          provider: 'oura',
          retryAfter: null,
          status: 'idle' as const,
        },
      ]
      vi.mocked(mockDeps.getOuraSyncStates).mockResolvedValueOnce(mockStates)

      const app = createTestApp()
      const response = await request(app).get('/sync/oura/status')

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ states: mockStates, success: true })
    })

    test('DELETE /sync/oura/state resets sync state', async () => {
      const app = createTestApp()
      const response = await request(app).delete('/sync/oura/state').query({ dataType: 'sleep' })

      expect(response.status).toBe(200)
      expect(mockDeps.resetOuraSyncState).toHaveBeenCalledWith('testuser', 'sleep')
    })
  })

  describe('rescuetime endpoints', () => {
    test('returns 400 when rescueTimeKey is not configured', async () => {
      vi.mocked(mockDeps.getSettings).mockResolvedValueOnce({})

      const app = createTestApp()
      const response = await request(app).post('/sync/rescuetime').send({})

      expect(response.status).toBe(400)
      expect(response.body.error).toContain('RescueTime API key not configured')
    })

    test('GET /sync/rescuetime/status returns sync states', async () => {
      const mockStates = [
        {
          errorMessage: null,
          lastSyncTime: '2024-01-15T10:00:00Z',
          provider: 'rescuetime',
          retryAfter: null,
          status: 'idle' as const,
        },
      ]
      vi.mocked(mockDeps.getRescueTimeSyncStates).mockResolvedValueOnce(mockStates)

      const app = createTestApp()
      const response = await request(app).get('/sync/rescuetime/status')

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ states: mockStates, success: true })
    })
  })

  describe('generic health connect endpoint', () => {
    test('wraps single object in array', async () => {
      const app = createTestApp()
      const singleRecord = { metadata: { id: '789' }, time: '2024-01-15T12:00:00Z' }
      const response = await request(app).post('/sync/SomeRecord').send({ data: singleRecord })

      expect(response.status).toBe(200)
      expect(mockDeps.processHealthConnectData).toHaveBeenCalledWith('testuser', 'SomeRecord', singleRecord)
    })

    test('returns 400 for missing data field', async () => {
      const app = createTestApp()
      const response = await request(app).post('/sync/SomeRecord').send({})

      expect(response.status).toBe(400)
      expect(mockDeps.processHealthConnectData).not.toHaveBeenCalled()
    })
  })
})
