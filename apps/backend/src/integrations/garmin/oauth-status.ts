/**
 * The Connect with Garmin row's meaning, kept apart from the client so the settings
 * service can read it without loading the Garmin clients.
 */

import type { GarminOAuthStatus } from '@aurboda/api-spec'

import type { OAuthToken } from '../../db/types.ts'

export const GARMIN_OAUTH_PROVIDER = 'garmin_oauth'

export const isGarminOAuthConnected = (token: OAuthToken | null): token is OAuthToken =>
  token !== null && token.access_token !== ''

export const garminOAuthStatusFromToken = (
  token: OAuthToken | null,
): Omit<GarminOAuthStatus, 'available'> => {
  if (!isGarminOAuthConnected(token)) return { connected: false, needs_reconnect: false, permissions: [] }
  return { connected: true, needs_reconnect: token.refused_at !== undefined, permissions: token.scopes ?? [] }
}
