import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createSyncRouter, SyncRouterDeps } from './sync-router'

describe('sync router', () => {
  const mockDeps: SyncRouterDeps = {
    ackOutboundSync: vi.fn().mockResolvedValue(true),
    deleteHealthConnectRecords: vi.fn().mockResolvedValue(0),
    getActivityWatchSyncStates: vi.fn().mockResolvedValue([]),
    getCalendarSyncStates: vi.fn().mockResolvedValue([]),
    getLastFmApiKey: vi.fn().mockResolvedValue('test-lastfm-key'),
    getLastFmSyncStates: vi.fn().mockResolvedValue([]),
    getOuraSyncStates: vi.fn().mockResolvedValue([]),
    getPendingOutboundSync: vi.fn().mockResolvedValue([]),
    getRescueTimeSyncStates: vi.fn().mockResolvedValue([]),
    getSettings: vi.fn().mockResolvedValue({ rescue_time_key: 'test-key' }),
    processActivityWatchEvents: vi
      .fn()
      .mockResolvedValue({ device_name: '', records_stored: 0, status: 'success' }),
    processDailyAggregate: vi.fn().mockResolvedValue(undefined),
    processHealthConnectBatch: vi.fn().mockResolvedValue(undefined),
    processHealthConnectData: vi.fn().mockResolvedValue(undefined),
    resetCalendarSyncState: vi.fn().mockResolvedValue(undefined),
    resetLastFmSyncState: vi.fn().mockResolvedValue(undefined),
    resetOuraSyncState: vi.fn().mockResolvedValue(undefined),
    resetRescueTimeSyncState: vi.fn().mockResolvedValue(undefined),
    syncCalendars: vi.fn().mockResolvedValue([]),
    syncLastFm: vi.fn().mockResolvedValue({ scrobbles_processed: 0, status: 'success', tags_created: 0 }),
    syncOura: vi.fn().mockResolvedValue({ success: true }),
    syncRescueTime: vi.fn().mockResolvedValue({ success: true }),
    triggerCalorieComputation: vi.fn().mockResolvedValue(undefined),
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
    test('POST /sync/daily-aggregates calls processDailyAggregate, not processHealthConnectBatch', async () => {
      const app = createTestApp()
      const response = await request(app)
        .post('/sync/daily-aggregates')
        .send({
          data: [{ data_origins: ['app1'], date: '2024-01-15', metric: 'steps', value: 1000 }],
        })

      expect(response.status).toBe(200)
      expect(mockDeps.processDailyAggregate).toHaveBeenCalledTimes(1)
      expect(mockDeps.processHealthConnectBatch).not.toHaveBeenCalled()
    })

    test('POST /sync/oura calls syncOura, not processHealthConnectBatch', async () => {
      const app = createTestApp()
      const response = await request(app).post('/sync/oura').send({ full_resync: true })

      expect(response.status).toBe(200)
      expect(mockDeps.syncOura).toHaveBeenCalledWith('testuser', {
        fullResync: true,
        startDate: undefined,
      })
      expect(mockDeps.processHealthConnectBatch).not.toHaveBeenCalled()
    })

    test('POST /sync/rescuetime calls syncRescueTime, not processHealthConnectBatch', async () => {
      const app = createTestApp()
      const response = await request(app).post('/sync/rescuetime').send({})

      expect(response.status).toBe(200)
      expect(mockDeps.syncRescueTime).toHaveBeenCalled()
      expect(mockDeps.processHealthConnectBatch).not.toHaveBeenCalled()
    })

    test('POST /sync/HeartRateRecord calls processHealthConnectBatch (generic route)', async () => {
      const app = createTestApp()
      const response = await request(app)
        .post('/sync/HeartRateRecord')
        .send({ data: [{ metadata: { id: '123' }, startTime: '2024-01-15T10:00:00Z' }] })

      expect(response.status).toBe(200)
      expect(mockDeps.processHealthConnectBatch).toHaveBeenCalledWith('testuser', 'HeartRateRecord', [
        expect.any(Object),
      ])
      // Specific handlers should NOT be called
      expect(mockDeps.processDailyAggregate).not.toHaveBeenCalled()
      expect(mockDeps.syncOura).not.toHaveBeenCalled()
      expect(mockDeps.syncRescueTime).not.toHaveBeenCalled()
    })

    test('POST /sync/WeightRecord calls processHealthConnectBatch (generic route)', async () => {
      const app = createTestApp()
      const response = await request(app)
        .post('/sync/WeightRecord')
        .send({ data: [{ metadata: { id: '456' }, time: '2024-01-15T08:00:00Z' }] })

      expect(response.status).toBe(200)
      expect(mockDeps.processHealthConnectBatch).toHaveBeenCalledWith('testuser', 'WeightRecord', [
        expect.any(Object),
      ])
    })
  })

  describe('daily-aggregates endpoint', () => {
    test('processes multiple aggregates', async () => {
      const app = createTestApp()
      const aggregates = [
        { data_origins: ['app1'], date: '2024-01-15', metric: 'steps', value: 1000 },
        { data_origins: ['app1', 'app2'], date: '2024-01-15', metric: 'distance', value: 500 },
      ]
      const response = await request(app).post('/sync/daily-aggregates').send({ data: aggregates })

      expect(response.status).toBe(200)
      expect(mockDeps.processDailyAggregate).toHaveBeenCalledTimes(2)
    })

    test('returns 400 for invalid data (missing required fields)', async () => {
      const app = createTestApp()
      // Missing data_origins field
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
          error_message: null,
          last_sync_time: '2024-01-15T10:00:00Z',
          provider: 'oura',
          retry_after: null,
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
          error_message: null,
          last_sync_time: '2024-01-15T10:00:00Z',
          provider: 'rescuetime',
          retry_after: null,
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

  describe('deletions endpoint', () => {
    test('POST /sync/deletions calls deleteHealthConnectRecords', async () => {
      vi.mocked(mockDeps.deleteHealthConnectRecords).mockResolvedValueOnce(3)

      const app = createTestApp()
      const response = await request(app)
        .post('/sync/deletions')
        .send({ data: ['id1', 'id2', 'id3'] })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ message: 'Deleted 3 records', success: true })
      expect(mockDeps.deleteHealthConnectRecords).toHaveBeenCalledWith('testuser', ['id1', 'id2', 'id3'])
    })

    test('POST /sync/deletions does not call processHealthConnectData', async () => {
      const app = createTestApp()
      const response = await request(app)
        .post('/sync/deletions')
        .send({ data: ['id1'] })

      expect(response.status).toBe(200)
      expect(mockDeps.processHealthConnectBatch).not.toHaveBeenCalled()
    })

    test('POST /sync/deletions returns 400 for empty array', async () => {
      const app = createTestApp()
      const response = await request(app).post('/sync/deletions').send({ data: [] })

      expect(response.status).toBe(400)
      expect(mockDeps.deleteHealthConnectRecords).not.toHaveBeenCalled()
    })

    test('POST /sync/deletions returns 400 for missing data', async () => {
      const app = createTestApp()
      const response = await request(app).post('/sync/deletions').send({})

      expect(response.status).toBe(400)
      expect(mockDeps.deleteHealthConnectRecords).not.toHaveBeenCalled()
    })
  })

  describe('generic health connect endpoint', () => {
    test('wraps single object in array', async () => {
      const app = createTestApp()
      const singleRecord = { metadata: { id: '789' }, time: '2024-01-15T12:00:00Z' }
      const response = await request(app).post('/sync/SomeRecord').send({ data: singleRecord })

      expect(response.status).toBe(200)
      expect(mockDeps.processHealthConnectBatch).toHaveBeenCalledWith('testuser', 'SomeRecord', [
        singleRecord,
      ])
    })

    test('returns 400 for missing data field', async () => {
      const app = createTestApp()
      const response = await request(app).post('/sync/SomeRecord').send({})

      expect(response.status).toBe(400)
      expect(mockDeps.processHealthConnectBatch).not.toHaveBeenCalled()
    })
  })

  describe('activitywatch endpoint', () => {
    test('POST /sync/activitywatch passes events and device_name', async () => {
      const app = createTestApp()
      const events = [{ app: 'firefox', duration: 120, timestamp: '2024-01-15T10:00:00Z' }]
      const response = await request(app)
        .post('/sync/activitywatch')
        .send({ device_name: 'my-laptop', events })

      expect(response.status).toBe(200)
      expect(mockDeps.processActivityWatchEvents).toHaveBeenCalledWith(
        'testuser',
        events,
        'my-laptop',
        undefined,
      )
    })

    test('POST /sync/activitywatch passes is_mobile when provided', async () => {
      const app = createTestApp()
      const events = [{ app: 'com.example.app', duration: 60, timestamp: '2024-01-15T10:00:00Z' }]
      const response = await request(app)
        .post('/sync/activitywatch')
        .send({ device_name: 'pixel-8', events, is_mobile: true })

      expect(response.status).toBe(200)
      expect(mockDeps.processActivityWatchEvents).toHaveBeenCalledWith('testuser', events, 'pixel-8', true)
    })

    test('POST /sync/activitywatch defaults device_name to empty string', async () => {
      const app = createTestApp()
      const events = [{ app: 'vim', duration: 300, timestamp: '2024-01-15T10:00:00Z' }]
      const response = await request(app).post('/sync/activitywatch').send({ events })

      expect(response.status).toBe(200)
      expect(mockDeps.processActivityWatchEvents).toHaveBeenCalledWith('testuser', events, '', undefined)
    })
  })
})
