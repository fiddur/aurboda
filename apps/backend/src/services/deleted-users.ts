/**
 * The deleted usernames, held in memory so the auth path can refuse a deleted
 * user's still-decodable token without a query per request. Loaded at startup,
 * added to on deletion, and reloaded periodically so an instance overlapping a
 * deploy learns of deletions made by the other one.
 */

export const DELETED_USERS_REFRESH_MS = 2 * 60_000

export interface DeletedUsers {
  has: (username: string) => boolean
  add: (username: string) => void
  /** Replaces the set with the stored list. A failed load keeps the current set. */
  refresh: () => Promise<void>
  /** Refreshes every `intervalMs` until the returned function is called. */
  startRefreshing: (intervalMs?: number) => () => void
}

export interface DeletedUsersDeps {
  list: () => Promise<string[]>
  setInterval?: (fn: () => void, ms: number) => { unref?: () => void }
  clearInterval?: (handle: unknown) => void
}

export const createDeletedUsers = ({
  list,
  setInterval: schedule = setInterval,
  clearInterval: cancel = clearInterval as (handle: unknown) => void,
}: DeletedUsersDeps): DeletedUsers => {
  let names = new Set<string>()
  const added = new Set<string>()

  const refresh = async () => {
    try {
      const loaded = new Set(await list())
      for (const name of added) loaded.add(name)
      names = loaded
    } catch (error) {
      console.error('⚠️ Failed to load deleted usernames:', error)
    }
  }

  return {
    add: (username) => {
      added.add(username)
      names.add(username)
    },
    has: (username) => names.has(username),
    refresh,
    startRefreshing: (intervalMs = DELETED_USERS_REFRESH_MS) => {
      const handle = schedule(() => void refresh(), intervalMs)
      handle.unref?.()
      return () => cancel(handle)
    },
  }
}
