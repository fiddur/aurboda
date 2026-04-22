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
  getQueue: vi.fn(),
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

  test('creates main queue + dead-letter queue and registers both workers', async () => {
    const boss = createMockBoss()
    const queue = await createStravaQueue(boss as never, mockDeps)

    expect(queue).not.toBeNull()
    expect(queue.enqueueSync).toBeDefined()
    expect(queue.enqueueActivityFetch).toBeDefined()
    expect(boss.createQueue).toHaveBeenCalledWith('strava-sync')
    expect(boss.createQueue).toHaveBeenCalledWith('strava-sync-dead-letter')
    expect(boss.work).toHaveBeenCalledWith(
      'strava-sync',
      { batchSize: 1, pollingIntervalSeconds: 2 },
      expect.any(Function),
    )
    expect(boss.work).toHaveBeenCalledWith(
      'strava-sync-dead-letter',
      { batchSize: 1, pollingIntervalSeconds: 5 },
      expect.any(Function),
    )
  })

  test('enqueueSync sends incremental sync job with list retry limit and deadLetter', async () => {
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
      expect.objectContaining({
        deadLetter: 'strava-sync-dead-letter',
        priority: 5,
        retryLimit: 10,
      }),
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
      expect.objectContaining({
        deadLetter: 'strava-sync-dead-letter',
        priority: 10,
        retryLimit: 10,
      }),
    )
  })

  test('enqueueActivityFetch sends fetch job with fetch retry limit and deadLetter', async () => {
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
      expect.objectContaining({
        deadLetter: 'strava-sync-dead-letter',
        priority: 1,
        retryLimit: 3,
      }),
    )
  })

  test('getStatus returns queue counts from pg-boss', async () => {
    const boss = createMockBoss()
    boss.getQueue.mockResolvedValue({
      activeCount: 1,
      queuedCount: 42,
    })
    const queue = await createStravaQueue(boss as never, mockDeps)

    const status = await queue.getStatus()

    expect(boss.getQueue).toHaveBeenCalledWith('strava-sync')
    expect(status).toEqual({ active_count: 1, queued_count: 42 })
  })

  test('getStatus returns zero counts when queue not found', async () => {
    const boss = createMockBoss()
    boss.getQueue.mockResolvedValue(null)
    const queue = await createStravaQueue(boss as never, mockDeps)

    const status = await queue.getStatus()

    expect(status).toEqual({ active_count: 0, queued_count: 0 })
  })

  describe('dead-letter handler', () => {
    // Extract the dead-letter handler by finding the boss.work() call for the DLQ
    const getDeadLetterHandler = (boss: ReturnType<typeof createMockBoss>) => {
      const dlqCall = boss.work.mock.calls.find((args) => args[0] === 'strava-sync-dead-letter')
      if (!dlqCall) throw new Error('dead-letter worker not registered')
      return dlqCall[2] as (jobs: { data: unknown }[]) => Promise<void>
    }

    test('sets sync_state to error when a list_activities job dies', async () => {
      const boss = createMockBoss()
      const updateSyncState = vi.fn().mockResolvedValue(undefined)
      await createStravaQueue(boss as never, { ...mockDeps, updateSyncState })

      const handler = getDeadLetterHandler(boss)
      await handler([
        {
          data: {
            list_params: undefined,
            request_type: 'list_activities',
            user: 'testuser',
          },
        },
      ])

      expect(updateSyncState).toHaveBeenCalledWith(
        'testuser',
        'activities',
        expect.objectContaining({
          error_message: expect.stringContaining('Pagination stopped'),
          status: 'error',
        }),
      )
    })

    test('error message includes list_params for debugging', async () => {
      const boss = createMockBoss()
      const updateSyncState = vi.fn().mockResolvedValue(undefined)
      await createStravaQueue(boss as never, { ...mockDeps, updateSyncState })

      const handler = getDeadLetterHandler(boss)
      await handler([
        {
          data: {
            list_params: { before: 1700000000 },
            request_type: 'list_activities',
            user: 'testuser',
          },
        },
      ])

      const updates = updateSyncState.mock.calls[0][2] as { error_message: string }
      expect(updates.error_message).toContain('before')
      expect(updates.error_message).toContain('1700000000')
    })

    test('swallows updateSyncState failures to avoid DLQ retry loop', async () => {
      const boss = createMockBoss()
      const updateSyncState = vi.fn().mockRejectedValue(new Error('DB down'))
      await createStravaQueue(boss as never, { ...mockDeps, updateSyncState })

      const handler = getDeadLetterHandler(boss)
      await expect(
        handler([
          {
            data: { list_params: undefined, request_type: 'list_activities', user: 'testuser' },
          },
        ]),
      ).resolves.toBeUndefined()
    })

    test('does not touch sync_state when a fetch_activity job dies', async () => {
      const boss = createMockBoss()
      const updateSyncState = vi.fn().mockResolvedValue(undefined)
      await createStravaQueue(boss as never, { ...mockDeps, updateSyncState })

      const handler = getDeadLetterHandler(boss)
      await handler([
        {
          data: {
            request_type: 'fetch_activity',
            strava_activity_id: 42,
            user: 'testuser',
          },
        },
      ])

      expect(updateSyncState).not.toHaveBeenCalled()
    })

    test('handles multiple dead-letter jobs in one batch', async () => {
      const boss = createMockBoss()
      const updateSyncState = vi.fn().mockResolvedValue(undefined)
      await createStravaQueue(boss as never, { ...mockDeps, updateSyncState })

      const handler = getDeadLetterHandler(boss)
      await handler([
        {
          data: { request_type: 'list_activities', user: 'alice' },
        },
        {
          data: { request_type: 'fetch_activity', strava_activity_id: 1, user: 'alice' },
        },
        {
          data: { request_type: 'list_activities', user: 'bob' },
        },
      ])

      // Only the two list_activities failures should trigger sync_state updates
      expect(updateSyncState).toHaveBeenCalledTimes(2)
      expect(updateSyncState).toHaveBeenCalledWith('alice', 'activities', expect.any(Object))
      expect(updateSyncState).toHaveBeenCalledWith('bob', 'activities', expect.any(Object))
    })
  })
})
