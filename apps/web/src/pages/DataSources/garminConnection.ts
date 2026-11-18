import type { GarminDataType, GarminOAuthStatus, GarminPersonalKeyStatus } from '@aurboda/api-spec'

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

/** The note a data type shows for a connection that misses some of it: a key alone, or Connect with Garmin alone. */
export const garminDataTypeNote = (
  { key_note, push_note }: { key_note?: string; push_note?: string },
  { keyOnly, pushOnly }: { keyOnly: boolean; pushOnly: boolean },
): string | undefined => (keyOnly ? key_note : pushOnly ? push_note : undefined)

/** The line under a data type saying which connection brings it, once Connect with Garmin delivers something. */
export const garminDataTypeSourceNote = (
  type: GarminDataType,
  {
    delivers,
    keyConnected,
    sessionConnected,
  }: { delivers: readonly GarminDataType[]; sessionConnected: boolean; keyConnected: boolean },
): string | undefined => {
  if (delivers.length === 0) return undefined
  if (delivers.includes(type)) return 'Delivered by Connect with Garmin'
  if (sessionConnected) return 'Fetched through the Garmin login'
  return keyConnected ? 'Fetched with the Personal API key' : undefined
}

const NO_OAUTH: GarminOAuthStatus = {
  available: false,
  connected: false,
  delivers: [],
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

export type GarminSwitchStep = 'connect' | 'wait' | 'ready'

/** Where a user with the login stands on the way to Connect with Garmin; null when there is nothing to switch. */
export const garminSwitchStep = ({
  oauth,
  sessionConnected,
}: Pick<GarminConnectionFlags, 'oauth' | 'sessionConnected'>): GarminSwitchStep | null => {
  if (!sessionConnected || (!oauth.available && !oauth.connected)) return null
  if (!oauth.connected || oauth.needs_reconnect) return 'connect'
  return oauth.last_received_at === null ? 'wait' : 'ready'
}

/** What stops arriving when the login is disconnected, given the other connections; null when the login is the only one. */
export const garminLoginOnlyData = ({
  keyConnected,
  oauthConnected,
}: {
  oauthConnected: boolean
  keyConnected: boolean
}): string[] | null => {
  if (oauthConnected && keyConnected) return ['training readiness', 'strength sets']
  if (oauthConnected) {
    return ['training readiness', 'strength sets', 'data from before you connected', 'syncing on demand']
  }
  if (keyConnected) return ['stress', 'the sleep stage timeline', 'training readiness', 'strength sets']
  return null
}

export const joinList = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`

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
