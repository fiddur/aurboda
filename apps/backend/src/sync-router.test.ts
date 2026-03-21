import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { createSyncRouter, type SyncRouterDeps } from './sync-router.ts'

describe('sync router', () => {
  const mockDeps: SyncRouterDeps = {
    ackOutboundSync: vi.fn().mockResolvedValue(true),
    deleteHealthConnectRecords: vi.fn().mockResolvedValue(0),
    getActivityWatchSyncStates: vi.fn().mockResolvedValue([]),
    getCalendarSyncStates: vi.fn().mockResolvedValue([]),
    getGarminSyncStates: vi.fn().mockResolvedValue([]),
    getOutboundSyncHistory: vi.fn().mockResolvedValue([]),
    getLastFmApiKey: vi.fn().mockResolvedValue('test-lastfm-key'),
    getLastFmSyncStates: vi.fn().mockResolvedValue([]),
    getOuraSyncStates: vi.fn().mockResolvedValue([]),
    getPendingOutboundSync: vi.fn().mockResolvedValue({ entries: [], total_pending: 0 }),
    getRescueTimeSyncStates: vi.fn().mockResolvedValue([]),
    getSettings: vi.fn().mockResolvedValue({ rescue_time_key: 'test-key' }),
    processActivityWatchEvents: vi
      .fn()
      .mockResolvedValue({ device_name: '', records_stored: 0, status: 'success' }),
    processDailyAggregate: vi.fn().mockResolvedValue(undefined),
    processHealthConnectBatch: vi.fn().mockResolvedValue(undefined),
    processHealthConnectData: vi.fn().mockResolvedValue(undefined),
    reportSyncFailure: vi.fn().mockResolvedValue({ fail_count: 1, retrying: true }),
    requeueOutboundSync: vi.fn().mockResolvedValue(true),
    resetCalendarSyncState: vi.fn().mockResolvedValue(undefined),
    resetGarminSyncState: vi.fn().mockResolvedValue(undefined),
    resetLastFmSyncState: vi.fn().mockResolvedValue(undefined),
    resetOuraSyncState: vi.fn().mockResolvedValue(undefined),
    resetRescueTimeSyncState: vi.fn().mockResolvedValue(undefined),
    syncCalendars: vi.fn().mockResolvedValue([]),
    syncGarmin: vi.fn().mockResolvedValue([]),
    syncLastFm: vi.fn().mockResolvedValue({ scrobbles_processed: 0, status: 'success', tags_created: 0 }),
    syncOura: vi.fn().mockResolvedValue({ success: true }),
    syncRescueTime: vi.fn().mockResolvedValue({ success: true }),
    triggerCalorieComputation: vi.fn().mockResolvedValue(undefined),
    upsertUserSettings: vi.fn().mockResolvedValue(undefined),
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

  describe('garmin endpoints', () => {
    test('POST /sync/garmin calls syncGarmin', async () => {
      const app = createTestApp()
      const response = await request(app).post('/sync/garmin').send({})

      expect(response.status).toBe(200)
      expect(mockDeps.syncGarmin).toHaveBeenCalledWith('testuser', {
        fullResync: undefined,
        startDate: undefined,
      })
    })

    test('POST /sync/garmin passes full_resync and start_date', async () => {
      const app = createTestApp()
      const response = await request(app)
        .post('/sync/garmin')
        .send({ full_resync: true, start_date: '2024-01-01' })

      expect(response.status).toBe(200)
      expect(mockDeps.syncGarmin).toHaveBeenCalledWith('testuser', {
        fullResync: true,
        startDate: new Date('2024-01-01'),
      })
    })

    test('GET /sync/garmin/status returns sync states', async () => {
      const mockStates = [
        {
          error_message: null,
          last_sync_time: '2024-01-15T10:00:00Z',
          provider: 'garmin',
          retry_after: null,
          status: 'idle' as const,
        },
      ]
      vi.mocked(mockDeps.getGarminSyncStates).mockResolvedValueOnce(mockStates)

      const app = createTestApp()
      const response = await request(app).get('/sync/garmin/status')

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ states: mockStates, success: true })
    })

    test('DELETE /sync/garmin/state resets sync state', async () => {
      const app = createTestApp()
      const response = await request(app).delete('/sync/garmin/state').query({ dataType: 'dailySummary' })

      expect(response.status).toBe(200)
      expect(mockDeps.resetGarminSyncState).toHaveBeenCalledWith('testuser', 'dailySummary')
    })
  })

  describe('calendar endpoints', () => {
    test('POST /sync/calendars returns 400 when no calendars configured', async () => {
      vi.mocked(mockDeps.getSettings).mockResolvedValueOnce({})

      const app = createTestApp()
      const response = await request(app).post('/sync/calendars').send({})

      expect(response.status).toBe(400)
      expect(response.body.error).toContain('No calendars configured')
    })

    test('POST /sync/calendars calls syncCalendars', async () => {
      vi.mocked(mockDeps.getSettings).mockResolvedValueOnce({
        calendars: [{ name: 'Work', url: 'https://example.com/cal.ics' }],
      })

      const app = createTestApp()
      const response = await request(app).post('/sync/calendars').send({ full_resync: true })

      expect(response.status).toBe(200)
      expect(mockDeps.syncCalendars).toHaveBeenCalledWith(
        'testuser',
        [{ name: 'Work', url: 'https://example.com/cal.ics' }],
        { fullResync: true },
      )
    })

    test('GET /sync/calendars/status returns sync states', async () => {
      vi.mocked(mockDeps.getCalendarSyncStates).mockResolvedValueOnce([])

      const app = createTestApp()
      const response = await request(app).get('/sync/calendars/status')

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ states: [], success: true })
    })

    test('DELETE /sync/calendars/state resets sync state', async () => {
      const app = createTestApp()
      const response = await request(app).delete('/sync/calendars/state')

      expect(response.status).toBe(200)
      expect(mockDeps.resetCalendarSyncState).toHaveBeenCalledWith('testuser')
    })
  })

  describe('lastfm endpoints', () => {
    test('POST /sync/lastfm returns 400 when API key not configured', async () => {
      vi.mocked(mockDeps.getLastFmApiKey).mockResolvedValueOnce(null)

      const app = createTestApp()
      const response = await request(app).post('/sync/lastfm').send({})

      expect(response.status).toBe(400)
      expect(response.body.error).toContain('Last.fm API key not configured')
    })

    test('POST /sync/lastfm returns 400 when username not configured', async () => {
      vi.mocked(mockDeps.getSettings).mockResolvedValueOnce({})

      const app = createTestApp()
      const response = await request(app).post('/sync/lastfm').send({})

      expect(response.status).toBe(400)
      expect(response.body.error).toContain('Last.fm username not configured')
    })

    test('POST /sync/lastfm calls syncLastFm', async () => {
      vi.mocked(mockDeps.getSettings).mockResolvedValueOnce({ lastfm_username: 'testfm' })

      const app = createTestApp()
      const response = await request(app).post('/sync/lastfm').send({ full_resync: true })

      expect(response.status).toBe(200)
      expect(mockDeps.syncLastFm).toHaveBeenCalledWith('testuser', 'test-lastfm-key', 'testfm', {
        fullResync: true,
        startDate: undefined,
      })
    })

    test('GET /sync/lastfm/status returns sync states', async () => {
      vi.mocked(mockDeps.getLastFmSyncStates).mockResolvedValueOnce([])

      const app = createTestApp()
      const response = await request(app).get('/sync/lastfm/status')

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ states: [], success: true })
    })

    test('DELETE /sync/lastfm/state resets sync state', async () => {
      const app = createTestApp()
      const response = await request(app).delete('/sync/lastfm/state')

      expect(response.status).toBe(200)
      expect(mockDeps.resetLastFmSyncState).toHaveBeenCalledWith('testuser')
    })
  })

  describe('outbound sync endpoints', () => {
    test('GET /sync/outbound returns pending entries', async () => {
      const now = new Date('2024-01-15T10:00:00Z')
      vi.mocked(mockDeps.getPendingOutboundSync).mockResolvedValueOnce({
        entries: [
          {
            created_at: now,
            entity_id: 'ent-1',
            entity_type: 'time_series',
            id: '550e8400-e29b-41d4-a716-446655440000',
            payload: { metric: 'steps', value: 1000 },
            status: 'pending',
          },
        ],
        total_pending: 1,
      })

      const app = createTestApp()
      const response = await request(app).get('/sync/outbound')

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.total_pending).toBe(1)
      expect(response.body.data).toHaveLength(1)
      expect(response.body.data[0].created_at).toBe('2024-01-15T10:00:00.000Z')
    })

    test('POST /sync/outbound/ack acknowledges entries', async () => {
      const app = createTestApp()
      const response = await request(app)
        .post('/sync/outbound/ack')
        .send({
          entries: [{ id: '550e8400-e29b-41d4-a716-446655440000', hc_record_id: 'hc-123' }],
        })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ acknowledged: 1, success: true })
      expect(mockDeps.ackOutboundSync).toHaveBeenCalledWith(
        'testuser',
        '550e8400-e29b-41d4-a716-446655440000',
        'hc-123',
      )
    })

    test('POST /sync/outbound/ack returns 400 for empty entries', async () => {
      const app = createTestApp()
      const response = await request(app).post('/sync/outbound/ack').send({ entries: [] })

      expect(response.status).toBe(400)
      expect(mockDeps.ackOutboundSync).not.toHaveBeenCalled()
    })

    test('POST /sync/outbound/ack returns 400 for invalid id', async () => {
      const app = createTestApp()
      const response = await request(app)
        .post('/sync/outbound/ack')
        .send({ entries: [{ id: 'not-a-uuid' }] })

      expect(response.status).toBe(400)
      expect(mockDeps.ackOutboundSync).not.toHaveBeenCalled()
    })

    test('POST /sync/outbound/fail reports failures', async () => {
      const app = createTestApp()
      const response = await request(app)
        .post('/sync/outbound/fail')
        .send({
          entries: [{ id: '550e8400-e29b-41d4-a716-446655440000', reason: 'HC write failed' }],
        })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ reported: 1, success: true })
      expect(mockDeps.reportSyncFailure).toHaveBeenCalledWith(
        'testuser',
        '550e8400-e29b-41d4-a716-446655440000',
        'HC write failed',
      )
    })

    test('POST /sync/outbound/fail returns 400 for missing reason', async () => {
      const app = createTestApp()
      const response = await request(app)
        .post('/sync/outbound/fail')
        .send({
          entries: [{ id: '550e8400-e29b-41d4-a716-446655440000' }],
        })

      expect(response.status).toBe(400)
      expect(mockDeps.reportSyncFailure).not.toHaveBeenCalled()
    })

    test('POST /sync/outbound/requeue re-queues entry', async () => {
      const app = createTestApp()
      const response = await request(app)
        .post('/sync/outbound/requeue')
        .send({ id: '550e8400-e29b-41d4-a716-446655440000' })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ requeued: true, success: true })
      expect(mockDeps.requeueOutboundSync).toHaveBeenCalledWith(
        'testuser',
        '550e8400-e29b-41d4-a716-446655440000',
      )
    })

    test('POST /sync/outbound/requeue returns 400 for invalid id', async () => {
      const app = createTestApp()
      const response = await request(app).post('/sync/outbound/requeue').send({ id: 'not-a-uuid' })

      expect(response.status).toBe(400)
      expect(mockDeps.requeueOutboundSync).not.toHaveBeenCalled()
    })

    test('GET /sync/outbound/history returns history', async () => {
      const now = new Date('2024-01-15T10:00:00Z')
      vi.mocked(mockDeps.getOutboundSyncHistory).mockResolvedValueOnce([
        {
          created_at: now,
          entity_id: 'ent-1',
          entity_type: 'time_series',
          id: '550e8400-e29b-41d4-a716-446655440000',
          payload: {},
          status: 'synced',
          synced_at: now,
        },
      ])

      const app = createTestApp()
      const response = await request(app).get('/sync/outbound/history').query({ limit: '10' })

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data).toHaveLength(1)
      expect(mockDeps.getOutboundSyncHistory).toHaveBeenCalledWith('testuser', 10)
    })

    test('GET /sync/outbound/history defaults limit to undefined', async () => {
      vi.mocked(mockDeps.getOutboundSyncHistory).mockResolvedValueOnce([])

      const app = createTestApp()
      const response = await request(app).get('/sync/outbound/history')

      expect(response.status).toBe(200)
      expect(mockDeps.getOutboundSyncHistory).toHaveBeenCalledWith('testuser', undefined)
    })
  })
})
