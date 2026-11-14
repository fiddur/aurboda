import { subDays } from 'date-fns'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../../db/index.ts'
import { auditError } from '../../services/audit-log.ts'
import { importActivityExerciseSets } from './exercise-sets.ts'
import { processActivityDetail } from './process.ts'
import { garminRoutedClient } from './source.ts'
import {
  calculateRetryAfter,
  garminDataTypes,
  isRateLimited,
  syncActivityDetails,
  syncActivitySets,
  syncAllGarminData,
  syncGarminDataType,
} from './sync.ts'

// Mock the db module (include all exports used by garmin-process.ts too)
vi.mock('../../db/index.ts', () => ({
  activityTypeExists: vi.fn().mockResolvedValue(true),
  adoptLegacyActivity: vi.fn().mockResolvedValue(null),
  deleteGarminActivityWithWrongType: vi.fn().mockResolvedValue(null),
  getActivitiesNeedingDetail: vi.fn().mockResolvedValue([]),
  getGarminActivitiesNeedingSets: vi.fn().mockResolvedValue([]),
  getOAuthToken: vi.fn().mockResolvedValue({ access_token: '{"oauth1":{},"oauth2":{}}', provider: 'garmin' }),
  getSyncState: vi.fn(),
  insertActivity: vi.fn(),
  insertLocations: vi.fn().mockResolvedValue(undefined),
  insertRawRecord: vi.fn(),
  insertTimeSeries: vi.fn(),
  markActivityDetailSynced: vi.fn().mockResolvedValue(undefined),
  softDeleteSupersededLocations: vi.fn().mockResolvedValue(0),
  upsertActivityTrack: vi.fn().mockResolvedValue(undefined),
  upsertSyncState: vi.fn(),
}))

// Mock garmin-process to avoid importing real db deps
vi.mock('./process', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    processActivityDetail: vi.fn().mockResolvedValue(0),
    processGarminData: vi.fn().mockResolvedValue(1),
  }
})

vi.mock('./exercise-sets', () => ({ importActivityExerciseSets: vi.fn().mockResolvedValue(2) }))

vi.mock('../../services/audit-log', () => ({
  auditError: vi.fn(),
  auditInfo: vi.fn(),
  auditWarn: vi.fn(),
}))

const createMockGarmin = () => ({
  disconnect: vi.fn(),
  getActivities: vi.fn().mockResolvedValue([]),
  getActivityDetail: vi
    .fn()
    .mockResolvedValue({ activityDetailMetrics: [], activityId: 0, metricDescriptors: [] }),
  getActivityExerciseSets: vi.fn().mockResolvedValue({ exerciseSets: [] }),
  getBodyBattery: vi.fn().mockResolvedValue([]),
  getDailySummary: vi.fn().mockResolvedValue({}),
  getHeartRate: vi.fn().mockResolvedValue({}),
  getHrv: vi.fn().mockResolvedValue({}),
  getIntensityMinutes: vi.fn().mockResolvedValue({}),
  getRespiration: vi.fn().mockResolvedValue({}),
  getSleep: vi.fn().mockResolvedValue({}),
  getSpo2: vi.fn().mockResolvedValue({}),
  getStress: vi.fn().mockResolvedValue({}),
  getTrainingReadiness: vi.fn().mockResolvedValue({}),
  login: vi.fn(),
  sourceFor: vi.fn().mockResolvedValue('session'),
})

describe('calculateRetryAfter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('uses Retry-After header when available (seconds converted to minutes ceiling)', () => {
    const result = calculateRetryAfter('120', 0)
    expect(result).toEqual(new Date('2025-01-15T12:02:00Z'))
  })

  test('uses exponential backoff when no header (attempt 0 → 1 min)', () => {
    const result = calculateRetryAfter(undefined, 0)
    expect(result).toEqual(new Date('2025-01-15T12:01:00Z'))
  })

  test('uses exponential backoff when no header (attempt 1 → 5 min)', () => {
    const result = calculateRetryAfter(undefined, 1)
    expect(result).toEqual(new Date('2025-01-15T12:05:00Z'))
  })

  test('uses exponential backoff when no header (attempt 2 → 15 min)', () => {
    const result = calculateRetryAfter(undefined, 2)
    expect(result).toEqual(new Date('2025-01-15T12:15:00Z'))
  })

  test('caps backoff at max value (attempt >= 3 → 60 min)', () => {
    const result = calculateRetryAfter(undefined, 5)
    expect(result).toEqual(new Date('2025-01-15T13:00:00Z'))
  })

  test('handles invalid Retry-After header (falls back to backoff)', () => {
    const result = calculateRetryAfter('invalid', 0)
    expect(result).toEqual(new Date('2025-01-15T12:01:00Z'))
  })
})

