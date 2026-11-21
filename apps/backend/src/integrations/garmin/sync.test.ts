import { subDays } from 'date-fns'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../../db/index.ts'
import { auditError, auditInfo, auditWarn } from '../../services/audit-log.ts'
import { importActivityExerciseSets } from './exercise-sets.ts'
import { parseActivityFit } from './fit.ts'
import { processActivityDetail, processActivityFit, processGarminData } from './process.ts'
import { garminRoutedClient } from './source.ts'
import {
  calculateRetryAfter,
  garminDataTypes,
  isRateLimited,
  resyncActivityDetail,
  syncActivityDetails,
  syncActivitySets,
  syncAllGarminData,
  syncGarminDataType,
  syncGarminDataTypeAutomatically,
} from './sync.ts'

// Mock the db module (include all exports used by garmin-process.ts too)
vi.mock('../../db/index.ts', () => ({
  activityTypeExists: vi.fn().mockResolvedValue(true),
  adoptLegacyActivity: vi.fn().mockResolvedValue(null),
  deleteGarminActivityWithWrongType: vi.fn().mockResolvedValue(null),
  findActivityByExternalId: vi.fn().mockResolvedValue(null),
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
    processActivityFit: vi.fn().mockResolvedValue(7),
    processGarminData: vi.fn().mockResolvedValue(1),
  }
})

const FAKE_FIT = { fileIds: [], laps: [], records: [], sessions: [] }

