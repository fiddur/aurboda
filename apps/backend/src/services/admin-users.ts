import {
  type AdminUsageChannel,
  adminUsageChannels,
  type AdminUserChannelUse,
  type AdminUserOverview,
  type AdminUserUsage,
} from '@aurboda/api-spec'

import type { TableSize } from '../db/database-sizes.ts'
import type { CentralDb } from './central-db.ts'
import type { UserAccount } from './central-user-accounts.ts'
import type { UsageSummaryRow } from './central-user-usage.ts'
import type { UsageRow } from './usage-recorder.ts'

import { accountStatus, adminUserPlan, BILLING_DISABLED, type BillingSettings } from './account-plan.ts'
import { USAGE_RETENTION_DAYS } from './central-user-usage.ts'

const DAY_MS = 86_400_000
export const SIZE_CACHE_MS = 5 * 60_000
const RECENT_DAYS = 30
const WEEK_DAYS = 7

export interface AdminUsersDeps {
  centralDb: Pick<
    CentralDb,
    'getAdmins' | 'getUsageDaily' | 'getUsageSummary' | 'getUserAccount' | 'isAdmin' | 'listUserAccounts'
  >
  /** Every user with a per-user database: the source of truth for who exists. */
  listUsers: () => Promise<string[]>
  /** Database size in bytes, by username. */
  databaseSizes: () => Promise<Map<string, number>>
  tableSizes: (username: string) => Promise<TableSize[]>
  billingSettings?: () => Promise<BillingSettings>
  now?: () => Date
}

export interface AdminUsers {
  listUsersOverview: () => Promise<AdminUserOverview[]>
  /** Resolves to null when the user does not exist. */
  getUserUsage: (username: string, days?: number) => Promise<AdminUserUsage | null>
}

/** UTC midnight `days - 1` days before `now`'s UTC date, so the window spans `days` calendar days. */
export const windowStart = (now: Date, days: number): Date => {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return new Date(today - (days - 1) * DAY_MS)
}

const utcDate = (date: Date): string => date.toISOString().slice(0, 10)

const round2 = (value: number): number => Math.round(value * 100) / 100

const iso = (date: Date | null | undefined): string | null => (date ? date.toISOString() : null)

const latest = (dates: (Date | null | undefined)[]): Date | null =>
  dates.reduce<Date | null>((max, d) => (d && (!max || d > max) ? d : max), null)

const channelUse = (
  channel: AdminUsageChannel,
  allTime: UsageSummaryRow[],
  recent: UsageRow[],
): AdminUserChannelUse => {
  const rows = recent.filter((r) => r.channel === channel && r.kind !== 'ingest')
  const sum = (kind: 'read' | 'write') => rows.filter((r) => r.kind === kind).reduce((n, r) => n + r.count, 0)
  return {
    active_days_30d: new Set(rows.map((r) => r.day)).size,
    last_at: iso(
      latest(allTime.filter((r) => r.channel === channel && r.kind !== 'ingest').map((r) => r.last_at)),
    ),
    reads_30d: sum('read'),
    writes_30d: sum('write'),
  }
}

const planOf = (
  account: UserAccount | null,
  context: { billing: BillingSettings; isAdmin: boolean; now: Date },
) =>
  adminUserPlan(
    account,
    accountStatus({ account, billing: context.billing, isAdmin: context.isAdmin, now: context.now }),
  )

