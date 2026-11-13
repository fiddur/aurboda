import type { GarminPersonalKeyStatus } from '@aurboda/api-spec'

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
}

export const garminConnectionFlags = (
  settings:
    | {
        garmin_connected?: boolean
        garmin_session_connected?: boolean
        garmin_personal_key?: GarminPersonalKeyStatus
      }
    | undefined,
): GarminConnectionFlags => {
  const sessionConnected = settings?.garmin_session_connected ?? false
  const personalKey = settings?.garmin_personal_key
  return {
    isConnected: settings?.garmin_connected ?? false,
    keyOnly: !sessionConnected && (personalKey?.connected ?? false),
    personalKey,
    sessionConnected,
  }
}
