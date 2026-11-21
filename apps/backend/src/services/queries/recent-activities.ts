import type {
  ActivityTypeDefinition,
  RecentActivitiesData,
  RecentActivitiesWindow,
  RecentActivity,
} from '@aurboda/api-spec'

import { ACTIVITY_LANE_CATEGORIES, isSleepType } from '@aurboda/api-spec'

import type { MergedActivity } from '../../db/types.ts'

import { expandActivityTypes, getActivities, getActivityTypeDefinitions } from '../../db/index.ts'
import { humanizeName } from '../correlations/utils.ts'
import { dayKey, dayStartInTz } from '../day-keys.ts'
import { activityResultId } from './activities.ts'

export interface RecentActivitiesDeps {
  expandActivityTypes: typeof expandActivityTypes
  getActivities: typeof getActivities
  listActivityTypeDefinitions: typeof getActivityTypeDefinitions
}

export interface RecentActivitiesFilter {
  exclude_types?: string[]
  limit?: number
  lookback_days?: number
  manual_only?: boolean
  types?: string[]
  window?: RecentActivitiesWindow
}

export interface RecentActivitiesOptions {
  now?: Date
  /** A fixed inclusive range (a period dashboard); wins over window and lookback_days. */
  range?: { end: Date; start: Date }
  tz: string
}

const DAY_MS = 86_400_000

/** The types a day overview draws as icons: shown on the timeline, in an activity-lane category, not sleep. */
const defaultTypes = (definitions: ActivityTypeDefinition[]): string[] =>
  definitions
    .filter(
      (d) =>
        d.show_on_timeline !== false &&
        ACTIVITY_LANE_CATEGORIES.has(d.display_category) &&
        !isSleepType(d.name, d.parent_type ?? undefined),
    )
    .map((d) => d.name)

const rangeOf = (filter: RecentActivitiesFilter, options: RecentActivitiesOptions) => {
  if (options.range) return options.range
  const now = options.now ?? new Date()
  if ((filter.window ?? 'today') === 'today') {
    return { end: now, start: dayStartInTz(dayKey(now, options.tz), options.tz) }
  }
  return { end: now, start: new Date(now.getTime() - (filter.lookback_days ?? 30) * DAY_MS) }
}

const mergedFromSynced = (a: MergedActivity): boolean => {
  const sources = a.data?.merged_from
  return (
    Array.isArray(sources) && sources.some((s) => (s as { source?: unknown } | null)?.source !== 'aurboda')
  )
}

/** Hand-logged in Aurboda: an override of a synced activity, or a merge of synced ones, is an edit. */
const isManual = (a: MergedActivity): boolean =>
  a.source === 'aurboda' &&
  !(a.override_target_ids && a.override_target_ids.length > 0) &&
  !mergedFromSynced(a)

const positiveNumber = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined

const toRow = (a: MergedActivity, definition: ActivityTypeDefinition | undefined): RecentActivity => {
  const data = a.data ?? {}
  const id = activityResultId(a)
  const sets = data.sets
  const figures = {
    avg_hr: positiveNumber(data.average_hr),
    calories: positiveNumber(data.calories),
    distance_m: positiveNumber(data.distance),
    duration_minutes: a.end_time
      ? Math.round((a.end_time.getTime() - a.start_time.getTime()) / 60000)
      : undefined,
    set_count: Array.isArray(sets) && sets.length > 0 ? sets.length : undefined,
  }
  return {
    activity_type: a.activity_type,
    ...(definition?.color ? { color: definition.color } : {}),
    ...(a.end_time ? { end_time: a.end_time.toISOString() } : {}),
    ...(definition?.icon ? { icon: definition.icon } : {}),
    ...(id ? { id } : {}),
    ...Object.fromEntries(Object.entries(figures).filter(([, v]) => v !== undefined)),
    start_time: a.start_time.toISOString(),
    ...(a.title ? { title: a.title } : {}),
    type_name: definition?.display_name ?? humanizeName(a.activity_type),
  }
}

/** The latest activities, newest first: a light read for the dashboard card, without the enrichment of query_activities. */
export const getRecentActivities = async (
  user: string,
  filter: RecentActivitiesFilter,
  options: RecentActivitiesOptions,
  deps: RecentActivitiesDeps = {
    expandActivityTypes,
    getActivities,
    listActivityTypeDefinitions: getActivityTypeDefinitions,
  },
): Promise<RecentActivitiesData> => {
  const { tz } = options
  const definitions = await deps.listActivityTypeDefinitions(user)
  const [included, excluded] = await Promise.all([
    filter.types?.length ? deps.expandActivityTypes(user, filter.types) : defaultTypes(definitions),
    filter.exclude_types?.length ? deps.expandActivityTypes(user, filter.exclude_types) : [],
  ])
  const excludedSet = new Set(excluded)
  const types = included.filter((t) => !excludedSet.has(t))
  if (types.length === 0) return { activities: [], tz }

  const { end, start } = rangeOf(filter, options)
  const categoryMap = new Map(definitions.map((d) => [d.name, d.display_category]))
  const activities = await deps.getActivities(user, types, start, end, undefined, undefined, categoryMap)
  const byName = new Map(definitions.map((d) => [d.name, d]))
  return {
    activities: activities
      .filter((a) => !filter.manual_only || isManual(a))
      .toSorted((a, b) => b.start_time.getTime() - a.start_time.getTime())
      .slice(0, filter.limit ?? 5)
      .map((a) => toRow(a, byName.get(a.activity_type))),
    tz,
  }
}
