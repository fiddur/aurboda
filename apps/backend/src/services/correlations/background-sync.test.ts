import { describe, expect, it, vi } from 'vitest'

import type { SyncProvider } from '../queries/index.ts'

import { triggerCorrelationSyncs } from './background-sync.ts'

/** A full SyncProvider whose methods record their call and never resolve, to
 *  prove the helper does not await them. Built as a complete literal (rather
 *  than a cast partial) to honour the repo's "avoid casting" guideline. */
const makeHangingSync = (): { sync: SyncProvider; calls: string[] } => {
  const calls: string[] = []
  const never = () => new Promise<void>(() => {})
  const sync: SyncProvider = {
    syncOuraIfNeeded: vi.fn((_user: string, dataType: 'tags' | 'sessions') => {
      calls.push(`oura:${dataType}`)
      return never()
    }),
    syncGarminIfNeeded: vi.fn(() => never()),
    syncRescueTimeIfNeeded: vi.fn(() => {
      calls.push('rescuetime')
      return never()
    }),
    syncCalendarsIfNeeded: vi.fn(() => {
      calls.push('calendars')
      return never()
    }),
    syncLastFmIfNeeded: vi.fn(() => never()),
  }
  return { sync, calls }
}

describe('triggerCorrelationSyncs', () => {
  it('returns synchronously without awaiting slow syncs', () => {
    const { sync, calls } = makeHangingSync()
    // If the helper awaited, this would hang the test; it must return at once.
    triggerCorrelationSyncs(sync, 'user-1')
    expect(calls).toEqual(['oura:tags', 'oura:sessions', 'rescuetime', 'calendars'])
  })

  it('is a no-op when no sync provider is given', () => {
    expect(() => triggerCorrelationSyncs(undefined, 'user-1')).not.toThrow()
  })

  it('does not surface a rejected sync as an unhandled rejection', async () => {
    const resolve = () => Promise.resolve()
    const sync: SyncProvider = {
      syncOuraIfNeeded: vi.fn(() => Promise.reject(new Error('boom'))),
      syncGarminIfNeeded: vi.fn(resolve),
      syncRescueTimeIfNeeded: vi.fn(resolve),
      syncCalendarsIfNeeded: vi.fn(resolve),
      syncLastFmIfNeeded: vi.fn(resolve),
    }
    triggerCorrelationSyncs(sync, 'user-1')
    // allSettled must absorb the rejection: awaiting the same set here must not
    // throw, which would fail the test if the helper let it escape.
    await expect(
      Promise.allSettled([sync.syncOuraIfNeeded('user-1', 'tags'), sync.syncRescueTimeIfNeeded('user-1')]),
    ).resolves.toHaveLength(2)
  })
})
