import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('./audit-log', () => ({
  auditError: vi.fn(),
  auditInfo: vi.fn(),
  auditWarn: vi.fn(),
}))

vi.mock('../integrations/strava/process', () => ({
  processStravaActivity: vi.fn().mockResolvedValue(42),
}))

import { createStravaQueue } from './strava-queue.ts'

const createMockBoss = () => ({
  createQueue: vi.fn().mockResolvedValue(undefined),
  send: vi.fn().mockResolvedValue('job-123'),
  work: vi.fn().mockResolvedValue(undefined),
})

describe('createStravaQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const mockDeps = {
    getAccessToken: vi.fn().mockResolvedValue('test-token'),
    getActivity: vi.fn(),
    getActivityStreams: vi.fn(),
    listActivities: vi.fn(),
    processDeps: {
      insertActivity: vi.fn(),
      insertLocations: vi.fn(),
      insertRawRecord: vi.fn(),
      insertTimeSeries: vi.fn(),
      resolveOrCreateActivityType: vi.fn(async (_user: string, name: string) => name),
      softDeleteLocationRange: vi.fn(),
    },
    updateSyncState: vi.fn(),
  }

  test('creates queue and registers worker', async () => {
    const boss = createMockBoss()
    const queue = await createStravaQueue(boss as never, mockDeps)

    expect(queue).not.toBeNull()
    expect(queue.enqueueSync).toBeDefined()
    expect(queue.enqueueActivityFetch).toBeDefined()
    expect(boss.createQueue).toHaveBeenCalledWith('strava-sync')
    expect(boss.work).toHaveBeenCalledWith(
      'strava-sync',
      { batchSize: 1, pollingIntervalSeconds: 2 },
      expect.any(Function),
    )
  })

  test('enqueueSync sends incremental sync job', async () => {
    const boss = createMockBoss()
    const queue = await createStravaQueue(boss as never, mockDeps)

    await queue.enqueueSync('testuser', { after: 1718400000 })

    expect(boss.send).toHaveBeenCalledWith(
      'strava-sync',
      {
        list_params: { after: 1718400000 },
        request_type: 'list_activities',
        user: 'testuser',
      },
      expect.objectContaining({ priority: 5, retryLimit: 3 }),
    )
  })

  test('enqueueSync sends full resync with backfill priority', async () => {
    const boss = createMockBoss()
    const queue = await createStravaQueue(boss as never, mockDeps)

    await queue.enqueueSync('testuser', { fullResync: true })

    expect(boss.send).toHaveBeenCalledWith(
      'strava-sync',
      {
        list_params: undefined,
        request_type: 'list_activities',
        user: 'testuser',
      },
      expect.objectContaining({ priority: 10 }),
    )
  })

  test('enqueueActivityFetch sends fetch job with given priority', async () => {
    const boss = createMockBoss()
    const queue = await createStravaQueue(boss as never, mockDeps)

    await queue.enqueueActivityFetch('testuser', 999, 1)

    expect(boss.send).toHaveBeenCalledWith(
      'strava-sync',
      {
        request_type: 'fetch_activity',
        strava_activity_id: 999,
        user: 'testuser',
      },
      expect.objectContaining({ priority: 1 }),
    )
  })
})
