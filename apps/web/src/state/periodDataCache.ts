import type { DashboardConfig, DashboardDataResponse } from '@aurboda/api-spec'

type CacheStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>
type ClearStorage = Pick<Storage, 'key' | 'length' | 'removeItem'>

export interface PeriodDataSlot {
  /** Who is looking: the home dashboard's id is the same `home` for every user of a browser. */
  viewer: string
  boardId: string
  granularity: string
  /** null = the latest finished period, whatever it is when asked. */
  period: string | null
  /** The config the data was resolved from; an entry for another config is not reused. */
  version: string
}

export interface CachedPeriodData {
  data: DashboardDataResponse
  savedAt: number
}

interface Entry extends CachedPeriodData {
  version: string
}

const PREFIX = 'aurboda:dashboardData:'
const INDEX_KEY = `${PREFIX}index`
export const MAX_ENTRIES = 8
export const MAX_ENTRY_CHARS = 1_500_000

export const periodDataKey = ({ boardId, granularity, period, viewer }: PeriodDataSlot): string =>
  `${PREFIX}${viewer}:${boardId}:${granularity}:${period ?? 'latest'}`

/** FNV-1a over the config's JSON, plus its length: cheap, and a changed config all but surely differs. */
export const configVersion = (config: DashboardConfig): string => {
  const json = JSON.stringify(config)
  let hash = 0x811c9dc5
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${json.length}:${(hash >>> 0).toString(36)}`
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isEntry = (value: unknown): value is Entry =>
  isRecord(value) &&
  typeof value.version === 'string' &&
  typeof value.savedAt === 'number' &&
  isRecord(value.data) &&
  typeof value.data.period === 'string' &&
  isRecord(value.data.widget_data)

const sameLocalDay = (a: number, b: number): boolean =>
  new Date(a).toDateString() === new Date(b).toDateString()

const readIndex = (store: CacheStorage): string[] => {
  const parsed: unknown = JSON.parse(store.getItem(INDEX_KEY) ?? '[]')
  return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : []
}

/**
 * The stored answer for a slot, when it was resolved from the same config. A `latest` answer is only
 * reused on the day it was saved: by the next day another period may have finished.
 */
export const readPeriodData = (
  storage: () => CacheStorage,
  slot: PeriodDataSlot,
  now: number,
): CachedPeriodData | undefined => {
  try {
    const raw = storage().getItem(periodDataKey(slot))
    if (raw === null) return undefined
    const entry: unknown = JSON.parse(raw)
    if (!isEntry(entry) || entry.version !== slot.version) return undefined
    if (slot.period === null && !sameLocalDay(entry.savedAt, now)) return undefined
    return { data: entry.data, savedAt: entry.savedAt }
  } catch {
    return undefined
  }
}

/**
 * Stores a slot's period answer, keeping the newest {@link MAX_ENTRIES}; an answer without a period
 * (a rolling dashboard, an error) or an oversized one is not kept.
 */
export const writePeriodData = (
  storage: () => CacheStorage,
  slot: PeriodDataSlot,
  data: DashboardDataResponse,
  now: number,
): void => {
  if (!data.period || !data.widget_data) return
  try {
    const store = storage()
    const key = periodDataKey(slot)
    const json = JSON.stringify({ data, savedAt: now, version: slot.version } satisfies Entry)
    const index = readIndex(store).filter((k) => k !== key)
    if (json.length > MAX_ENTRY_CHARS) {
      store.removeItem(key)
      store.setItem(INDEX_KEY, JSON.stringify(index))
      return
    }
    index.push(key)
    const evicted = index.splice(0, Math.max(0, index.length - MAX_ENTRIES))
    for (const old of evicted) store.removeItem(old)
    store.setItem(INDEX_KEY, JSON.stringify(index))
    store.setItem(key, json)
  } catch {
    // Quota or disabled storage only costs a reloaded tab its instant render.
  }
}

/** Drops every stored answer: the next user of this tab must not see them. */
export const clearPeriodData = (storage: () => ClearStorage): void => {
  try {
    const store = storage()
    const keys: string[] = []
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i)
      if (key?.startsWith(PREFIX)) keys.push(key)
    }
    for (const key of keys) store.removeItem(key)
  } catch {
    // Unreadable storage holds nothing to clear.
  }
}