const buildOverview = (
  username: string,
  context: {
    account: UserAccount | undefined
    billing: BillingSettings
    now: Date
    isAdmin: boolean
    storageBytes: number | undefined
    allTime: UsageSummaryRow[]
    recent: UsageRow[]
    weekStart: string
  },
): AdminUserOverview => {
  const { account, allTime, recent, weekStart } = context
  const ingest = recent.filter((r) => r.kind === 'ingest')
  const count = (rows: UsageRow[]) => rows.reduce((n, r) => n + r.count, 0)
  const use = Object.fromEntries(
    adminUsageChannels.map((channel) => [channel, channelUse(channel, allTime, recent)]),
  ) as Record<AdminUsageChannel, AdminUserChannelUse>
  const lastApi = latest(
    allTime
      .filter((r) => r.kind !== 'ingest' && (r.channel === 'mcp' || r.channel === 'api'))
      .map((r) => r.last_at),
  )

  return {
    ...planOf(account ?? null, context),
    created_at: iso(account?.created_at),
    ingest: {
      items_30d: ingest.reduce((n, r) => n + r.items, 0),
      last_at: iso(latest(allTime.filter((r) => r.kind === 'ingest').map((r) => r.last_at))),
      per_day_30d: round2(count(ingest) / RECENT_DAYS),
      per_day_7d: round2(count(ingest.filter((r) => r.day >= weekStart)) / WEEK_DAYS),
      sources: [...new Set(ingest.map((r) => r.channel))].sort(),
    },
    is_admin: context.isAdmin,
    last_api_at: iso(lastApi),
    last_ui_at: use.web.last_at,
    pre_existing: account?.pre_existing ?? false,
    storage_bytes: context.storageBytes ?? null,
    use,
    username,
  }
}

const groupBy = <T extends { username: string }>(rows: T[]): Map<string, T[]> => {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const list = map.get(row.username)
    if (list) list.push(row)
    else map.set(row.username, [row])
  }
  return map
}

export const createAdminUsers = ({
  centralDb,
  listUsers,
  databaseSizes,
  tableSizes,
  billingSettings = async () => BILLING_DISABLED,
  now = () => new Date(),
}: AdminUsersDeps): AdminUsers => {
  let sizeCache: { at: number; sizes: Promise<Map<string, number>> } | null = null

  const cachedSizes = (): Promise<Map<string, number>> => {
    const at = now().getTime()
    if (!sizeCache || at - sizeCache.at >= SIZE_CACHE_MS) {
      const sizes = databaseSizes()
      sizeCache = { at, sizes }
      sizes.catch(() => {
        if (sizeCache?.sizes === sizes) sizeCache = null
      })
    }
    return sizeCache.sizes
  }

  return {
    getUserUsage: async (username, days = 90) => {
      if (!(await listUsers()).includes(username)) return null
      const current = now()
      const since = windowStart(current, days)
      const [account, isAdmin, daily, sizes, tables, billing] = await Promise.all([
        centralDb.getUserAccount(username),
        centralDb.isAdmin(username),
        centralDb.getUsageDaily({ since, username }),
        cachedSizes(),
        tableSizes(username),
        billingSettings(),
      ])
      return {
        ...planOf(account, { billing, isAdmin, now: current }),
        created_at: iso(account?.created_at),
        daily: daily.map(({ channel, count, day, items, kind }) => ({ channel, count, day, items, kind })),
        is_admin: isAdmin,
        largest_tables: tables,
        pre_existing: account?.pre_existing ?? false,
        since: utcDate(since),
        storage_bytes: sizes.get(username) ?? null,
        username,
      }
    },

    listUsersOverview: async () => {
      const current = now()
      const [names, accounts, admins, allTime, recent, sizes, billing] = await Promise.all([
        listUsers(),
        centralDb.listUserAccounts(),
        centralDb.getAdmins(),
        centralDb.getUsageSummary(windowStart(current, USAGE_RETENTION_DAYS)),
        centralDb.getUsageDaily({ since: windowStart(current, RECENT_DAYS) }),
        cachedSizes(),
        billingSettings(),
      ])
      const accountByName = new Map(accounts.map((a) => [a.username, a]))
      const adminSet = new Set(admins)
      const allTimeByUser = groupBy(allTime)
      const recentByUser = groupBy(recent)
      const weekStart = utcDate(windowStart(current, WEEK_DAYS))

      return [...names].sort().map((username) =>
        buildOverview(username, {
          account: accountByName.get(username),
          allTime: allTimeByUser.get(username) ?? [],
          billing,
          isAdmin: adminSet.has(username),
          now: current,
          recent: recentByUser.get(username) ?? [],
          storageBytes: sizes.get(username),
          weekStart,
        }),
      )
    },
  }
}
