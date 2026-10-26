/**
 * An activity type's sessions with their list-item measures (see `../activity-measures.ts`), for
 * series over time: charting a measure per bucket, and measure goals.
 */

import type { ActivityMeasures } from '@aurboda/api-spec'

import type { MergedActivity } from '../../db/types.ts'

import { expandActivityTypes, getActivities, getActivityTypeDefinitions } from '../../db/index.ts'
import {
  groupItemsByKey,
  listFieldOf,
  listItems,
  matchingItems,
  measureItems,
  normalizeItemValue,
  parseFieldPath,
} from '../activity-measures.ts'
import { itemPath, matchesFilter, sessionId } from './activity-sessions.ts'

export interface MeasuredActivity {
  activity: MergedActivity
  id: string
  measures: ActivityMeasures
}

export interface MeasureFilter {
  field: string
  value: string
}

export const measureFilter = (
  field: string | undefined,
  value: string | undefined,
): MeasureFilter | undefined => (field && value !== undefined ? { field, value } : undefined)

export interface ItemValueMeasures {
  value: string
  normalized: string
  measures: ActivityMeasures
}

/** The items the measures are taken over: those of the filter's value, or all of `listField`'s. */
const measuredItems = (
  a: MergedActivity,
  listField: string,
  filter: MeasureFilter | undefined,
): Record<string, unknown>[] | undefined => {
  const path = itemPath(filter?.field)
  if (!filter || !path || path.field !== listField) return listItems(a.data, listField)
  const normalized = normalizeItemValue(filter.value)
  if (normalized === undefined) return undefined
  const items = matchingItems(a.data, path.field, path.key, normalized)
  return items.length > 0 ? items : undefined
}

/**
 * Sessions of `activityType` (and its descendants) started in `[start, end]`, in start order, with
 * the measures of their list items. With an item-path filter (`sets.exercise`), only the items of
 * that value count and sessions without one are dropped; a scalar filter keeps the sessions whose
 * field has the value. A type without a list field has no measured sessions.
 */
export const queryMeasuredActivities = async (
  user: string,
  activityType: string,
  start: Date,
  end: Date,
  filter?: MeasureFilter,
): Promise<MeasuredActivity[]> => {
  const [definitions, types] = await Promise.all([
    getActivityTypeDefinitions(user),
    expandActivityTypes(user, [activityType]),
  ])
  const filterPath = itemPath(filter?.field)
  const listField = filterPath?.field ?? listFieldOf(definitions, types)
  if (!listField) return []

  const categoryMap = new Map(definitions.map((d) => [d.name, d.display_category]))
  const activities = await getActivities(user, types, start, end, undefined, undefined, categoryMap)
  const scalarFilter = filter && !filterPath ? filter : undefined

  return activities
    .filter((a) => a.id !== undefined && (!scalarFilter || matchesFilter(a, scalarFilter)))
    .toSorted((a, b) => a.start_time.getTime() - b.start_time.getTime())
    .flatMap((a) => {
      const items = measuredItems(a, listField, filter)
      return items ? [{ activity: a, id: sessionId(a), measures: measureItems(items) }] : []
    })
}

/**
 * The activity's measures per value of an item path (`sets.exercise`), one entry per normalised
 * value spelled as it first appears. With an item-path filter on the same list field, only the
 * filtered items are grouped.
 */
export const measuresByItemValue = (
  activity: MergedActivity,
  path: string,
  filter?: MeasureFilter,
): ItemValueMeasures[] => {
  const { field, key } = parseFieldPath(path)
  if (key === undefined) return []
  const items = measuredItems(activity, field, filter) ?? []
  return groupItemsByKey(items, key).map((g) => ({
    measures: measureItems(g.items),
    normalized: g.normalized,
    value: g.value,
  }))
}
