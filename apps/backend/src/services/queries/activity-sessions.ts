/**
 * Per-session heart-rate overview of one activity type, optionally grouped by a data field
 * (e.g. yoga by `session_name`, running by a `run_kind` the user tags), for choosing a session
 * by length and exertion and for comparing repeats of the same one. A field may also be an item
 * path into a list field (`sets.exercise`): then sessions group and filter by their items' values,
 * with measures over those items (see `../activity-measures.ts`).
 */

import type {
  ActivityMeasure,
  ActivityMeasures,
  ActivitySession,
  ActivitySessionGroup,
  ActivitySessions,
  ActivitySessionsQuery,
  ActivityTypeDefinition,
  HrZoneSecs,
  ValueDistribution,
} from '@aurboda/api-spec'

import type { MergedActivity } from '../../db/types.ts'

import {
  type DataFilter,
  expandActivityTypes,
  getActivities,
  getActivityTypeDefinitions,
  getHrZoneSecsForWindows,
  getValueHistogramsForWindows,
} from '../../db/index.ts'
import {
  combineMeasures,
  groupItemsByKey,
  type ItemGroup,
  listFieldOf,
  listItems,
  matchingItems,
  measureItems,
  normalizeItemValue,
  parseFieldPath,
  recordsFor,
} from '../activity-measures.ts'
import { getEffectiveHrZones } from '../settings.ts'
import { mergeHistograms, summarizeHistogram, type ValueDistributionRow } from './value-histogram.ts'

type FieldValue = string | number | boolean

export interface ItemPath {
  field: string
  key: string
}

/** Beyond the row: list-item measures, and with an item filter the matching items and records. */
export interface SessionExtras {
  items?: Record<string, unknown>[]
  measures?: ActivityMeasures
  records?: ActivityMeasure[]
}

export interface ActivitySessionsOptions {
  start?: Date
  end?: Date
  groupBy?: string
  filter?: DataFilter
}

export const sessionsOptionsFromQuery = (q: ActivitySessionsQuery): ActivitySessionsOptions => ({
  end: q.end ? new Date(q.end) : undefined,
  filter:
    q.filter_field && q.filter_value !== undefined
      ? { field: q.filter_field, value: q.filter_value === '(none)' ? null : q.filter_value }
      : undefined,
  groupBy: q.group_by,
  start: q.start ? new Date(q.start) : undefined,
})

const round1 = (v: number): number => Math.round(v * 10) / 10

