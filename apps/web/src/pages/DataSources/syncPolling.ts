import type { ProviderSyncStatus } from '@aurboda/api-spec'

export const SYNC_POLL_INTERVAL_MS = 5000

/** `refetchInterval` for a sync-status query: poll only while a sync is running. */
export const refetchWhileSyncing = (data: { states?: ProviderSyncStatus[] } | undefined): number | false =>
  data?.states?.some((s) => s.status === 'syncing') ? SYNC_POLL_INTERVAL_MS : false
