import type { ActivitySessionGroup } from '@aurboda/api-spec'

import { type Comparable, compare } from '../../components/sessions/sessionView'

export type ItemGroupSortKey = 'recent' | 'count' | 'e1rm' | 'max_weight' | 'volume' | 'name'

const sortValue = (g: ActivitySessionGroup, key: ItemGroupSortKey): Comparable => {
  switch (key) {
    case 'recent':
      return g.last_start_time
    case 'count':
      return g.count
    case 'e1rm':
    case 'max_weight':
    case 'volume':
      return g.measures?.[key]
    case 'name':
      return g.value === null ? undefined : String(g.value)
  }
}

/** Name sorts ascending, everything else descending; missing values and the no-value group go last. */
export const sortItemGroups = (
  groups: ActivitySessionGroup[],
  key: ItemGroupSortKey,
): ActivitySessionGroup[] =>
  groups.toSorted((a, b) => {
    if ((a.value === null) !== (b.value === null)) return a.value === null ? 1 : -1
    return compare(sortValue(a, key), sortValue(b, key), key !== 'name')
  })
