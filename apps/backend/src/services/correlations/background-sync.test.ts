import { describe, expect, it, vi } from 'vitest'

import type { SyncProvider } from '../queries/index.ts'

import { triggerCorrelationSyncs } from './background-sync.ts'

/** A SyncProvider whose methods record calls and never resolve, to prove the
 *  helper does not await them. */
const makeHangingSync = (): { sync: SyncProvider; calls: string[] } => {
  const calls: string[] = []
  const never = () => new Promise<void>(() => {})
  const sync = {
    syncOuraIfNeeded: vi.fn((_u: string, t: string) => {
      calls.push(`oura:${t}`)
      return never()
    }),
    syncRescueTimeIfNeeded: vi.fn(() => {
      calls.push('rescuetime')
      return never()
    }),
    syncCalendarsIfNeeded: vi.fn(() => {
      calls.push('calendars')
      return never()
    }),
  } as unknown as SyncProvider
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
    const sync = {
      syncOuraIfNeeded: vi.fn(() => Promise.reject(new Error('boom'))),
      syncRescueTimeIfNeeded: vi.fn(() => Promise.resolve()),
      syncCalendarsIfNeeded: vi.fn(() => Promise.resolve()),
    } as unknown as SyncProvider
    triggerCorrelationSyncs(sync, 'user-1')
    // Let the microtask queue drain; allSettled must absorb the rejection.
    await Promise.resolve()
    await Promise.resolve()
  })
})