describe('isRateLimited', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('returns false when syncState is null', () => {
    expect(isRateLimited(null)).toBe(false)
  })

  test('returns false when status is not rate_limited', () => {
    expect(
      isRateLimited({
        data_type: 'dailySummary',
        provider: 'garmin',
        retry_after: new Date('2025-01-15T13:00:00Z'),
        status: 'idle',
      }),
    ).toBe(false)
  })

  test('returns false when retry_after is in the past', () => {
    expect(
      isRateLimited({
        data_type: 'dailySummary',
        provider: 'garmin',
        retry_after: new Date('2025-01-15T11:00:00Z'),
        status: 'rate_limited',
      }),
    ).toBe(false)
  })

  test('returns true when rate_limited and retry_after is in the future', () => {
    expect(
      isRateLimited({
        data_type: 'dailySummary',
        provider: 'garmin',
        retry_after: new Date('2025-01-15T13:00:00Z'),
        status: 'rate_limited',
      }),
    ).toBe(true)
  })
})

describe('syncGarminDataType', () => {
  const user = 'testuser'

  beforeEach(() => {
    vi.clearAllMocks()
    // Use real timers so the 100ms delay() in the sync loop resolves naturally
  })

  test.each([
    ['no oauth_tokens row', null],
    ['a disconnected (empty) token', { access_token: '', provider: 'garmin' }],
  ])('a user with %s gets an error without any fetch, sync_state write or audit entry', async (_, stored) => {
    vi.mocked(db.getOAuthToken).mockResolvedValueOnce(stored as never)
    vi.mocked(db.getSyncState).mockResolvedValue(null)

    const mockGarmin = createMockGarmin()
    const result = await syncGarminDataType(user, mockGarmin as never, 'dailySummary')

    expect(result).toEqual({
      data_type: 'dailySummary',
      error: 'User has no Garmin session. Please connect Garmin first.',
      records_processed: 0,
      status: 'error',
    })
    expect(mockGarmin.getDailySummary).not.toHaveBeenCalled()
    expect(db.upsertSyncState).not.toHaveBeenCalled()
    expect(auditError).not.toHaveBeenCalled()
  })

  test('a type no connection serves is skipped without a fetch or a sync_state write', async () => {
    vi.mocked(db.getOAuthToken).mockImplementation(async (_user, provider) =>
      provider === 'garmin_personal'
        ? { access_token: '', provider, refresh_token: 'fake-key' }
        : { access_token: '', provider },
    )
    const session = createMockGarmin()
    const personal = createMockGarmin()
    const garmin = garminRoutedClient({ personal: personal as never, session: session as never })

    try {
      const result = await syncGarminDataType(user, garmin, 'stress')

      expect(result).toEqual({ data_type: 'stress', records_processed: 0, status: 'skipped' })
      expect(session.getStress).not.toHaveBeenCalled()
      expect(db.getSyncState).not.toHaveBeenCalled()
      expect(db.upsertSyncState).not.toHaveBeenCalled()
    } finally {
      vi.mocked(db.getOAuthToken).mockReset().mockResolvedValue({
        access_token: '{"oauth1":{},"oauth2":{}}',
        provider: 'garmin',
      })
    }
  })

  test('with both a session and a key, sleep comes from the session and heart rate from the key', async () => {
    vi.mocked(db.getOAuthToken).mockImplementation(async (_user, provider) =>
      provider === 'garmin_personal'
        ? { access_token: '', provider, refresh_token: 'fake-key' }
        : { access_token: '{"oauth1":{},"oauth2":{}}', provider },
    )
    vi.mocked(db.getSyncState).mockResolvedValue({
      data_type: 'sleep',
      last_sync_time: new Date(),
      provider: 'garmin',
      status: 'idle',
    })
    const session = createMockGarmin()
    const personal = createMockGarmin()
    const garmin = garminRoutedClient({ personal: personal as never, session: session as never })

    try {
      expect((await syncGarminDataType(user, garmin, 'sleep')).status).toBe('success')
      expect((await syncGarminDataType(user, garmin, 'heartRate')).status).toBe('success')

      expect(session.getSleep).toHaveBeenCalled()
      expect(personal.getSleep).not.toHaveBeenCalled()
      expect(personal.getHeartRate).toHaveBeenCalled()
      expect(session.getHeartRate).not.toHaveBeenCalled()
    } finally {
      vi.mocked(db.getOAuthToken).mockReset().mockResolvedValue({
        access_token: '{"oauth1":{},"oauth2":{}}',
        provider: 'garmin',
      })
    }
  })

  test('skips sync when rate limited', async () => {
    vi.mocked(db.getSyncState).mockResolvedValue({
      data_type: 'dailySummary',
      provider: 'garmin',
      retry_after: new Date(Date.now() + 3_600_000), // 1 hour in the future
      status: 'rate_limited',
    })

    const mockGarmin = createMockGarmin()
    const result = await syncGarminDataType(user, mockGarmin as never, 'dailySummary')

    expect(result.status).toBe('rate_limited')
    expect(result.retry_after).toBeDefined()
    expect(mockGarmin.getDailySummary).not.toHaveBeenCalled()
    expect(db.upsertSyncState).not.toHaveBeenCalled()
  })

  test('updates sync state on success (marks syncing then idle)', async () => {
    vi.mocked(db.getSyncState).mockResolvedValue({
      data_type: 'dailySummary',
      last_sync_time: new Date(),
      provider: 'garmin',
      status: 'idle',
    })

    const mockGarmin = createMockGarmin()
    const result = await syncGarminDataType(user, mockGarmin as never, 'dailySummary')

    expect(result.status).toBe('success')
    expect(result.records_processed).toBeGreaterThanOrEqual(1)

    // Should mark as syncing, then idle
    expect(db.upsertSyncState).toHaveBeenCalledWith(user, expect.objectContaining({ status: 'syncing' }))
    expect(db.upsertSyncState).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        last_sync_time: expect.any(Date),
        status: 'idle',
      }),
    )
  })

  test('first sync (no sync state) uses 90-day history', async () => {
    vi.mocked(db.getSyncState).mockResolvedValue(null)

    const mockGarmin = createMockGarmin()
    const capturedDates: Date[] = []
    mockGarmin.getDailySummary.mockImplementation(async (_user: string, date: Date) => {
      capturedDates.push(new Date(date))
      // Throw to abort iteration quickly (caught by fetchAndProcess)
      throw new Error('abort')
    })

    const beforeCall = new Date()
    await syncGarminDataType(user, mockGarmin as never, 'dailySummary')

    // First call should be with a date ~90 days before `now`
    expect(capturedDates.length).toBeGreaterThan(0)
    const daysDiff = (beforeCall.getTime() - capturedDates[0]!.getTime()) / (1000 * 60 * 60 * 24)
    expect(daysDiff).toBeCloseTo(90, 0)
  }, 15_000)

  test('full resync uses 90-day history', async () => {
    vi.mocked(db.getSyncState).mockResolvedValue({
      data_type: 'dailySummary',
      last_sync_time: new Date(),
      provider: 'garmin',
      status: 'idle',
    })

    const mockGarmin = createMockGarmin()
    const capturedDates: Date[] = []
    mockGarmin.getDailySummary.mockImplementation(async (_user: string, date: Date) => {
      capturedDates.push(new Date(date))
      throw new Error('abort')
    })

    const beforeCall = new Date()
    await syncGarminDataType(user, mockGarmin as never, 'dailySummary', {
      fullResync: true,
    })

    expect(capturedDates.length).toBeGreaterThan(0)
    const daysDiff = (beforeCall.getTime() - capturedDates[0]!.getTime()) / (1000 * 60 * 60 * 24)
    expect(daysDiff).toBeCloseTo(90, 0)
  }, 15_000)

  test('incremental sync uses 2-day overlap from last_sync_time', async () => {
    const lastSyncTime = subDays(new Date(), 1)
    vi.mocked(db.getSyncState).mockResolvedValue({
      data_type: 'dailySummary',
      last_sync_time: lastSyncTime,
      provider: 'garmin',
      status: 'idle',
    })

    const mockGarmin = createMockGarmin()
    const capturedDates: Date[] = []
    mockGarmin.getDailySummary.mockImplementation(async (_user: string, date: Date) => {
      capturedDates.push(new Date(date))
      return {}
    })

    await syncGarminDataType(user, mockGarmin as never, 'dailySummary')

    // Should start from lastSyncTime - 2 days = 3 days before now
    expect(capturedDates.length).toBeGreaterThan(0)
    const expectedStart = subDays(lastSyncTime, 2)
    // Allow 1 second tolerance for test execution time
    expect(Math.abs(capturedDates[0]!.getTime() - expectedStart.getTime())).toBeLessThan(1000)
  })
})

