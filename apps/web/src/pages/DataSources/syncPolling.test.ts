import type { ProviderSyncStatus } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import { refetchWhileSyncing, SYNC_POLL_INTERVAL_MS } from './syncPolling'

const state = (status: ProviderSyncStatus['status']): ProviderSyncStatus => ({ status }) as ProviderSyncStatus

describe('refetchWhileSyncing', () => {
  it('does not poll before the first response', () => {
    expect(refetchWhileSyncing(undefined)).toBe(false)
  })

  it('does not poll when no state is syncing', () => {
    expect(refetchWhileSyncing({ states: [state('idle'), state('error')] })).toBe(false)
    expect(refetchWhileSyncing({ states: [] })).toBe(false)
    expect(refetchWhileSyncing({})).toBe(false)
  })

  it('polls while any state is syncing', () => {
    expect(refetchWhileSyncing({ states: [state('idle'), state('syncing')] })).toBe(SYNC_POLL_INTERVAL_MS)
  })
})
