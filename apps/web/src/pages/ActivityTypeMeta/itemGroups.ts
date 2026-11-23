import type { ActivitySessionGroup } from '@aurboda/api-spec'

import { type Comparable, compare } from '../../components/sessions/sessionView'

export type ItemGroupSortKey =
  | 'recent'
  | 'count'
  | 'e1rm'
  | 'max_weight'
  | 'best_set'
  | 'volume'
  | 'points'
  | 'name'

export type GroupPoints = (g: ActivitySessionGroup) => number | undefined

const sortValue = (g: ActivitySessionGroup, key: ItemGroupSortKey, pointsOf?: GroupPoints): Comparable => {
  switch (key) {
    case 'recent':
      return g.last_start_time
    case 'count':
      return g.count
    case 'e1rm':
    case 'max_weight':
    case 'volume':
      return g.measures?.[key]
    case 'best_set':
      return g.best_set?.weight
    case 'points':
      return pointsOf?.(g)
    case 'name':
      return g.value === null ? undefined : String(g.value)
  }
}

/**
 * Name sorts ascending, everything else descending (the best set by weight, then reps); missing values
 * and the no-value group go last. `pointsOf` gives the points the `points` key sorts by.
 */
export const sortItemGroups = (
  groups: ActivitySessionGroup[],
  key: ItemGroupSortKey,
  pointsOf?: GroupPoints,
): ActivitySessionGroup[] =>
  groups.toSorted((a, b) => {
    if ((a.value === null) !== (b.value === null)) return a.value === null ? 1 : -1
    return (
      compare(sortValue(a, key, pointsOf), sortValue(b, key, pointsOf), key !== 'name') ||
      (key === 'best_set' ? compare(a.best_set?.reps, b.best_set?.reps, true) : 0)
    )
  })

/** Groups whose value contains the query, ignoring case; the no-value group only while the query is blank. */
export const filterItemGroups = (groups: ActivitySessionGroup[], query: string): ActivitySessionGroup[] => {
  const needle = query.trim().toLowerCase()
  if (!needle) return groups
  return groups.filter((g) => g.value !== null && String(g.value).toLowerCase().includes(needle))
}
