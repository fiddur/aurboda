import { getAllSyncStates, type SyncState } from '../db/index.ts'
import { hasGarminConnection } from '../integrations/garmin/sync.ts'
import { hasOuraToken } from '../integrations/oura/sync.ts'
import { withStaleSyncingAsIdle } from './stale-syncing.ts'

export interface SyncStateDeps {
  getAllSyncStates: (user: string, provider: string) => Promise<SyncState[]>
  hasGarminConnection: (user: string) => Promise<boolean>
  hasOuraToken: (user: string) => Promise<boolean>
  now: () => Date
}

const defaultDeps: SyncStateDeps = {
  getAllSyncStates,
  hasGarminConnection,
  hasOuraToken,
  now: () => new Date(),
}

/**
 * Syncs that can run for longer than the stale-syncing threshold: Strava's queued backfill, and a
 * Garmin full resync, whose `syncing` row is also the guard against starting a second one.
 */
const LONG_RUNNING_PROVIDERS = new Set(['garmin', 'strava'])

/**
 * None while the user is not connected to the provider: older releases synced
 * Garmin and Oura for unconnected users and left failed rows that would otherwise
 * read as a broken sync.
 */
export const getVisibleSyncStates = async (
  user: string,
  provider: string,
  deps: SyncStateDeps = defaultDeps,
): Promise<SyncState[]> => {
  if (provider === 'garmin' && !(await deps.hasGarminConnection(user))) return []
  if (provider === 'oura' && !(await deps.hasOuraToken(user))) return []
  const states = await deps.getAllSyncStates(user, provider)
  return LONG_RUNNING_PROVIDERS.has(provider) ? states : withStaleSyncingAsIdle(states, deps.now())
}
