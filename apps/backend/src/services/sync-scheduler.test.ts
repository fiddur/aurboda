import { describe, expect, it, vi } from 'vitest'

vi.mock('./audit-log.ts', () => ({ auditError: vi.fn() }))

import type { SyncProvider } from './queries/types.ts'

import { auditError } from './audit-log.ts'
import { runScheduledSyncs } from './sync-scheduler.ts'

const makeSync = (overrides: Partial<SyncProvider> = {}): SyncProvider => ({
  syncCalendarsIfNeeded: vi.fn().mockResolvedValue(undefined),
  syncGarminIfNeeded: vi.fn().mockResolvedValue(undefined),
  syncGravlIfNeeded: vi.fn().mockResolvedValue(undefined),
  syncLastFmIfNeeded: vi.fn().mockResolvedValue(undefined),
  syncOuraIfNeeded: vi.fn().mockResolvedValue(undefined),
  syncRescueTimeIfNeeded: vi.fn().mockResolvedValue(undefined),
  ...overrides,
})

describe('runScheduledSyncs', () => {
  it('asks every provider for every user, one Garmin call per data type', async () => {
    const sync = makeSync()
    const visited = await runScheduledSyncs({
      garminDataTypes: ['sleep', 'activities'],
      listUsers: async () => ['alice', 'bob'],
      sync,
    })

    expect(visited).toBe(2)
    expect(sync.syncOuraIfNeeded).toHaveBeenCalledWith('alice', 'tags')
    expect(sync.syncOuraIfNeeded).toHaveBeenCalledWith('alice', 'sessions')
    expect(sync.syncGarminIfNeeded).toHaveBeenCalledWith('bob', 'sleep')
    expect(sync.syncGarminIfNeeded).toHaveBeenCalledWith('bob', 'activities')
    expect(sync.syncGarminIfNeeded).toHaveBeenCalledTimes(4)
    expect(sync.syncGravlIfNeeded).toHaveBeenCalledTimes(2)
    expect(sync.syncRescueTimeIfNeeded).toHaveBeenCalledTimes(2)
    expect(sync.syncLastFmIfNeeded).toHaveBeenCalledTimes(2)
    expect(sync.syncCalendarsIfNeeded).toHaveBeenCalledTimes(2)
  })

  it('audits a user whose tick throws and carries on with the next user', async () => {
    const sync = makeSync({
      syncGravlIfNeeded: vi.fn(async (user: string) => {
        if (user === 'alice') throw new Error('boom')
      }),
    })
    const visited = await runScheduledSyncs({
      garminDataTypes: [],
      listUsers: async () => ['alice', 'bob'],
      sync,
    })

    expect(visited).toBe(2)
    expect(auditError).toHaveBeenCalledWith('alice', 'sync', expect.any(String), { error: 'Error: boom' })
    expect(sync.syncLastFmIfNeeded).toHaveBeenCalledWith('bob')
    expect(sync.syncLastFmIfNeeded).not.toHaveBeenCalledWith('alice')
  })

  it('is a no-op with no users', async () => {
    const sync = makeSync()
    expect(await runScheduledSyncs({ garminDataTypes: [], listUsers: async () => [], sync })).toBe(0)
    expect(sync.syncOuraIfNeeded).not.toHaveBeenCalled()
  })
})
