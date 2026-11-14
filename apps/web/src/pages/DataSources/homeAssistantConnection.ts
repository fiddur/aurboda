import type { HomeAssistantSyncResult, UpdateSettingsInput } from '@aurboda/api-spec'

export interface StoredConnection {
  url: string | null
  tokenSet: boolean
}

export interface ConnectionForm {
  url: string
  token: string
}

export type ConnectionUpdate = { update: UpdateSettingsInput } | { error: string }

const originOf = (raw: string | null): string | null => {
  if (!raw) return null
  try {
    return new URL(raw).origin
  } catch {
    return null
  }
}

/** Both parse as URLs with the same origin: a change of path or trailing slash keeps the stored token. */
export const sameOrigin = (a: string | null, b: string | null): boolean => {
  const origin = originOf(a)
  return origin !== null && origin === originOf(b)
}

/**
 * Whether saving the form would make the server drop the stored token: the URL moves to another
 * origin and no new token comes with it (mirrors `shouldClearHomeAssistantToken` in the backend).
 */
export const tokenWillBeRemoved = (stored: StoredConnection, form: ConnectionForm): boolean => {
  const url = form.url.trim()
  return stored.tokenSet && form.token.trim() === '' && originOf(url) !== null && !sameOrigin(stored.url, url)
}

/** The one settings PATCH the Save button sends: only what changed, URL and token together. */
export const connectionUpdate = (stored: StoredConnection, form: ConnectionForm): ConnectionUpdate => {
  const url = form.url.trim()
  const token = form.token.trim()
  if (!url && token) return { error: 'Enter the URL first' }
  if (!url && stored.url) return { error: 'Enter the URL, or use Disconnect to remove the connection' }
  return {
    update: {
      ...(url && url !== stored.url && { home_assistant_url: url }),
      ...(token && { home_assistant_token: token }),
    },
  }
}

export const syncResultMessage = (result: HomeAssistantSyncResult): string => {
  if (result.status === 'error') return result.error ?? 'Sync failed'
  const inserted = `${result.locations_inserted} new location point${result.locations_inserted === 1 ? '' : 's'}`
  return result.locations_superseded > 0
    ? `${inserted}, ${result.locations_superseded} superseded by activity GPS tracks`
    : inserted
}
