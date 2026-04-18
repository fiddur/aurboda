import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { StravaQueue } from '../../services/strava-queue.ts'

vi.mock('../../db/index.ts', () => ({
  getAllSyncStates: vi.fn(),
  getOAuthToken: vi.fn(),
  getSyncState: vi.fn(),
  upsertSyncState: vi.fn(),
}))

import { getOAuthToken, getSyncState, upsertSyncState } from '../../db/index.ts'
import { syncStrava } from './sync.ts'

const mockGetOAuthToken = vi.mocked(getOAuthToken)
const mockGetSyncState = vi.mocked(getSyncState)
const mockUpsertSyncState = vi.mocked(upsertSyncState)

const mockQueue: StravaQueue = {
  enqueueActivityFetch: vi.fn(),
  enqueueSync: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('syncStrava', () => {
  test('returns not_connected when no OAuth token exists', async () => {
    mockGetOAuthToken.mockResolvedValue(null)

    const result = await syncStrava('testuser', mockQueue, {})

    expect(result).toEqual({ status: 'not_connected' })
  })

  test('returns already_syncing when sync is active and recent', async () => {
    mockGetOAuthToken.mockResolvedValue({
      access_token: 'token',
      provider: 'strava',
      refresh_token: 'refresh',
    })
    mockGetSyncState.mockResolvedValue({
      data_type: 'activities',
      provider: 'strava',
      status: 'syncing',
      updated_at: new Date(), // just now
    })

    const result = await syncStrava('testuser', mockQueue, {})

    expect(result).toEqual({ status: 'already_syncing' })
    expect(mockQueue.enqueueSync).not.toHaveBeenCalled()
  })

  test('allows re-sync when syncing state is stale (>2 hours)', async () => {
    mockGetOAuthToken.mockResolvedValue({
      access_token: 'token',
      provider: 'strava',
      refresh_token: 'refresh',
    })
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000)
    mockGetSyncState.mockResolvedValue({
      data_type: 'activities',
      provider: 'strava',
      status: 'syncing',
      updated_at: threeHoursAgo,
    })

    const result = await syncStrava('testuser', mockQueue, { fullResync: true })

    expect(result).toEqual({ status: 'queued' })
    expect(mockUpsertSyncState).toHaveBeenCalled()
    expect(mockQueue.enqueueSync).toHaveBeenCalledWith('testuser', {
      after: undefined,
      fullResync: true,
    })
  })

  test('enqueues incremental sync with after timestamp', async () => {
    const lastSync = new Date('2026-04-10T00:00:00Z')
    mockGetOAuthToken.mockResolvedValue({
      access_token: 'token',
      provider: 'strava',
      refresh_token: 'refresh',
    })
    mockGetSyncState.mockResolvedValue({
      data_type: 'activities',
      last_sync_time: lastSync,
      provider: 'strava',
      status: 'idle',
    })

    const result = await syncStrava('testuser', mockQueue, {})

    expect(result).toEqual({ status: 'syncing' })
    expect(mockQueue.enqueueSync).toHaveBeenCalledWith('testuser', {
      after: Math.floor(lastSync.getTime() / 1000),
      fullResync: undefined,
    })
  })

  test('enqueues full resync without after timestamp', async () => {
    mockGetOAuthToken.mockResolvedValue({
      access_token: 'token',
      provider: 'strava',
      refresh_token: 'refresh',
    })
    mockGetSyncState.mockResolvedValue(null)

    const result = await syncStrava('testuser', mockQueue, { fullResync: true })

    expect(result).toEqual({ status: 'queued' })
    expect(mockQueue.enqueueSync).toHaveBeenCalledWith('testuser', {
      after: undefined,
      fullResync: true,
    })
  })
})
