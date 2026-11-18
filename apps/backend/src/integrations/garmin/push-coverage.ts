import { garminDataTypeSchema } from '@aurboda/api-spec'

import type { OAuthToken, SyncState } from '../../db/types.ts'
import type { GarminDataType } from './process.ts'

import { getAllSyncStates, getOAuthToken } from '../../db/index.ts'
import { GARMIN_OAUTH_PROVIDER, GARMIN_PUSH_PROVIDER, isGarminOAuthConnected } from './oauth-status.ts'
import { garminPushFeeds } from './push-adapters.ts'

/** Pushes older than this no longer vouch for the connection: the pull takes over again. */
export const GARMIN_PUSH_FRESH_MS = 24 * 60 * 60 * 1000

/**
 * The push types whose arrival vouches for their feeds. The detail, file and manual-edit
 * notices share the `activities` feed but do not carry the activity list itself.
 */
const DELIVERING_PUSH_TYPES = [
  'dailies',
  'sleeps',
  'hrv',
  'stressDetails',
  'pulseox',
  'allDayRespiration',
  'activities',
] as const

const permissionFor = (dataType: GarminDataType): string =>
  dataType === 'activities' ? 'ACTIVITY_EXPORT' : 'HEALTH_EXPORT'

const isFresh = (states: SyncState[], now: Date): boolean => {
  const times = states.flatMap((state) => (state.last_sync_time ? [state.last_sync_time.getTime()] : []))
  return times.length > 0 && now.getTime() - Math.max(...times) < GARMIN_PUSH_FRESH_MS
}

/**
 * The data types Connect with Garmin delivers for a user right now, so the automatic pull leaves
 * them alone. Unknown permissions (an empty list: Garmin's answer could not be read) gate nothing.
 */
export const garminPushDelivered = (
  token: OAuthToken | null,
  pushStates: SyncState[],
  now: Date,
): GarminDataType[] => {
  if (!isGarminOAuthConnected(token) || token.refused_at !== undefined) return []
  if (!isFresh(pushStates, now)) return []
  const scopes = token.scopes ?? []
  const permitted = (dataType: GarminDataType) =>
    scopes.length === 0 || scopes.includes(permissionFor(dataType))
  const delivering = new Set<string>(DELIVERING_PUSH_TYPES)
  const fed = new Set(
    pushStates
      .filter((state) => delivering.has(state.data_type) && state.status === 'idle' && state.last_sync_time)
      .flatMap((state) => garminPushFeeds(state.data_type)),
  )
  return garminDataTypeSchema.options.filter((dataType) => fed.has(dataType) && permitted(dataType))
}

export const getGarminPushDelivered = async (user: string, now = new Date()): Promise<GarminDataType[]> => {
  const [token, pushStates] = await Promise.all([
    getOAuthToken(user, GARMIN_OAUTH_PROVIDER),
    getAllSyncStates(user, GARMIN_PUSH_PROVIDER),
  ])
  return garminPushDelivered(token, pushStates, now)
}
