import {
  type ActivityItemGroup,
  type ActivityItemHistory,
  type ActivityItemTrend,
  activityMeasures,
  type ActivityMeasures,
  measureTrendHalfLifeDays,
} from '@aurboda/api-spec'

import type { Activity, MergedActivity } from '../../db/types.ts'

import {
  expandActivityTypes,
  getActivities,
  getActivityById,
  getActivityTypeDefinitions,
  getOverlappingActivities,
} from '../../db/index.ts'
import {
  groupItemsByKey,
  type ItemGroup,
  listItems,
  measureItems,
  parseFieldPath,
  recordsFor,
} from '../activity-measures.ts'
import { decayedBestAt } from '../trends.ts'
import { parseActivityId, resolveActivityWindow } from './activity-detail.ts'

interface EarlierSession {
  activity: MergedActivity
  items: Record<string, unknown>[]
  measures: ActivityMeasures
}

const groupStart = async (user: string, activity: Activity): Promise<Date> => {
  const group = activity.deleted_at ? [] : await getOverlappingActivities(user, activity)
  return new Date(Math.min(activity.start_time.getTime(), ...group.map((a) => a.start_time.getTime())))
}

/** Earlier sessions of the type, oldest first, before the activity's merge group starts. */
const earlierSessions = async (user: string, activity: Activity): Promise<MergedActivity[]> => {
  const [definitions, types, before] = await Promise.all([
    getActivityTypeDefinitions(user),
    expandActivityTypes(user, [activity.activity_type]),
    groupStart(user, activity),
  ])
  const categoryMap = new Map(definitions.map((d) => [d.name, d.display_category]))
  const sessions = await getActivities(
    user,
    types,
    new Date(0),
    new Date(before.getTime() - 1),
    undefined,
    undefined,
    categoryMap,
  )
  return sessions
    .filter((a) => a.id !== undefined && a.start_time.getTime() < before.getTime())
    .toSorted((a, b) => a.start_time.getTime() - b.start_time.getTime())
}

const utcDay = (date: Date): string => date.toISOString().slice(0, 10)

const oneDecimal = (value: number): number => Math.round(value * 10) / 10

/** Per measure of this session, the decaying best of the earlier sessions (same-day ones included) and after this one. */
const trendsFor = (measures: ActivityMeasures, earlier: EarlierSession[], day: string): ActivityItemTrend[] =>
  activityMeasures.flatMap((measure) => {
    const value = measures[measure]
    if (value === undefined) return []
    const points = earlier.flatMap((e) => {
      const v = e.measures[measure]
      return v === undefined ? [] : [{ day: utcDay(e.activity.start_time), value: v }]
    })
    const sameDay = points.filter((p) => p.day === day).map((p) => p.value)
    const carried = decayedBestAt(points, day, measureTrendHalfLifeDays)
    const before =
      carried === undefined && sameDay.length === 0 ? undefined : Math.max(carried ?? -Infinity, ...sameDay)
    return before === undefined
      ? [{ after: oneDecimal(value), measure }]
      : [{ after: oneDecimal(Math.max(before, value)), before: oneDecimal(before), measure }]
  })

const toGroup = (group: ItemGroup, earlier: EarlierSession[], day: string): ActivityItemGroup => {
  const measures = measureItems(group.items)
  const previous = earlier.at(-1)
  return {
    items: group.items,
    measures,
    previous: previous && {
      id: previous.activity.source_ids ? `merged:${previous.activity.id}` : previous.activity.id!,
      items: previous.items,
      measures: previous.measures,
      start_time: previous.activity.start_time.toISOString(),
    },
    records: recordsFor(
      measures,
      earlier.map((e) => e.measures),
    ),
    trend: trendsFor(measures, earlier, day),
    value: group.value,
  }
}

/**
 * One activity's list items grouped by an item value (`sets.exercise`): per value its items and
 * measures, the records it set against every earlier session with the value, the latest such
 * session, and the decaying-best trend before and after it. Null when the activity doesn't exist.
 */
export const queryActivityItemHistory = async (
  user: string,
  rawId: string,
  path: string,
): Promise<ActivityItemHistory | null> => {
  const { id, isMerged } = parseActivityId(rawId)
  const activity = await getActivityById(user, id, true)
  if (!activity) return null

  const { field, key } = parseFieldPath(path)
  const { data } = await resolveActivityWindow(user, activity, isMerged)
  const items = listItems(data, field)
  const groups = key === undefined ? [] : groupItemsByKey(items, key)
  const base = {
    activity_id: rawId,
    field: path,
    totals: measureItems(items),
    trend_half_life_days: measureTrendHalfLifeDays,
  }
  if (groups.length === 0) return { ...base, groups: [] }

  const earlier = await earlierSessions(user, activity)
  const earlierByValue = new Map<string, EarlierSession[]>(groups.map((g) => [g.normalized, []]))
  for (const a of earlier) {
    for (const g of groupItemsByKey(listItems(a.data, field), key!)) {
      earlierByValue.get(g.normalized)?.push({ activity: a, items: g.items, measures: measureItems(g.items) })
    }
  }

  const day = utcDay(activity.start_time)
  return { ...base, groups: groups.map((g) => toGroup(g, earlierByValue.get(g.normalized)!, day)) }
}
