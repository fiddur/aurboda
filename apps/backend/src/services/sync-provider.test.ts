import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as dbIndex from '../db/index.ts'

// Partial mock: keep the real exports (other sync integrations reference them
// at module load) and override only getSyncState.
vi.mock('../db/index.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof dbIndex>()),
  getSyncState: vi.fn(),
}))

vi.mock('./settings.ts', () => ({
  getSettings: vi.fn(),
}))

vi.mock('./audit-log.ts', () => ({
  auditError: vi.fn(),
  auditInfo: vi.fn(),
  auditWarn: vi.fn(),
}))

vi.mock('../integrations/lastfm/sync.ts', () => ({
  DEFAULT_SYNC_HISTORY_DAYS: 30,
  syncLastFmData: vi.fn(),
}))

import { syncLastFmData } from '../integrations/lastfm/sync.ts'
import { getSettings } from './settings.ts'
import { createSyncProvider } from './sync-provider.ts'

describe('createSyncProvider › syncLastFmIfNeeded', () => {
  const lastSync = new Date('2026-06-01T00:00:00Z')

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getSettings).mockResolvedValue({ lastfm_username: 'bob' } as never)
    vi.mocked(dbIndex.getSyncState).mockResolvedValue({ last_sync_time: lastSync } as never)
  })

  const build = (onActivitySynced = vi.fn()) => ({
    onActivitySynced,
    provider: createSyncProvider({ getLastFmApiKey: async () => 'api-key', onActivitySynced }),
  })

  test('triggers deduction over the synced window when new scrobbles arrived', async () => {
    vi.mocked(syncLastFmData).mockResolvedValue({ scrobbles_processed: 3, status: 'success' })
    const { onActivitySynced, provider } = build()

    await provider.syncLastFmIfNeeded('alice')

    expect(syncLastFmData).toHaveBeenCalledWith('alice', 'api-key', 'bob')
    expect(onActivitySynced).toHaveBeenCalledTimes(1)
    const [user, activityType, start, end] = onActivitySynced.mock.calls[0]
    expect(user).toBe('alice')
    expect(activityType).toBe('*') // evaluate all rules
    expect(start).toEqual(lastSync) // window starts at last_sync_time
    expect((end as Date).getTime()).toBeGreaterThan((start as Date).getTime())
  })

  test('does not trigger deduction when no new scrobbles were processed', async () => {
    vi.mocked(syncLastFmData).mockResolvedValue({ scrobbles_processed: 0, status: 'success' })
    const { onActivitySynced, provider } = build()

    await provider.syncLastFmIfNeeded('alice')

    expect(onActivitySynced).not.toHaveBeenCalled()
  })

  test('does not trigger deduction when the sync failed', async () => {
    vi.mocked(syncLastFmData).mockResolvedValue({
      error: 'boom',
      scrobbles_processed: 0,
      status: 'error',
    })
    const { onActivitySynced, provider } = build()

    await provider.syncLastFmIfNeeded('alice')

    expect(onActivitySynced).not.toHaveBeenCalled()
  })

  test('skips syncing entirely when synced within the threshold', async () => {
    vi.mocked(dbIndex.getSyncState).mockResolvedValue({ last_sync_time: new Date() } as never)
    vi.mocked(syncLastFmData).mockResolvedValue({ scrobbles_processed: 5, status: 'success' })
    const { onActivitySynced, provider } = build()

    await provider.syncLastFmIfNeeded('alice')

    expect(syncLastFmData).not.toHaveBeenCalled()
    expect(onActivitySynced).not.toHaveBeenCalled()
  })
})
