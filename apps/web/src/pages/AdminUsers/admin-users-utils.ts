import type { AdminUserOverview, AdminUserUsageDay } from '@aurboda/api-spec'

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export const formatBytes = (bytes: number | null): string => {
  if (bytes === null) return '–'
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 || value >= 10 ? Math.round(value) : value.toFixed(1)} ${UNITS[unit]}`
}

export const formatRelative = (iso: string | null, now: Date = new Date()): string => {
  if (!iso) return 'never'
  const diffMin = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin} min ago`
  const hours = Math.floor(diffMin / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 60) return `${days}d ago`
  return `${Math.floor(days / 30)} mo ago`
}

export const formatPerDay = (value: number): string =>
  value === 0 ? '0' : value < 10 ? value.toFixed(1) : String(Math.round(value))

export type SortKey = 'username' | 'created_at' | 'storage' | 'ingest' | 'last_ui' | 'last_api'

export interface SortState {
  key: SortKey
  descending: boolean
}

export const DEFAULT_SORT: SortState = { descending: true, key: 'last_ui' }

const time = (iso: string | null): number | null => (iso ? new Date(iso).getTime() : null)

const sortValue = (user: AdminUserOverview, key: SortKey): number | string | null => {
  switch (key) {
    case 'username':
      return user.username
    case 'created_at':
      return time(user.created_at)
    case 'storage':
      return user.storage_bytes
    case 'ingest':
      return user.ingest.per_day_30d
    case 'last_ui':
      return time(user.last_ui_at)
    case 'last_api':
      return time(user.last_api_at)
  }
}

/** Sorts by the key, missing values last whichever the direction, then by username. */
export const sortUsers = (users: AdminUserOverview[], { key, descending }: SortState): AdminUserOverview[] =>
  [...users].sort((a, b) => {
    const va = sortValue(a, key)
    const vb = sortValue(b, key)
    if (va === null && vb !== null) return 1
    if (vb === null && va !== null) return -1
    if (va !== null && vb !== null && va !== vb) {
      const cmp = va < vb ? -1 : 1
      return descending ? -cmp : cmp
    }
    return a.username.localeCompare(b.username)
  })

/** Clicking the current column flips its direction; another column starts newest/largest first, names A–Z. */
export const nextSort = (current: SortState, key: SortKey): SortState =>
  current.key === key ? { descending: !current.descending, key } : { descending: key !== 'username', key }

export interface StackedDays {
  days: string[]
  keys: string[]
  rows: Record<string, number>[]
}

const addDays = (day: string, n: number): string => {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * One row per day from `since` through `until` (gaps filled with zero), counting the
 * selected rows by channel. Keys are ordered by total, largest first.
 */
export const stackDaily = (
  daily: AdminUserUsageDay[],
  include: (row: AdminUserUsageDay) => boolean,
  since: string,
  until: string,
): StackedDays => {
  const days: string[] = []
  for (let day = since; day <= until; day = addDays(day, 1)) days.push(day)

  const totals = new Map<string, number>()
  const byDay = new Map<string, Map<string, number>>()
  for (const row of daily) {
    if (!include(row)) continue
    totals.set(row.channel, (totals.get(row.channel) ?? 0) + row.count)
    const counts = byDay.get(row.day) ?? new Map<string, number>()
    counts.set(row.channel, (counts.get(row.channel) ?? 0) + row.count)
    byDay.set(row.day, counts)
  }
  const keys = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k)
  const rows = days.map((day) => Object.fromEntries(keys.map((k) => [k, byDay.get(day)?.get(k) ?? 0])))
  return { days, keys, rows }
}
