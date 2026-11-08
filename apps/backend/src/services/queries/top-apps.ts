import type { TopApps } from '@aurboda/api-spec'

import { getProductivity, getScreentimeCategories, type ProductivityRecord } from '../../db/index.ts'

export interface TopAppsDeps {
  getProductivity: typeof getProductivity
  getScreentimeCategories: typeof getScreentimeCategories
}

const hours = (seconds: number): number => Math.round(seconds / 360) / 10

const isExcluded = (record: ProductivityRecord, excludedPaths: Set<string>): boolean => {
  const path = record.resolved_category ?? []
  return path.some((_, i) => excludedPaths.has(path.slice(0, i + 1).join(' > ')))
}

/** Screen time per app over `[start, end]`, without the records whose category (or a parent of it) is excluded. */
export const getTopApps = async (
  user: string,
  window: { start: Date; end: Date },
  limit: number,
  deps: TopAppsDeps = { getProductivity, getScreentimeCategories },
): Promise<TopApps> => {
  const [records, categories] = await Promise.all([
    deps.getProductivity(user, window.start, window.end),
    deps.getScreentimeCategories(user),
  ])
  const excludedPaths = new Set(
    categories.filter((c) => c.exclude_from_screentime).map((c) => c.name.join(' > ')),
  )
  const seconds = new Map<string, number>()
  for (const record of records) {
    if (!record.activity || isExcluded(record, excludedPaths)) continue
    seconds.set(record.activity, (seconds.get(record.activity) ?? 0) + record.duration_sec)
  }
  const ranked = [...seconds].sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
  return {
    distinct_apps: seconds.size,
    items: ranked.slice(0, limit).map(([name, sec]) => ({ hours: hours(sec), name })),
    total_hours: hours(ranked.reduce((total, [, sec]) => total + sec, 0)),
  }
}
