import type { DashboardConfig } from '@aurboda/api-spec'

type ReadStorage = Pick<Storage, 'getItem'>
type WriteStorage = Pick<Storage, 'setItem'>

const cacheKey = (user: string) => `aurboda:dashboard:${user}`

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isWidget = (value: unknown): boolean =>
  isRecord(value) && typeof value.id === 'string' && typeof value.type === 'string' && isRecord(value.config)

const isSection = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.title === 'string' &&
  typeof value.type === 'string' &&
  Array.isArray(value.widgets) &&
  value.widgets.every(isWidget)

const isDashboardConfig = (value: unknown): value is DashboardConfig =>
  isRecord(value) && value.version === 1 && Array.isArray(value.sections) && value.sections.every(isSection)

export const readCachedDashboard = (
  storage: () => ReadStorage,
  user: string | undefined,
): DashboardConfig | undefined => {
  if (!user) return undefined
  try {
    const raw = storage().getItem(cacheKey(user))
    if (raw === null) return undefined
    const parsed: unknown = JSON.parse(raw)
    return isDashboardConfig(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

export const writeCachedDashboard = (
  storage: () => WriteStorage,
  user: string | undefined,
  config: DashboardConfig,
): void => {
  if (!user) return
  try {
    storage().setItem(cacheKey(user), JSON.stringify(config))
  } catch {
    // Quota or disabled storage only costs the next visit its head start.
  }
}