const median = (values: number[]): number | undefined => {
  if (values.length === 0) return undefined
  const s = values.toSorted((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

const numberFromData = (data: Record<string, unknown> | undefined, key: string): number | undefined => {
  const v = data?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** A usable field value: a non-empty (trimmed) string, a finite number or a boolean. */
export const fieldValue = (v: unknown): FieldValue | undefined => {
  if (typeof v === 'string') return v.trim() === '' ? undefined : v.trim()
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'boolean') return v
  return undefined
}

export const toValueDistribution = (row: ValueDistributionRow): ValueDistribution => ({
  max: round1(row.max),
  median: round1(row.median),
  min: round1(row.min),
  q1: round1(row.q1),
  q3: round1(row.q3),
  sample_count: row.sample_count,
})

/**
 * Whether the merged session's field matches: the filter has to see the merged `data`, since a
 * value enriched onto one source's row must select the whole session, not just that row.
 */
export const matchesFilter = (a: MergedActivity, filter: DataFilter): boolean => {
  const v = fieldValue(a.data?.[filter.field])
  return filter.value === null ? v === undefined : v !== undefined && String(v) === filter.value
}

export const sessionId = (a: MergedActivity): string => (a.source_ids ? `merged:${a.id}` : a.id!)

export const itemPath = (path: string | undefined): ItemPath | undefined => {
  if (!path) return undefined
  const { field, key } = parseFieldPath(path)
  return key === undefined ? undefined : { field, key }
}

const nonEmpty = (m: ActivityMeasures): ActivityMeasures | undefined =>
  Object.keys(m).length > 0 ? m : undefined

/** An item filter: sessions with an item of the value, or with `null` those with no item having a value. */
export const matchesItemFilter = (a: MergedActivity, path: ItemPath, value: string | null): boolean => {
  const items = listItems(a.data, path.field)
  if (value === null) return items.every((item) => normalizeItemValue(item[path.key]) === undefined)
  const normalized = normalizeItemValue(value)
  return normalized !== undefined && items.some((item) => normalizeItemValue(item[path.key]) === normalized)
}

/**
 * Items, measures and records per session for an item filter value, judged in start order over
 * `chronological`: a record beats every earlier session in it, so it must reach back past `start`.
 */
export const itemFilterExtras = (
  chronological: MergedActivity[],
  path: ItemPath,
  value: string,
): Map<MergedActivity, SessionExtras> => {
  const normalized = normalizeItemValue(value)
  const extras = new Map<MergedActivity, SessionExtras>()
  if (normalized === undefined) return extras
  const earlier: ActivityMeasures[] = []
  for (const a of chronological.toSorted((x, y) => x.start_time.getTime() - y.start_time.getTime())) {
    const items = matchingItems(a.data, path.field, path.key, normalized)
    const measures = measureItems(items)
    extras.set(a, { items, measures: nonEmpty(measures), records: recordsFor(measures, earlier) })
    earlier.push(measures)
  }
  return extras
}

/** Sessions newest first, joined with their zone seconds, HR sample distribution and extras. */
export const buildSessions = (
  activities: MergedActivity[],
  fieldNames: string[],
  zoneSecs: Map<MergedActivity, HrZoneSecs | undefined>,
  hrDistributions: Map<string, ValueDistributionRow>,
  extras: (a: MergedActivity) => SessionExtras = () => ({}),
): ActivitySession[] =>
  activities
    .filter((a) => a.id !== undefined)
    .toSorted((a, b) => b.start_time.getTime() - a.start_time.getTime())
    .map((a) => {
      const id = sessionId(a)
      const hr = hrDistributions.get(id)
      const fields: Record<string, FieldValue> = {}
      for (const name of fieldNames) {
        const v = fieldValue(a.data?.[name])
        if (v !== undefined) fields[name] = v
      }
      const avgFromData = numberFromData(a.data, 'average_hr')
      return {
        activity_type: a.activity_type,
        avg_hr: avgFromData ?? (hr ? Math.round(hr.avg) : undefined),
        calories: numberFromData(a.data, 'calories'),
        distance: numberFromData(a.data, 'distance'),
        duration: a.end_time
          ? Math.round((a.end_time.getTime() - a.start_time.getTime()) / 60_000)
          : undefined,
        end_time: a.end_time?.toISOString(),
        fields,
        hr: hr ? toValueDistribution(hr) : undefined,
        hr_zone_secs: zoneSecs.get(a),
        id,
        max_hr: numberFromData(a.data, 'max_hr') ?? hr?.max,
        start_time: a.start_time.toISOString(),
        // Rows map a NULL title to null, which the optional-string schema doesn't allow
        title: a.title ?? undefined,
        ...extras(a),
      }
    })

export const groupKey = (value: FieldValue | null): string => `g:${JSON.stringify(value)}`

const sumZones = (zones: HrZoneSecs[]): HrZoneSecs | undefined =>
  zones.length === 0
    ? undefined
    : zones.reduce<HrZoneSecs>(
        (acc, z) => ({
          0: acc[0] + z[0],
          1: acc[1] + z[1],
          2: acc[2] + z[2],
          3: acc[3] + z[3],
          4: acc[4] + z[4],
          5: acc[5] + z[5],
        }),
        { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      )

/** One group's aggregates from its newest-first members; `pooled` is its pooled HR distribution. */
const summarizeGroup = (
  value: FieldValue | null,
  members: ActivitySession[],
  pooled: ValueDistributionRow | undefined,
): ActivitySessionGroup => {
  const durations = members.flatMap((s) => (s.duration === undefined ? [] : [s.duration]))
  const maxHrs = members.flatMap((s) => (s.max_hr === undefined ? [] : [s.max_hr]))
  const avgHrs = members.flatMap((s) => (s.avg_hr === undefined ? [] : [s.avg_hr]))
  const avgHrMedian = median(avgHrs)
  return {
    avg_hr_count: avgHrs.length,
    avg_hr_median: avgHrMedian === undefined ? undefined : round1(avgHrMedian),
    count: members.length,
    duration_max: durations.length > 0 ? Math.max(...durations) : undefined,
    duration_median: median(durations),
    duration_min: durations.length > 0 ? Math.min(...durations) : undefined,
    first_start_time: members.at(-1)!.start_time,
    hr: pooled ? toValueDistribution(pooled) : undefined,
    hr_zone_secs: sumZones(members.flatMap((s) => (s.hr_zone_secs ? [s.hr_zone_secs] : []))),
    last_start_time: members[0]!.start_time,
    max_hr: maxHrs.length > 0 ? Math.max(...maxHrs) : undefined,
    session_ids: members.map((s) => s.id),
    value,
  }
}

const byRecency = (a: ActivitySessionGroup, b: ActivitySessionGroup): number => {
  if ((a.value === null) !== (b.value === null)) return a.value === null ? 1 : -1
  return b.last_start_time.localeCompare(a.last_start_time)
}

/**
 * Group newest-first sessions by `groupBy`: most recently done group first, the no-value group
 * last. `pooledHr` holds each group's pooled HR distribution under `groupKey(value)`.
 */
export const groupSessions = (
  sessions: ActivitySession[],
  groupBy: string,
  pooledHr: Map<string, ValueDistributionRow>,
): ActivitySessionGroup[] => {
  const byValue = new Map<string, { value: FieldValue | null; sessions: ActivitySession[] }>()
  for (const session of sessions) {
    const value = session.fields[groupBy] ?? null
    const key = groupKey(value)
    const group = byValue.get(key) ?? { sessions: [], value }
    group.sessions.push(session)
    byValue.set(key, group)
  }

  return [...byValue.entries()]
    .map(([key, { value, sessions: members }]) => summarizeGroup(value, members, pooledHr.get(key)))
    .toSorted(byRecency)
}

/**
 * Group newest-first sessions by an item value: one group per normalised value, spelled as in the
 * most recent session, a session in every group it has an item for and in the no-value group when
 * it has none. Each group's measures combine its members' measures over that value's items.
 * `pooledHr` holds the pooled HR under `groupKey(normalized value)`.
 */
export const groupSessionsByItem = (
  sessions: ActivitySession[],
  itemGroups: Map<string, ItemGroup[]>,
  pooledHr: Map<string, ValueDistributionRow>,
): ActivitySessionGroup[] => {
  const byValue = new Map<
    string,
    { value: string | null; sessions: ActivitySession[]; measures: ActivityMeasures[] }
  >()
  const add = (key: string, value: string | null, session: ActivitySession, measures?: ActivityMeasures) => {
    const group = byValue.get(key) ?? { measures: [], sessions: [], value }
    group.sessions.push(session)
    if (measures) group.measures.push(measures)
    byValue.set(key, group)
  }
  for (const session of sessions) {
    const groups = itemGroups.get(session.id) ?? []
    if (groups.length === 0) add(groupKey(null), null, session)
    for (const g of groups) add(groupKey(g.normalized), g.value, session, measureItems(g.items))
  }

  return [...byValue.entries()]
    .map(([key, { value, sessions: members, measures }]) => ({
      ...summarizeGroup(value, members, pooledHr.get(key)),
      measures: value === null ? undefined : nonEmpty(combineMeasures(measures)),
    }))
    .toSorted(byRecency)
}

/**
 * HR distributions keyed by session id, and with `membership` also by each group key it gives a
 * session: each group pools its sessions' histograms.
 */
export const distributionsByKey = (
  timed: MergedActivity[],
  histograms: Map<number, number>[],
  membership?: (a: MergedActivity) => string[],
): Map<string, ValueDistributionRow> => {
  const byKey = new Map<string, ValueDistributionRow>()
  const groupHistograms = new Map<string, Map<number, number>[]>()
  timed.forEach((a, i) => {
    const histogram = histograms[i] ?? new Map<number, number>()
    const summary = summarizeHistogram(histogram)
    if (summary) byKey.set(sessionId(a), summary)
    for (const key of membership?.(a) ?? []) {
      const members = groupHistograms.get(key) ?? []
      members.push(histogram)
      groupHistograms.set(key, members)
    }
  })
  for (const [key, members] of groupHistograms) {
    const summary = summarizeHistogram(mergeHistograms(members))
    if (summary) byKey.set(key, summary)
  }
  return byKey
}

const itemGroupKeys = (groups: ItemGroup[]): string[] =>
  groups.length === 0 ? [groupKey(null)] : groups.map((g) => groupKey(g.normalized))

/** The scalar fields reported on sessions, and the list field measures are taken over. */
const sessionFieldNames = (
  definitions: ActivityTypeDefinition[],
  types: string[],
  groupBy: string | undefined,
  itemField: string | undefined,
): { fieldNames: string[]; listField?: string } => {
  const fields = definitions.filter((d) => types.includes(d.name)).flatMap((d) => d.data_schema?.fields ?? [])
  const fieldNames = [...new Set(fields.filter((f) => f.type !== 'list').map((f) => f.name))]
  if (groupBy && !itemField && !fieldNames.includes(groupBy)) fieldNames.push(groupBy)
  return { fieldNames, listField: itemField ?? listFieldOf(definitions, types) }
}

/**
 * The sessions a filter keeps. An item filter's records are judged over everything fetched (from
 * the epoch), and only then are sessions before `start` dropped.
 */
const selectSessions = (
  merged: MergedActivity[],
  filter: DataFilter | undefined,
  start: Date | undefined,
): { activities: MergedActivity[]; filterExtras?: Map<MergedActivity, SessionExtras> } => {
  if (!filter) return { activities: merged }
  const path = itemPath(filter.field)
  if (!path) return { activities: merged.filter((a) => matchesFilter(a, filter)) }
  const matching = merged.filter((a) => matchesItemFilter(a, path, filter.value))
  return {
    activities: start ? matching.filter((a) => a.start_time.getTime() >= start.getTime()) : matching,
    filterExtras: filter.value === null ? undefined : itemFilterExtras(matching, path, filter.value),
  }
}

/** Each activity's item groups by the group-by item path. */
const itemGroupsFor = (activities: MergedActivity[], path: ItemPath): Map<MergedActivity, ItemGroup[]> =>
  new Map(activities.map((a) => [a, groupItemsByKey(listItems(a.data, path.field), path.key)]))

export const queryActivitySessions = async (
  user: string,
  activityType: string,
  options: ActivitySessionsOptions = {},
): Promise<ActivitySessions> => {
  const { groupBy, filter } = options
  const groupItem = itemPath(groupBy)
  const filterItem = itemPath(filter?.field)
  const [definitions, types] = await Promise.all([
    getActivityTypeDefinitions(user),
    expandActivityTypes(user, [activityType]),
  ])
  const categoryMap = new Map(definitions.map((d) => [d.name, d.display_category]))
  const { fieldNames, listField } = sessionFieldNames(
    definitions,
    types,
    groupBy,
    filterItem?.field ?? groupItem?.field,
  )

  const merged = await getActivities(
    user,
    types,
    filterItem ? new Date(0) : (options.start ?? new Date(0)),
    options.end ?? new Date(),
    undefined,
    undefined,
    categoryMap,
  )
  const { activities, filterExtras } = selectSessions(merged, filter, options.start)
  const timed = activities.filter((a) => a.id !== undefined && a.end_time)
  const windows = timed.map((a) => ({ end: a.end_time!, start: a.start_time }))

  const itemGroups = groupItem ? itemGroupsFor(activities, groupItem) : undefined
  const membership = itemGroups
    ? (a: MergedActivity) => itemGroupKeys(itemGroups.get(a) ?? [])
    : groupBy
      ? (a: MergedActivity) => [groupKey(fieldValue(a.data?.[groupBy]) ?? null)]
      : undefined

  const [zoneSecs, histograms] = await Promise.all([
    timed.length === 0
      ? Promise.resolve([])
      : getEffectiveHrZones(user).then(({ zones }) => getHrZoneSecsForWindows(user, windows, zones)),
    getValueHistogramsForWindows(user, 'heart_rate', windows),
  ])
  const hrDistributions = distributionsByKey(timed, histograms, membership)

  const sessions = buildSessions(
    activities,
    fieldNames,
    new Map(timed.map((a, i) => [a, zoneSecs[i]])),
    hrDistributions,
    (a) =>
      filterExtras?.get(a) ?? {
        measures: listField ? nonEmpty(measureItems(listItems(a.data, listField))) : undefined,
      },
  )

  const groups = itemGroups
    ? groupSessionsByItem(
        sessions,
        new Map([...itemGroups].flatMap(([a, g]) => (a.id === undefined ? [] : [[sessionId(a), g]]))),
        hrDistributions,
      )
    : groupBy
      ? groupSessions(sessions, groupBy, hrDistributions)
      : undefined

  return { activity_type: activityType, group_by: groupBy, groups, sessions }
}