vi.mock('./fit', () => ({
  parseActivityFit: vi.fn((bytes: Uint8Array) => (bytes.length > 0 ? FAKE_FIT : null)),
}))

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
  getActivityFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
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
  pushDelivers: vi.fn().mockResolvedValue(false),
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

  test('hands each payload to the processor with the day it was requested for', async () => {
    vi.mocked(db.getSyncState).mockResolvedValue(null)
    const mockGarmin = createMockGarmin()
    const answer = [{ score: 70 }]
    mockGarmin.getTrainingReadiness.mockResolvedValue(answer)
    const startDate = subDays(new Date(), 1)

    await syncGarminDataType(user, mockGarmin as never, 'trainingReadiness', { fullResync: true, startDate })

    expect(processGarminData).toHaveBeenCalledWith(
      user,
      'trainingReadiness',
      answer,
      undefined,
      startDate.toISOString().slice(0, 10),
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

describe('syncActivityDetails from the FIT file', () => {
  const user = 'testuser'
  const start = new Date('2026-05-01T08:00:00Z')
  const end = new Date('2026-05-01T09:00:00Z')

  const activity = (data: Record<string, unknown> = {}) => ({
    activity_type: 'running' as const,
    data: { garmin_activity_id: 12345, ...data },
    end_time: end,
    id: 'act-1',
    source: 'garmin' as const,
    start_time: start,
  })

  const garminWith = ({ session }: { session: boolean }) => {
    const garmin = createMockGarmin()
    garmin.sourceFor.mockImplementation(async (_user: string, target: string) =>
      target === 'activityDetail' ? 'personal_key' : session ? 'session' : null,
    )
    return garmin
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getActivitiesNeedingDetail).mockResolvedValue([activity()])
  })

  test('a key alone reads the FIT file and processes it, without the session calls', async () => {
    const garmin = garminWith({ session: false })
    const onDetailSynced = vi.fn()
    const onTrackWritten = vi.fn()

    await syncActivityDetails(user, garmin as never, { onDetailSynced, onTrackWritten })

    expect(garmin.getActivityFile).toHaveBeenCalledWith(user, 12345)
    expect(parseActivityFit).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]))
    expect(processActivityFit).toHaveBeenCalledWith(
      user,
      { fit: FAKE_FIT, garminActivityId: 12345 },
      { activityId: 'act-1', activitySpan: { end, start }, activityStart: start, onTrackWritten },
    )
    expect(garmin.getActivityDetail).not.toHaveBeenCalled()
    expect(db.getGarminActivitiesNeedingSets).not.toHaveBeenCalled()
    expect(db.markActivityDetailSynced).toHaveBeenCalledWith(user, 'act-1')
    expect(onDetailSynced).toHaveBeenCalledWith(user, 'act-1')
    expect(auditInfo).toHaveBeenCalledWith(
      user,
      'sync',
      '📊 Synced 7 detail metrics for Garmin activity 12345 from its FIT file',
    )
  })

  test('with a key and a session the FIT file wins, and sets still come from the session', async () => {
    const garmin = garminWith({ session: true })

    await syncActivityDetails(user, garmin as never)

    expect(processActivityFit).toHaveBeenCalled()
    expect(garmin.getActivityDetail).not.toHaveBeenCalled()
    expect(db.getGarminActivitiesNeedingSets).toHaveBeenCalled()
  })

  test('a missing file falls back to the JSON detail when there is a session', async () => {
    const garmin = garminWith({ session: true })
    garmin.getActivityFile.mockResolvedValue(null)
    const onDetailSynced = vi.fn()

    await syncActivityDetails(user, garmin as never, { onDetailSynced })

    expect(garmin.getActivityDetail).toHaveBeenCalledWith(user, 12345)
    expect(processActivityDetail).toHaveBeenCalled()
    expect(processActivityFit).not.toHaveBeenCalled()
    expect(db.markActivityDetailSynced).toHaveBeenCalledWith(user, 'act-1')
    expect(onDetailSynced).toHaveBeenCalledWith(user, 'act-1')
  })

  test('an unreadable file is treated like a missing one', async () => {
    const garmin = garminWith({ session: true })
    garmin.getActivityFile.mockResolvedValue(new Uint8Array(0))

    await syncActivityDetails(user, garmin as never)

    expect(processActivityFit).not.toHaveBeenCalled()
    expect(garmin.getActivityDetail).toHaveBeenCalledWith(user, 12345)
  })

  test('an archive over the total size limit fails the activity with an audited error', async () => {
    const garmin = garminWith({ session: false })
    vi.mocked(parseActivityFit).mockImplementationOnce(() => {
      throw new Error("The activity archive's FIT files inflate to more than 419430400 bytes")
    })

    await syncActivityDetails(user, garmin as never)

    expect(processActivityFit).not.toHaveBeenCalled()
    expect(db.markActivityDetailSynced).not.toHaveBeenCalled()
    expect(auditError).toHaveBeenCalledWith(
      user,
      'sync',
      'Failed to sync FIT file for Garmin activity 12345',
      {
        error: "The activity archive's FIT files inflate to more than 419430400 bytes",
      },
    )
  })

  test('a missing file without a session marks the activity done once, with an audit line', async () => {
    const garmin = garminWith({ session: false })
    garmin.getActivityFile.mockResolvedValue(null)
    const onDetailSynced = vi.fn()

    await syncActivityDetails(user, garmin as never, { onDetailSynced })

    expect(db.markActivityDetailSynced).toHaveBeenCalledTimes(1)
    expect(db.markActivityDetailSynced).toHaveBeenCalledWith(user, 'act-1')
    expect(auditInfo).toHaveBeenCalledWith(user, 'sync', '📄 Garmin has no activity file for activity 12345')
    expect(garmin.getActivityDetail).not.toHaveBeenCalled()
    expect(onDetailSynced).not.toHaveBeenCalled()
  })

  test('a fresh activity without a file and without a session stays unmarked and logs nothing', async () => {
    const garmin = garminWith({ session: false })
    garmin.getActivityFile.mockResolvedValue(null)
    const onDetailSynced = vi.fn()

    await syncActivityDetails(user, garmin as never, {
      now: new Date(start.getTime() + 23 * 3_600_000),
      onDetailSynced,
    })

    expect(db.markActivityDetailSynced).not.toHaveBeenCalled()
    expect(auditInfo).not.toHaveBeenCalled()
    expect(auditError).not.toHaveBeenCalled()
    expect(onDetailSynced).not.toHaveBeenCalled()
  })

  test('an activity over a day old without a file is marked done with an audit line', async () => {
    const garmin = garminWith({ session: false })
    garmin.getActivityFile.mockResolvedValue(null)

    await syncActivityDetails(user, garmin as never, { now: new Date(start.getTime() + 25 * 3_600_000) })

    expect(db.markActivityDetailSynced).toHaveBeenCalledWith(user, 'act-1')
    expect(auditInfo).toHaveBeenCalledWith(user, 'sync', '📄 Garmin has no activity file for activity 12345')
  })

  test('a fresh activity with a file is processed and marked as before', async () => {
    const onDetailSynced = vi.fn()

    await syncActivityDetails(user, garminWith({ session: false }) as never, {
      now: new Date(start.getTime() + 3_600_000),
      onDetailSynced,
    })

    expect(processActivityFit).toHaveBeenCalled()
    expect(db.markActivityDetailSynced).toHaveBeenCalledWith(user, 'act-1')
    expect(onDetailSynced).toHaveBeenCalledWith(user, 'act-1')
  })

  test('a failed download without a session leaves the activity for the next run', async () => {
    const garmin = garminWith({ session: false })
    garmin.getActivityFile.mockRejectedValue(new Error('Garmin Personal API 503 for /download-service'))
    const onDetailSynced = vi.fn()

    await syncActivityDetails(user, garmin as never, { onDetailSynced })

    expect(db.markActivityDetailSynced).not.toHaveBeenCalled()
    expect(onDetailSynced).not.toHaveBeenCalled()
    expect(garmin.getActivityDetail).not.toHaveBeenCalled()
    expect(auditError).toHaveBeenCalledWith(
      user,
      'sync',
      'Failed to sync FIT file for Garmin activity 12345',
      {
        error: 'Garmin Personal API 503 for /download-service',
      },
    )
  })

  test('a failed download falls back to the JSON detail when there is a session', async () => {
    const garmin = garminWith({ session: true })
    garmin.getActivityFile.mockRejectedValue(new Error('Garmin Personal API 403 for /download-service'))
    const onDetailSynced = vi.fn()

    await syncActivityDetails(user, garmin as never, { onDetailSynced })

    expect(garmin.getActivityDetail).toHaveBeenCalledWith(user, 12345)
    expect(processActivityDetail).toHaveBeenCalled()
    expect(processActivityFit).not.toHaveBeenCalled()
    expect(db.markActivityDetailSynced).toHaveBeenCalledWith(user, 'act-1')
    expect(onDetailSynced).toHaveBeenCalledWith(user, 'act-1')
    expect(auditError).not.toHaveBeenCalled()
    expect(auditWarn).toHaveBeenCalledWith(
      user,
      'sync',
      "FIT file for Garmin activity 12345 failed, using the login's detail",
      { error: 'Garmin Personal API 403 for /download-service' },
    )
  })

  test('a file that cannot be processed falls back to the JSON detail when there is a session', async () => {
    const garmin = garminWith({ session: true })
    vi.mocked(processActivityFit).mockRejectedValueOnce(new Error('bad record'))

    await syncActivityDetails(user, garmin as never)

    expect(garmin.getActivityDetail).toHaveBeenCalledWith(user, 12345)
    expect(db.markActivityDetailSynced).toHaveBeenCalledWith(user, 'act-1')
  })

  test('an activity that already had its detail is not reported again', async () => {
    vi.mocked(db.getActivitiesNeedingDetail).mockResolvedValue([activity({ detail_synced: true })])
    const onDetailSynced = vi.fn()

    await syncActivityDetails(user, garminWith({ session: false }) as never, {
      fullResync: true,
      onDetailSynced,
    })

    expect(db.markActivityDetailSynced).toHaveBeenCalledWith(user, 'act-1')
    expect(onDetailSynced).not.toHaveBeenCalled()
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

describe('syncGarminDataTypeAutomatically', () => {
  const user = 'alice'
  const now = new Date('2026-11-18T12:00:00Z')

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getSyncState).mockResolvedValue({
      data_type: 'sleep',
      last_sync_time: now,
      provider: 'garmin',
      status: 'idle',
    })
    vi.mocked(db.getActivitiesNeedingDetail).mockResolvedValue([])
    vi.mocked(db.getGarminActivitiesNeedingSets).mockResolvedValue([])
  })

  test('leaves a delivered type to the push and stamps its sync state', async () => {
    const garmin = createMockGarmin()
    garmin.pushDelivers.mockResolvedValue(true)
    const onPull = vi.fn()

    const result = await syncGarminDataTypeAutomatically(user, garmin as never, 'sleep', { now, onPull })

    expect(result).toEqual({
      data_type: 'sleep',
      delivered_by_push: true,
      records_processed: 0,
      status: 'skipped',
    })
    expect(garmin.pushDelivers).toHaveBeenCalledWith(user, 'sleep')
    expect(garmin.getSleep).not.toHaveBeenCalled()
    expect(onPull).not.toHaveBeenCalled()
    expect(db.upsertSyncState).toHaveBeenCalledWith(user, {
      data_type: 'sleep',
      error_message: undefined,
      last_sync_time: now,
      provider: 'garmin',
      retry_after: undefined,
      status: 'idle',
    })
  })

  test('does not stamp a state a manual sync is holding', async () => {
    vi.mocked(db.getSyncState).mockResolvedValue({
      data_type: 'sleep',
      provider: 'garmin',
      status: 'syncing',
    })
    const garmin = createMockGarmin()
    garmin.pushDelivers.mockResolvedValue(true)

    const result = await syncGarminDataTypeAutomatically(user, garmin as never, 'sleep', { now })

    expect(result.delivered_by_push).toBe(true)
    expect(result.status).toBe('skipped')
    expect(db.upsertSyncState).not.toHaveBeenCalled()
  })

  test('pulls a type the push does not deliver, telling onPull first', async () => {
    const garmin = createMockGarmin()
    const order: string[] = []
    const onPull = vi.fn(() => order.push('onPull'))
    garmin.getSleep.mockImplementation(async () => {
      order.push('fetch')
      return {}
    })

    const result = await syncGarminDataTypeAutomatically(user, garmin as never, 'sleep', { onPull })

    expect(result.status).toBe('success')
    expect(result.delivered_by_push).toBeUndefined()
    expect(onPull).toHaveBeenCalledOnce()
    expect(order[0]).toBe('onPull')
    expect(garmin.getSleep).toHaveBeenCalled()
  })

  test.each([
    ['delivered', true],
    ['not delivered', false],
  ])('activities %s still run the detail sync', async (_, delivered) => {
    const garmin = createMockGarmin()
    garmin.pushDelivers.mockResolvedValue(delivered)
    const onDetailSynced = vi.fn()
    const twoHoursOld = new Date(now.getTime() - 2 * 3_600_000)
    vi.mocked(db.getActivitiesNeedingDetail).mockResolvedValue([
      {
        activity_type: 'running' as const,
        data: { garmin_activity_id: 4242 },
        end_time: now,
        id: 'fresh',
        source: 'garmin' as const,
        start_time: twoHoursOld,
      },
    ])

    await syncGarminDataTypeAutomatically(user, garmin as never, 'activities', { now, onDetailSynced })

    expect(db.getActivitiesNeedingDetail).toHaveBeenCalledWith(user, { forceAll: false })
    expect(db.getGarminActivitiesNeedingSets).toHaveBeenCalled()
    if (delivered) expect(garmin.getActivityDetail).not.toHaveBeenCalled()
    else expect(garmin.getActivityDetail).toHaveBeenCalledWith(user, 4242)
  })

  test('a type other than activities runs no detail sync', async () => {
    await syncGarminDataTypeAutomatically(user, createMockGarmin() as never, 'hrv', { now })

    expect(db.getActivitiesNeedingDetail).not.toHaveBeenCalled()
  })
})

