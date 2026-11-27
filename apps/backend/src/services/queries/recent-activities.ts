import type {
  ActivityTypeDefinition,
  RecentActivitiesData,
  RecentActivitiesWindow,
  RecentActivity,
  RecentActivitySummaryField,
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

interface ListedRange {
  end: Date
  start: Date
  /** List what overlaps the range, not only what starts in it. */
  overlap: boolean
}

const rangeOf = (filter: RecentActivitiesFilter, options: RecentActivitiesOptions): ListedRange => {
  if (options.range) return { ...options.range, overlap: true }
  const now = options.now ?? new Date()
  if ((filter.window ?? 'today') === 'today') {
    return { end: now, overlap: true, start: dayStartInTz(dayKey(now, options.tz), options.tz) }
  }
  return { end: now, overlap: false, start: new Date(now.getTime() - (filter.lookback_days ?? 30) * DAY_MS) }
}

/**
 * The read selects by start, so an activity still running into the range is read from a day
 * earlier; one that started more than a day before the range is not listed.
 */
const OVERLAP_LOOK_BACK_MS = DAY_MS

/**
 * The newest slice is read first and widened until it holds `limit` rows. A slice counts as
 * filled only when its last kept row starts a day after the slice does, so no kept row could
 * have merged with one from before the slice.
 */
const FIRST_SLICE_MS = 2 * DAY_MS
const SLICE_GROWTH = 4

const overlapsFrom = (a: MergedActivity, start: Date): boolean =>
  a.start_time >= start || (a.end_time !== undefined && a.end_time > start)

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

const FIGURE_FIELDS = new Set(['average_hr', 'calories', 'distance', 'sets'])

const summaryValue = (v: unknown): string | number | undefined => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'string') return v.trim() === '' ? undefined : v
  return undefined
}

type SchemaField = NonNullable<ActivityTypeDefinition['data_schema']>['fields'][number]

const UNIT_SUFFIX = '_unit'

/** A flagged `<x>_unit` beside a numeric `<x>` reads as one figure ("10 mg"), not as a bare unit. */
const measuredBy = (
  field: SchemaField,
  fields: SchemaField[],
  data: Record<string, unknown>,
): SchemaField | undefined => {
  if (!field.name.endsWith(UNIT_SUFFIX)) return undefined
  const amount = fields.find((f) => f.name === field.name.slice(0, -UNIT_SUFFIX.length))
  return amount && typeof data[amount.name] === 'number' ? amount : undefined
}

const labelOf = (field: SchemaField): string => field.label ?? humanizeName(field.name)

export const summaryFields = (
  data: Record<string, unknown>,
  definition: ActivityTypeDefinition | undefined,
): RecentActivitySummaryField[] => {
  const fields = definition?.data_schema?.fields ?? []
  const flagged = fields.filter((f) => f.show_in_summary && f.type !== 'list' && !FIGURE_FIELDS.has(f.name))
  const amounts = new Map(flagged.map((f) => [f, measuredBy(f, fields, data)]))
  const paired = new Set([...amounts.values()].filter((a) => a !== undefined))
  return flagged.flatMap((field) => {
    if (paired.has(field)) return []
    const amount = amounts.get(field)
    const value = summaryValue(data[(amount ?? field).name])
    if (value === undefined) return []
    const unit = amount ? summaryValue(data[field.name]) : field.unit
    return [{ label: labelOf(amount ?? field), ...(unit ? { unit: String(unit) } : {}), value }]
  })
}

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
  const summary = summaryFields(data, definition)
  return {
    activity_type: a.activity_type,
    ...(definition?.color ? { color: definition.color } : {}),
    ...(a.end_time ? { end_time: a.end_time.toISOString() } : {}),
    ...(definition?.icon ? { icon: definition.icon } : {}),
    ...(id ? { id } : {}),
    ...Object.fromEntries(Object.entries(figures).filter(([, v]) => v !== undefined)),
    start_time: a.start_time.toISOString(),
    ...(summary.length > 0 ? { summary_fields: summary } : {}),
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

  const { end, overlap, start } = rangeOf(filter, options)
  const readStart = overlap ? new Date(start.getTime() - OVERLAP_LOOK_BACK_MS) : start
  const categoryMap = new Map(definitions.map((d) => [d.name, d.display_category]))
  const limit = filter.limit ?? 5
  const listed = (activities: MergedActivity[]): MergedActivity[] =>
    activities
      .filter((a) => overlapsFrom(a, start))
      .filter((a) => !filter.manual_only || isManual(a))
      .toSorted((a, b) => b.start_time.getTime() - a.start_time.getTime())
      .slice(0, limit)

  const readFrom = async (span: number): Promise<MergedActivity[]> => {
    const sliceStart = new Date(Math.max(readStart.getTime(), end.getTime() - span))
    const rows = listed(
      await deps.getActivities(user, types, sliceStart, end, undefined, undefined, categoryMap),
    )
    if (sliceStart.getTime() <= readStart.getTime()) return rows
    const last = rows[limit - 1]
    const filled =
      last !== undefined && last.start_time.getTime() - sliceStart.getTime() >= OVERLAP_LOOK_BACK_MS
    return filled ? rows : readFrom(span * SLICE_GROWTH)
  }

  const byName = new Map(definitions.map((d) => [d.name, d]))
  return {
    activities: (await readFrom(FIRST_SLICE_MS)).map((a) => toRow(a, byName.get(a.activity_type))),
    tz,
  }
}
