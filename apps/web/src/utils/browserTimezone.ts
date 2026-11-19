import type { UserSettingsResponse } from '@aurboda/api-spec'

const resolvedTimezone = (): string | undefined => Intl.DateTimeFormat().resolvedOptions().timeZone

export const browserTimezone = (resolve: () => string | undefined = resolvedTimezone): string | null => {
  try {
    return resolve() || null
  } catch {
    return null
  }
}

/** The zone to store: the browser's, only once the settings have loaded (`undefined` is not yet) with none stored. */
export const timezoneToAdopt = (
  storedTz: string | null | undefined,
  browserTz: string | null,
): string | null => (storedTz === null && browserTz ? browserTz : null)

interface AdoptArgs {
  user: string
  storedTz: string | null | undefined
  browserTz: string | null
  save: (tz: string) => Promise<UserSettingsResponse>
  onSaved: (settings: UserSettingsResponse) => void
}

/** Saves the browser's zone for a user without one, at most once per user for the adopter's lifetime, even when it fails. */
export const createTimezoneAdopter = () => {
  const tried = new Set<string>()
  return async ({ user, storedTz, browserTz, save, onSaved }: AdoptArgs): Promise<void> => {
    const tz = timezoneToAdopt(storedTz, browserTz)
    if (!tz || tried.has(user)) return
    tried.add(user)
    try {
      onSaved(await save(tz))
    } catch {
      // A failure is not retried during this page load; the next load tries again.
    }
  }
}