describe('syncActivityDetails waiting for the pushed file', () => {
  const user = 'alice'
  const now = new Date('2026-11-18T12:00:00Z')
  const activity = (id: string, garminActivityId: number, hoursOld: number) => ({
    activity_type: 'running' as const,
    data: { garmin_activity_id: garminActivityId },
    end_time: now,
    id,
    source: 'garmin' as const,
    start_time: new Date(now.getTime() - hoursOld * 3_600_000),
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getGarminActivitiesNeedingSets).mockResolvedValue([])
    vi.mocked(db.getActivitiesNeedingDetail).mockResolvedValue([
      activity('fresh', 1, 2),
      activity('old', 2, 48),
    ])
  })

  test('skips an activity under a day old and fetches an older one', async () => {
    const garmin = createMockGarmin()

    await syncActivityDetails(user, garmin as never, { now, waitForPushedFile: true })

    expect(garmin.getActivityDetail).toHaveBeenCalledTimes(1)
    expect(garmin.getActivityDetail).toHaveBeenCalledWith(user, 2)
    expect(db.markActivityDetailSynced).not.toHaveBeenCalledWith(user, 'fresh')
    expect(db.markActivityDetailSynced).toHaveBeenCalledWith(user, 'old')
  })

  test('still syncs the strength sets', async () => {
    await syncActivityDetails(user, createMockGarmin() as never, { now, waitForPushedFile: true })

    expect(db.getGarminActivitiesNeedingSets).toHaveBeenCalledWith(user, { forceAll: false })
  })

  test('a full re-sync ignores it', async () => {
    const garmin = createMockGarmin()

    await syncActivityDetails(user, garmin as never, { fullResync: true, now, waitForPushedFile: true })

    expect(garmin.getActivityDetail).toHaveBeenCalledWith(user, 1)
    expect(garmin.getActivityDetail).toHaveBeenCalledWith(user, 2)
  })
})

