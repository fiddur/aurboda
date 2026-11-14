import type { SyncState } from '../db/types.ts'

const STALE_SYNCING_MS = 15 * 60_000

/**
 * A pull that a process restart cut short never writes its `idle` or `error`,
 * so a `syncing` row that has not been touched for longer than any pull takes
 * reads as `idle`. Strava's and Garmin's rows are not passed through it: their
 * syncs can run longer than that (see `getVisibleSyncStates`).
 */
export const withStaleSyncingAsIdle = (states: SyncState[], now: Date): SyncState[] =>
  states.map((s) =>
    s.status === 'syncing' &&
    s.updated_at !== undefined &&
    now.getTime() - s.updated_at.getTime() > STALE_SYNCING_MS
      ? { ...s, status: 'idle' }
      : s,
  )