describe('syncActivityDetails', () => {
  const user = 'testuser'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('fetches detail for activities without detail_synced', async () => {
    const activity = {
      activity_type: 'exercise' as const,
      data: { garmin_activity_id: 12345 },
      end_time: new Date(),
      id: 'test-id',
      source: 'health_connect' as const,
      start_time: new Date(),
    }
    vi.mocked(db.getActivitiesNeedingDetail).mockResolvedValue([activity])

    const mockGarmin = createMockGarmin()
    await syncActivityDetails(user, mockGarmin as never)

    expect(db.getActivitiesNeedingDetail).toHaveBeenCalledWith(user, { forceAll: false })
    expect(mockGarmin.getActivityDetail).toHaveBeenCalledWith(user, 12345)
    expect(db.markActivityDetailSynced).toHaveBeenCalledWith(user, 'test-id')
  })

  test('passes the activity id and the track callback to the detail processor', async () => {
    const start = new Date('2026-05-01T08:00:00Z')
    const end = new Date('2026-05-01T09:00:00Z')
    vi.mocked(db.getActivitiesNeedingDetail).mockResolvedValue([
      {
        activity_type: 'running' as const,
        data: { garmin_activity_id: 12345 },
        end_time: end,
        id: 'test-id',
        source: 'garmin' as const,
        start_time: start,
      },
    ])
    const onTrackWritten = vi.fn()

    await syncActivityDetails(user, createMockGarmin() as never, { onTrackWritten })

    expect(processActivityDetail).toHaveBeenCalledWith(user, expect.anything(), {
      activityId: 'test-id',
      activitySpan: { end, start },
      activityStart: start,
      onTrackWritten,
    })
  })

  test('does nothing without a source for the detail (a key and no session)', async () => {
    const mockGarmin = createMockGarmin()
    mockGarmin.sourceFor.mockResolvedValue(null)

    await syncActivityDetails(user, mockGarmin as never)

    expect(mockGarmin.sourceFor).toHaveBeenCalledWith(user, 'activityDetail')
    expect(db.getActivitiesNeedingDetail).not.toHaveBeenCalled()
    expect(mockGarmin.getActivityDetail).not.toHaveBeenCalled()
  })

  test('passes forceAll when fullResync is true', async () => {
    vi.mocked(db.getActivitiesNeedingDetail).mockResolvedValue([])

    const mockGarmin = createMockGarmin()
    await syncActivityDetails(user, mockGarmin as never, { fullResync: true })

    expect(db.getActivitiesNeedingDetail).toHaveBeenCalledWith(user, { forceAll: true })
  })

  const garminActivity = (id: string, data: Record<string, unknown>) => ({
    activity_type: 'running' as const,
    data,
    end_time: new Date(),
    id,
    source: 'garmin' as const,
    start_time: new Date(),
  })

  test('reports an activity whose detail landed for the first time', async () => {
    vi.mocked(db.getActivitiesNeedingDetail).mockResolvedValue([
      garminActivity('a1', { garmin_activity_id: 1 }),
    ])
    const onDetailSynced = vi.fn()

    await syncActivityDetails(user, createMockGarmin() as never, { onDetailSynced })

    expect(onDetailSynced).toHaveBeenCalledWith(user, 'a1')
  })

  test('does not report a failed detail fetch', async () => {
    vi.mocked(db.getActivitiesNeedingDetail).mockResolvedValue([
      garminActivity('a1', { garmin_activity_id: 1 }),
    ])
    const mockGarmin = createMockGarmin()
    mockGarmin.getActivityDetail.mockRejectedValue(new Error('404'))
    const onDetailSynced = vi.fn()

    await syncActivityDetails(user, mockGarmin as never, { onDetailSynced })

    expect(db.markActivityDetailSynced).not.toHaveBeenCalled()
    expect(onDetailSynced).not.toHaveBeenCalled()
  })

  test('a full re-sync does not report activities that already had their detail', async () => {
    vi.mocked(db.getActivitiesNeedingDetail).mockResolvedValue([
      garminActivity('a1', { detail_synced: true, garmin_activity_id: 1 }),
    ])
    const onDetailSynced = vi.fn()

    await syncActivityDetails(user, createMockGarmin() as never, { fullResync: true, onDetailSynced })

    expect(db.markActivityDetailSynced).toHaveBeenCalledWith(user, 'a1')
    expect(onDetailSynced).not.toHaveBeenCalled()
  })

  test('skips activities without garmin_activity_id', async () => {
    const activity = {
      activity_type: 'exercise' as const,
      data: {},
      end_time: new Date(),
      id: 'test-id',
      source: 'garmin' as const,
      start_time: new Date(),
    }
    vi.mocked(db.getActivitiesNeedingDetail).mockResolvedValue([activity])

    const mockGarmin = createMockGarmin()
    await syncActivityDetails(user, mockGarmin as never)

    expect(mockGarmin.getActivityDetail).not.toHaveBeenCalled()
  })
})