describe('resyncActivityDetail', () => {
  const user = 'testuser'
  const start = new Date('2026-05-01T08:00:00Z')
  const end = new Date('2026-05-01T09:00:00Z')
  const activity = {
    activityId: 'act-1',
    activitySpan: { end, start },
    activityStart: start,
    garminActivityId: 12345,
  }

  const garminWith = ({ key, session }: { key: boolean; session: boolean }) => {
    const garmin = createMockGarmin()
    garmin.sourceFor.mockImplementation(async (_user: string, target: string) => {
      if (target === 'activityDetail') return key ? 'personal_key' : session ? 'session' : null
      return session ? 'session' : null
    })
    return garmin
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('without a connection that can pull, nothing is fetched', async () => {
    const garmin = garminWith({ key: false, session: false })

    const result = await resyncActivityDetail(user, garmin as never, activity)

    expect(result).toEqual({ status: 'no_connection' })
    expect(garmin.getActivityFile).not.toHaveBeenCalled()
    expect(garmin.getActivityDetail).not.toHaveBeenCalled()
    expect(db.markActivityDetailSynced).not.toHaveBeenCalled()
  })

  test('a key with a file processes the FIT file and marks the activity', async () => {
    const garmin = garminWith({ key: true, session: false })
    const onDetailSynced = vi.fn()
    const onTrackWritten = vi.fn()

    const result = await resyncActivityDetail(user, garmin as never, activity, {
      onDetailSynced,
      onTrackWritten,
    })

    expect(result).toEqual({ points: 7, status: 'synced' })
    expect(processActivityFit).toHaveBeenCalledWith(
      user,
      { fit: FAKE_FIT, garminActivityId: 12345 },
      { activityId: 'act-1', activitySpan: { end, start }, activityStart: start, onTrackWritten },
    )
    expect(garmin.getActivityDetail).not.toHaveBeenCalled()
    expect(db.markActivityDetailSynced).toHaveBeenCalledWith(user, 'act-1')
    expect(onDetailSynced).toHaveBeenCalledWith(user, 'act-1')
    expect(auditInfo).toHaveBeenCalledWith(
      user,
      'sync',
      '📊 Re-synced 7 detail metrics for Garmin activity 12345 from its FIT file',
    )
  })

  test('a key without a file and no session answers no_file and marks nothing', async () => {
    const garmin = garminWith({ key: true, session: false })
    garmin.getActivityFile.mockResolvedValue(null)
    const onDetailSynced = vi.fn()

    const result = await resyncActivityDetail(user, garmin as never, activity, { onDetailSynced })

    expect(result).toEqual({ status: 'no_file' })
    expect(db.markActivityDetailSynced).not.toHaveBeenCalled()
    expect(onDetailSynced).not.toHaveBeenCalled()
  })

  test('a failing key download falls back to the JSON detail with a session', async () => {
    const garmin = garminWith({ key: true, session: true })
    garmin.getActivityFile.mockRejectedValue(new Error('Garmin Personal API 403 for /download-service'))
    vi.mocked(processActivityDetail).mockResolvedValueOnce(5)

    const result = await resyncActivityDetail(user, garmin as never, activity)

    expect(result).toEqual({ points: 5, status: 'synced' })
    expect(garmin.getActivityDetail).toHaveBeenCalledWith(user, 12345)
    expect(db.markActivityDetailSynced).toHaveBeenCalledWith(user, 'act-1')
  })

  test('a session alone reads the JSON detail', async () => {
    const garmin = garminWith({ key: false, session: true })
    vi.mocked(processActivityDetail).mockResolvedValueOnce(3)
    const onDetailSynced = vi.fn()

    const result = await resyncActivityDetail(user, garmin as never, activity, { onDetailSynced })

    expect(result).toEqual({ points: 3, status: 'synced' })
    expect(garmin.getActivityFile).not.toHaveBeenCalled()
    expect(garmin.getActivityDetail).toHaveBeenCalledWith(user, 12345)
    expect(onDetailSynced).toHaveBeenCalledWith(user, 'act-1')
    expect(auditInfo).toHaveBeenCalledWith(
      user,
      'sync',
      '📊 Re-synced 3 detail metrics for Garmin activity 12345',
    )
  })

  test('a Garmin error answers failed and is audited, not thrown', async () => {
    const garmin = garminWith({ key: false, session: true })
    garmin.getActivityDetail.mockRejectedValue(new Error('Garmin 500'))

    const result = await resyncActivityDetail(user, garmin as never, activity)

    expect(result).toEqual({ status: 'failed' })
    expect(db.markActivityDetailSynced).not.toHaveBeenCalled()
    expect(auditError).toHaveBeenCalledWith(
      user,
      'sync',
      'Failed to re-sync detail for Garmin activity 12345',
      {
        error: 'Garmin 500',
      },
    )
  })
})
