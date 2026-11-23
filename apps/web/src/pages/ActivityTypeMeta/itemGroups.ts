import type { ActivitySessionGroup, StrengthScore } from '@aurboda/api-spec'

import { type Comparable, compare } from '../../components/sessions/sessionView'

export type ItemGroupSortKey = 'recent' | 'count' | 'e1rm' | 'max_weight' | 'volume' | 'points' | 'name'

export type PointsByValue = ReadonlyMap<string, number>

const valueKey = (value: string | number | boolean): string => String(value).trim().toLowerCase()

/** Each scored lift's points by its exercise, trimmed and lowercased; the highest where several lifts share one. */
export const pointsByExercise = (score: StrengthScore | null | undefined): Map<string, number> => {
  const points = new Map<string, number>()
  for (const lift of score?.groups.flatMap((g) => g.lifts) ?? []) {
    if (lift.best === undefined || lift.score === null) continue
    const key = valueKey(lift.best.value)
    points.set(key, Math.max(points.get(key) ?? lift.score, lift.score))
  }
  return points
}

export const groupPoints = (g: ActivitySessionGroup, points: PointsByValue | undefined): number | undefined =>
  g.value === null ? undefined : points?.get(valueKey(g.value))

const sortValue = (g: ActivitySessionGroup, key: ItemGroupSortKey, points?: PointsByValue): Comparable => {
  switch (key) {
    case 'recent':
      return g.last_start_time
    case 'count':
      return g.count
    case 'e1rm':
    case 'max_weight':
    case 'volume':
      return g.measures?.[key]
    case 'points':
      return groupPoints(g, points)
    case 'name':
      return g.value === null ? undefined : String(g.value)
  }
}

/** Name sorts ascending, everything else descending; missing values and the no-value group go last. */
export const sortItemGroups = (
  groups: ActivitySessionGroup[],
  key: ItemGroupSortKey,
  points?: PointsByValue,
): ActivitySessionGroup[] =>
  groups.toSorted((a, b) => {
    if ((a.value === null) !== (b.value === null)) return a.value === null ? 1 : -1
    return compare(sortValue(a, key, points), sortValue(b, key, points), key !== 'name')
  })

/** Groups whose value contains the query, ignoring case; the no-value group only while the query is blank. */
export const filterItemGroups = (groups: ActivitySessionGroup[], query: string): ActivitySessionGroup[] => {
  const needle = query.trim().toLowerCase()
  if (!needle) return groups
  return groups.filter((g) => g.value !== null && String(g.value).toLowerCase().includes(needle))
}
