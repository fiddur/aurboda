import { getAllSyncStates, type SyncState } from '../db/index.ts'
import { hasGarminSession } from '../integrations/garmin/sync.ts'
import { hasOuraToken } from '../integrations/oura/sync.ts'

export interface SyncStateDeps {
  getAllSyncStates: (user: string, provider: string) => Promise<SyncState[]>
  hasGarminSession: (user: string) => Promise<boolean>
  hasOuraToken: (user: string) => Promise<boolean>
}

const defaultDeps: SyncStateDeps = { getAllSyncStates, hasGarminSession, hasOuraToken }

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
  if (provider === 'garmin' && !(await deps.hasGarminSession(user))) return []
  if (provider === 'oura' && !(await deps.hasOuraToken(user))) return []
  return deps.getAllSyncStates(user, provider)
}
