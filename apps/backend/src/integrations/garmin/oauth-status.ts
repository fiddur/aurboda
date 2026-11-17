/**
 * The Connect with Garmin row's meaning, kept apart from the client so the settings
 * service can read it without loading the Garmin clients.
 */

import type { GarminOAuthStatus } from '@aurboda/api-spec'

import type { OAuthToken, SyncState } from '../../db/types.ts'

export const GARMIN_OAUTH_PROVIDER = 'garmin_oauth'

/** The sync state provider the push endpoint writes, one row per summary type received. */
export const GARMIN_PUSH_PROVIDER = 'garmin_push'

export const isGarminOAuthConnected = (token: OAuthToken | null): token is OAuthToken =>
  token !== null && token.access_token !== ''

/** The newest `last_sync_time` of the user's `garmin_push` sync states, as ISO; null when none. */
export const garminPushLastReceivedAt = (states: SyncState[]): string | null => {
  const times = states.flatMap((state) => (state.last_sync_time ? [state.last_sync_time.getTime()] : []))
  return times.length > 0 ? new Date(Math.max(...times)).toISOString() : null
}

export const garminOAuthStatusFromToken = (
  token: OAuthToken | null,
): Omit<GarminOAuthStatus, 'available' | 'last_received_at'> => {
  if (!isGarminOAuthConnected(token)) return { connected: false, needs_reconnect: false, permissions: [] }
  return { connected: true, needs_reconnect: token.refused_at !== undefined, permissions: token.scopes ?? [] }
}
