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
  return provider === 'strava' ? states : withStaleSyncingAsIdle(states, deps.now())
}