describe('syncActivitySets', () => {
  const user = 'testuser'

  const strength = (id: string, garminActivityId: number) => ({
    activity_type: 'strength_training' as const,
    data: { garmin_activity_id: garminActivityId },
    end_time: new Date(),
    id,
    source: 'garmin' as const,
    start_time: new Date(),
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('fetches and imports the sets of each activity needing them', async () => {
    const activity = strength('s1', 11)
    vi.mocked(db.getGarminActivitiesNeedingSets).mockResolvedValue([activity])
    const response = { exerciseSets: [{ repetitionCount: 5 }] }
    const mockGarmin = createMockGarmin()
    mockGarmin.getActivityExerciseSets.mockResolvedValue(response)

    await syncActivitySets(user, mockGarmin as never)

    expect(db.getGarminActivitiesNeedingSets).toHaveBeenCalledWith(user, { forceAll: false })
    expect(mockGarmin.getActivityExerciseSets).toHaveBeenCalledWith(user, 11)
    expect(importActivityExerciseSets).toHaveBeenCalledWith(user, activity, response)
  })

  test('an error on one activity is audited and does not stop the next', async () => {
    vi.mocked(db.getGarminActivitiesNeedingSets).mockResolvedValue([strength('s1', 11), strength('s2', 12)])
    const mockGarmin = createMockGarmin()
    mockGarmin.getActivityExerciseSets.mockRejectedValueOnce(new Error('500'))

    await syncActivitySets(user, mockGarmin as never)

    expect(auditError).toHaveBeenCalledWith(user, 'sync', 'Failed to sync sets for Garmin activity 11', {
      error: '500',
    })
    expect(importActivityExerciseSets).toHaveBeenCalledTimes(1)
    expect(vi.mocked(importActivityExerciseSets).mock.calls[0][1].id).toBe('s2')
  })

  test('passes forceAll when fullResync is true', async () => {
    vi.mocked(db.getGarminActivitiesNeedingSets).mockResolvedValue([])

    await syncActivitySets(user, createMockGarmin() as never, { fullResync: true })

    expect(db.getGarminActivitiesNeedingSets).toHaveBeenCalledWith(user, { forceAll: true })
  })
})

describe('syncActivityDetails reads sets first', () => {
  const user = 'testuser'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('sets are fetched before details, even when no detail is due', async () => {
    const order: string[] = []
    vi.mocked(db.getGarminActivitiesNeedingSets).mockResolvedValue([
      {
        activity_type: 'strength_training' as const,
        data: { garmin_activity_id: 11 },
        id: 's1',
        source: 'garmin' as const,
        start_time: new Date(),
      },
    ])
    vi.mocked(db.getActivitiesNeedingDetail).mockImplementation(async () => {
      order.push('detail')
      return []
    })
    const mockGarmin = createMockGarmin()
    mockGarmin.getActivityExerciseSets.mockImplementation(async () => {
      order.push('sets')
      return { exerciseSets: [] }
    })

    await syncActivityDetails(user, mockGarmin as never)

    expect(order).toEqual(['sets', 'detail'])
  })

  test('nothing is fetched without a session', async () => {
    const mockGarmin = createMockGarmin()
    mockGarmin.sourceFor.mockResolvedValue(null)

    await syncActivityDetails(user, mockGarmin as never)

    expect(db.getGarminActivitiesNeedingSets).not.toHaveBeenCalled()
    expect(mockGarmin.getActivityExerciseSets).not.toHaveBeenCalled()
  })

  test('fullResync passes forceAll to the sets as well', async () => {
    await syncActivityDetails(user, createMockGarmin() as never, { fullResync: true })

    expect(db.getGarminActivitiesNeedingSets).toHaveBeenCalledWith(user, { forceAll: true })
  })
})

describe('syncAllGarminData', () => {
  const user = 'testuser'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns results for all data types', async () => {
    // Use recent last_sync_time so incremental sync only covers a few days
    vi.mocked(db.getSyncState).mockResolvedValue({
      data_type: 'dailySummary',
      last_sync_time: new Date(),
      provider: 'garmin',
      status: 'idle',
    })

    const mockGarmin = createMockGarmin()
    const results = await syncAllGarminData(user, mockGarmin as never)

    expect(results).toHaveLength(garminDataTypes.length)
    for (const result of results) {
      expect(garminDataTypes).toContain(result.data_type)
    }
  })

  test('skips disabled data types', async () => {
    vi.mocked(db.getSyncState).mockResolvedValue({
      data_type: 'dailySummary',
      last_sync_time: new Date(),
      provider: 'garmin',
      status: 'idle',
    })

    const mockGarmin = createMockGarmin()
    const results = await syncAllGarminData(user, mockGarmin as never, {
      disabledTypes: ['heartRate', 'sleep', 'activities'],
    })

    expect(results).toHaveLength(garminDataTypes.length)

    const skippedTypes = results.filter((r) => r.status === 'skipped').map((r) => r.data_type)
    expect(skippedTypes).toContain('heartRate')
    expect(skippedTypes).toContain('sleep')
    expect(skippedTypes).toContain('activities')

    // Non-disabled types should have been synced
    const syncedTypes = results.filter((r) => r.status === 'success').map((r) => r.data_type)
    expect(syncedTypes).toContain('dailySummary')
    expect(syncedTypes).toContain('stress')
  })

  test('skips remaining data types after hitting rate limit', async () => {
    // Return rate_limited sync state for all data types (mock returns same value)
    vi.mocked(db.getSyncState).mockResolvedValue({
      data_type: 'dailySummary',
      provider: 'garmin',
      retry_after: new Date(Date.now() + 3_600_000),
      status: 'rate_limited',
    })

    const mockGarmin = createMockGarmin()
    const results = await syncAllGarminData(user, mockGarmin as never)

    expect(results).toHaveLength(garminDataTypes.length)

    // First result should be rate_limited (from the existing sync state)
    expect(results[0]!.data_type).toBe('dailySummary')
    expect(results[0]!.status).toBe('rate_limited')

    // All remaining results should be skipped
    for (const result of results.slice(1)) {
      expect(result.status).toBe('skipped')
    }
  })
})
