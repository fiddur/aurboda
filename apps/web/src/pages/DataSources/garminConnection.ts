import type { GarminOAuthStatus, GarminPersonalKeyStatus } from '@aurboda/api-spec'

import { formatDistance } from 'date-fns'

export const KEY_EXPIRY_CHOICES = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 180, label: '180 days' },
  { days: 365, label: '1 year' },
] as const

export const KEY_EXPIRY_WARNING_DAYS = 14

const DAY_MS = 86_400_000

/** A local calendar date as YYYY-MM-DD. */
export const localIsoDate = (date: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const dateOnlyUtcMs = (iso: string): number => Date.parse(`${iso}T00:00:00Z`)

export const addDaysToIsoDate = (iso: string, days: number): string =>
  new Date(dateOnlyUtcMs(iso) + days * DAY_MS).toISOString().slice(0, 10)

export const daysUntil = (iso: string, today: string): number =>
  Math.round((dateOnlyUtcMs(iso) - dateOnlyUtcMs(today)) / DAY_MS)

export type KeyExpiryState = 'ok' | 'warning' | 'error'

export const keyExpiryState = (
  { expires_at, refused }: { expires_at: string | null; refused: boolean },
  today: string,
): KeyExpiryState => {
  if (refused) return 'error'
  if (!expires_at) return 'ok'
  const left = daysUntil(expires_at, today)
  if (left < 0) return 'error'
  return left <= KEY_EXPIRY_WARNING_DAYS ? 'warning' : 'ok'
}

/** The API answers a string, or field errors from validation. */
export const connectErrorText = (error: unknown): string =>
  typeof error === 'string' && error ? error : 'Check the key and the expiry date'

export interface GarminConnectionFlags {
  isConnected: boolean
  sessionConnected: boolean
  personalKey: GarminPersonalKeyStatus | undefined
  /** A key and no login: the types and details only the login serves are missing. */
  keyOnly: boolean
  oauth: GarminOAuthStatus
  /** A login or a key: the connections the pull sync runs on. Connect with Garmin only receives pushes. */
  canPull: boolean
}

const NO_OAUTH: GarminOAuthStatus = {
  available: false,
  connected: false,
  last_received_at: null,
  needs_reconnect: false,
  permissions: [],
}

export const garminConnectionFlags = (
  settings:
    | {
        garmin_connected?: boolean
        garmin_session_connected?: boolean
        garmin_personal_key?: GarminPersonalKeyStatus
        garmin_oauth?: GarminOAuthStatus
      }
    | undefined,
): GarminConnectionFlags => {
  const sessionConnected = settings?.garmin_session_connected ?? false
  const personalKey = settings?.garmin_personal_key
  return {
    canPull: sessionConnected || (personalKey?.connected ?? false),
    isConnected: settings?.garmin_connected ?? false,
    keyOnly: !sessionConnected && (personalKey?.connected ?? false),
    oauth: settings?.garmin_oauth ?? NO_OAUTH,
    personalKey,
    sessionConnected,
  }
}

const OAUTH_ERROR_TEXT: Record<string, string> = {
  auth_failed: 'Garmin did not complete the connection. Try again.',
  invalid_state: 'The connection attempt expired. Try again.',
  not_configured: 'This server has not set up Garmin sign-in.',
}

/** The text for the `?error=` code the Connect with Garmin callback redirects with. */
export const oauthErrorText = (code: string | null): string | null =>
  code === null ? null : (OAUTH_ERROR_TEXT[code] ?? OAUTH_ERROR_TEXT.auth_failed)

const OAUTH_RETURN_PARAMS = ['garmin_code', 'garmin_state'] as const

/** The code and state Garmin's callback hands to the page, for the signed-in user to finish with. */
export const garminOAuthReturn = (search: string): { code: string; state: string } | null => {
  const params = new URLSearchParams(search)
  const code = params.get('garmin_code')
  const state = params.get('garmin_state')
  return code && state ? { code, state } : null
}

export const withoutGarminOAuthReturn = (search: string): string => {
  const params = new URLSearchParams(search)
  for (const name of OAUTH_RETURN_PARAMS) params.delete(name)
  const rest = params.toString()
  return rest ? `?${rest}` : ''
}

const PERMISSION_LABELS: Record<string, string> = {
  ACTIVITY_EXPORT: 'Activities',
  COURSE_IMPORT: 'Sending courses',
  HEALTH_EXPORT: 'Health data',
  MCT_EXPORT: 'Cycle tracking',
  WORKOUT_IMPORT: 'Sending workouts',
}

export const garminPermissionLabel = (permission: string): string =>
  PERMISSION_LABELS[permission] ?? permission

/** The line under a Connect with Garmin connection: when Garmin last pushed, or that nothing has come yet. */
export const garminLastReceivedText = (lastReceivedAt: string | null, now: Date = new Date()): string =>
  lastReceivedAt === null
    ? 'No data received yet. Garmin sends data the next time your watch syncs.'
    : `Last data received ${formatDistance(new Date(lastReceivedAt), now, { addSuffix: true })}`
