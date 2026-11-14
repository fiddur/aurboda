import type { OAuthToken } from '../../db/types.ts'
import type { Notifier, RaiseNotificationInput } from '../../services/notifications.ts'

import { getOAuthToken } from '../../db/index.ts'
import { GARMIN_PERSONAL_PROVIDER } from './source.ts'

export const GARMIN_KEY_FIRST_REMINDER_DAYS = 14
export const GARMIN_KEY_LAST_REMINDER_DAYS = 3

const DAY_MS = 24 * 60 * 60 * 1000
const LINK = '/data-sources/garmin'
const TYPE = 'garmin_key_expiring'

export interface GarminKeyState {
  expires_at: Date | null
  refused_at: Date | null
}

type Reason = 'expiring' | 'expired' | 'refused'

const utcDay = (date: Date): number => Math.floor(date.getTime() / DAY_MS)

const isoDate = (date: Date): string => date.toISOString().slice(0, 10)

const expiresIn = (days: number): string => {
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}

const notification = (
  reason: Reason,
  title: string,
  body: string,
  dedupeKey: string,
  expiresAt: string | null,
  daysLeft: number | null,
): RaiseNotificationInput => ({
  body,
  data: { days_left: daysLeft, expires_at: expiresAt, reason },
  dedupe_key: `${TYPE}:${dedupeKey}`,
  link: LINK,
  title,
  type: TYPE,
})

/** The reminder a stored Garmin Personal API key is due, or null. The dedupe key keeps each one to a single raise. */
export const garminKeyReminder = (key: GarminKeyState | null, now: Date): RaiseNotificationInput | null => {
  if (!key) return null
  const expiresAt = key.expires_at ? isoDate(key.expires_at) : null
  const daysLeft = key.expires_at ? utcDay(key.expires_at) - utcDay(now) : null

  if (expiresAt !== null && daysLeft !== null && daysLeft < 0) {
    return notification(
      'expired',
      'Your Garmin key has expired',
      'The data it served has stopped syncing. Create a new Personal API key in Garmin Connect and paste it here.',
      `expired:${expiresAt}`,
      expiresAt,
      daysLeft,
    )
  }
  if (key.refused_at) {
    return notification(
      'refused',
      'Garmin refused your Personal API key',
      'It was probably deleted or replaced in Garmin Connect. Create a new key and paste it here.',
      `refused:${key.refused_at.toISOString()}`,
      expiresAt,
      daysLeft,
    )
  }
  if (expiresAt === null || daysLeft === null || daysLeft > GARMIN_KEY_FIRST_REMINDER_DAYS) return null

  const threshold =
    daysLeft <= GARMIN_KEY_LAST_REMINDER_DAYS ? GARMIN_KEY_LAST_REMINDER_DAYS : GARMIN_KEY_FIRST_REMINDER_DAYS
  return notification(
    'expiring',
    `Your Garmin key expires ${expiresIn(daysLeft)}`,
    `Create a new Personal API key in Garmin Connect and paste it here before ${expiresAt}.`,
    `${threshold}d:${expiresAt}`,
    expiresAt,
    daysLeft,
  )
}

export interface GarminKeyReminderDeps {
  getOAuthToken: (user: string, provider: string) => Promise<OAuthToken | null>
  raiseBestEffort: Notifier['raiseBestEffort']
  now?: () => Date
  logError?: (message: string, error: unknown) => void
}

/** Best-effort: never throws. */
export const remindGarminKey =
  (deps: GarminKeyReminderDeps) =>
  async (user: string): Promise<void> => {
    let stored: OAuthToken | null
    try {
      stored = await deps.getOAuthToken(user, GARMIN_PERSONAL_PROVIDER)
    } catch (error) {
      const logError = deps.logError ?? ((message, e) => console.error(message, e))
      logError(`⚠️ Could not read the Garmin Personal API key state for ${user}:`, error)
      return
    }
    const key = stored?.refresh_token
      ? { expires_at: stored.expires_at ?? null, refused_at: stored.refused_at ?? null }
      : null
    const reminder = garminKeyReminder(key, (deps.now ?? (() => new Date()))())
    if (reminder) await deps.raiseBestEffort(user, reminder)
  }

/** Reads db/index at call time, as source.ts does, so modules that mock it without getOAuthToken still load. */
export const defaultGarminKeyReminderDeps = (
  raiseBestEffort: Notifier['raiseBestEffort'],
): GarminKeyReminderDeps => ({
  getOAuthToken: (user, provider) => getOAuthToken(user, provider),
  raiseBestEffort,
})
