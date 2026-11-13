import type { AccountReadOnlyResponse } from '@aurboda/api-spec'

import type { CentralDb } from './central-db.ts'
import type { SyncProvider } from './queries/types.ts'

import {
  type AccountStatus,
  accountStatus,
  type BillingSettings,
  readBillingSettings,
} from './account-plan.ts'

export const GATE_CACHE_MS = 30_000

export const READ_ONLY_MESSAGE = 'This account is read-only until the plan is renewed'

export type ReadOnlyRefusal = Omit<AccountReadOnlyResponse, 'success'>

export interface AccountGate {
  getStatus: (username: string) => Promise<AccountStatus>
  isReadOnly: (username: string) => Promise<boolean>
  /** The 402 body for a read-only user, or null when the user may write. */
  refusal: (username: string) => Promise<ReadOnlyRefusal | null>
  /** Drops cached statuses: one user's, or every user's and the billing settings. */
  invalidate: (username?: string) => void
}

export interface AccountGateDeps {
  centralDb: Pick<CentralDb, 'getServerSetting' | 'getUserAccount' | 'isAdmin'>
  now?: () => Date
  ttlMs?: number
}

interface Cached<T> {
  at: number
  value: Promise<T>
}

/**
 * Statuses and billing settings are cached for `ttlMs` per process. An admin edit invalidates
 * this process's cache; another process (during a deploy overlap) catches up within the TTL.
 */
export const createAccountGate = ({
  centralDb,
  now = () => new Date(),
  ttlMs = GATE_CACHE_MS,
}: AccountGateDeps): AccountGate => {
  let billingCache: Cached<BillingSettings> | null = null
  const statusCache = new Map<string, Cached<AccountStatus>>()

  const fresh = <T>(entry: Cached<T> | null | undefined, at: number): entry is Cached<T> =>
    !!entry && at - entry.at < ttlMs

  const billing = (): Promise<BillingSettings> => {
    const at = now().getTime()
    if (fresh(billingCache, at)) return billingCache.value
    const value = readBillingSettings(centralDb)
    const entry = { at, value }
    billingCache = entry
    value.catch(() => {
      if (billingCache === entry) billingCache = null
    })
    return value
  }

  const getStatus = (username: string): Promise<AccountStatus> => {
    const current = now()
    const at = current.getTime()
    const cached = statusCache.get(username)
    if (fresh(cached, at)) return cached.value
    const value = (async () => {
      const settings = await billing()
      if (!settings.enabled) {
        return accountStatus({ account: null, billing: settings, isAdmin: false, now: current })
      }
      const [account, isAdmin] = await Promise.all([
        centralDb.getUserAccount(username),
        centralDb.isAdmin(username),
      ])
      return accountStatus({ account, billing: settings, isAdmin, now: current })
    })()
    const entry = { at, value }
    statusCache.set(username, entry)
    value.catch(() => {
      if (statusCache.get(username) === entry) statusCache.delete(username)
    })
    return value
  }

  const isReadOnly = async (username: string): Promise<boolean> =>
    (await getStatus(username)).state === 'read_only'

  return {
    getStatus,
    invalidate: (username) => {
      if (username === undefined) {
        statusCache.clear()
        billingCache = null
      } else {
        statusCache.delete(username)
      }
    },
    isReadOnly,
    refusal: async (username) => {
      if (!(await isReadOnly(username))) return null
      const { payment_url } = await billing()
      return { error: READ_ONLY_MESSAGE, payment_url: payment_url || null }
    },
  }
}

/** Fails open: a gate lookup that throws lets the request through rather than lock users out. */
export const safeRefusal = async (gate: AccountGate, username: string): Promise<ReadOnlyRefusal | null> => {
  try {
    return await gate.refusal(username)
  } catch (error) {
    console.error(`⚠️ Account gate lookup failed for ${username}:`, error)
    return null
  }
}

export const safeIsReadOnly = async (gate: AccountGate, username: string): Promise<boolean> =>
  (await safeRefusal(gate, username)) !== null

/** Every pull for a read-only user returns without syncing. */
export const gateSyncProvider = (
  sync: SyncProvider,
  isReadOnly: (user: string) => Promise<boolean>,
): SyncProvider => {
  const gated =
    <A extends unknown[]>(fn: (user: string, ...args: A) => Promise<void>) =>
    async (user: string, ...args: A): Promise<void> => {
      if (await isReadOnly(user)) return
      await fn(user, ...args)
    }
  return {
    syncCalendarsIfNeeded: gated(sync.syncCalendarsIfNeeded),
    syncGarminIfNeeded: gated(sync.syncGarminIfNeeded),
    syncGravlIfNeeded: gated(sync.syncGravlIfNeeded),
    syncHomeAssistantIfNeeded: gated(sync.syncHomeAssistantIfNeeded),
    syncLastFmIfNeeded: gated(sync.syncLastFmIfNeeded),
    syncOuraIfNeeded: gated(sync.syncOuraIfNeeded),
    syncRescueTimeIfNeeded: gated(sync.syncRescueTimeIfNeeded),
  }
}
