/**
 * Per-session heart-rate overview of one activity type, optionally grouped by a data field
 * (e.g. yoga by `session_name`, running by a `run_kind` the user tags), for choosing a session
 * by length and exertion and for comparing repeats of the same one.
 */

import type {
  ActivitySession,
  ActivitySessionGroup,
  ActivitySessions,
  ActivitySessionsQuery,
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
  getTimeSeriesDistributions,
  type ValueDistributionRow,
} from '../../db/index.ts'
import { getEffectiveHrZones } from '../settings.ts'

type FieldValue = string | number | boolean

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

const sessionId = (a: MergedActivity): string => (a.source_ids ? `merged:${a.id}` : a.id!)

/** Sessions newest first, joined with their zone seconds and HR sample distribution. */
export const buildSessions = (
  activities: MergedActivity[],
  fieldNames: string[],
  zoneSecs: Map<MergedActivity, HrZoneSecs | undefined>,
  hrDistributions: Map<string, ValueDistributionRow>,
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
    .map(([key, { value, sessions: members }]): ActivitySessionGroup => {
      const durations = members.flatMap((s) => (s.duration === undefined ? [] : [s.duration]))
      const maxHrs = members.flatMap((s) => (s.max_hr === undefined ? [] : [s.max_hr]))
      const avgHrMedian = median(members.flatMap((s) => (s.avg_hr === undefined ? [] : [s.avg_hr])))
      const pooled = pooledHr.get(key)
      return {
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
    })
    .toSorted((a, b) => {
      if ((a.value === null) !== (b.value === null)) return a.value === null ? 1 : -1
      return b.last_start_time.localeCompare(a.last_start_time)
    })
}

export const queryActivitySessions = async (
  user: string,
  activityType: string,
  options: ActivitySessionsOptions = {},
): Promise<ActivitySessions> => {
  const { groupBy, filter } = options
  const [definitions, types] = await Promise.all([
    getActivityTypeDefinitions(user),
    expandActivityTypes(user, [activityType]),
  ])
  const categoryMap = new Map(definitions.map((d) => [d.name, d.display_category]))
  const fieldNames = [
    ...new Set(
      definitions
        .filter((d) => types.includes(d.name))
        .flatMap((d) => d.data_schema?.fields.map((f) => f.name) ?? []),
    ),
  ]
  if (groupBy && !fieldNames.includes(groupBy)) fieldNames.push(groupBy)

  const merged = await getActivities(
    user,
    types,
    options.start ?? new Date(0),
    options.end ?? new Date(),
    undefined,
    undefined,
    categoryMap,
  )
  const activities = filter ? merged.filter((a) => matchesFilter(a, filter)) : merged
  const timed = activities.filter((a) => a.id !== undefined && a.end_time)
  const windows = timed.map((a) => ({ end: a.end_time!, key: sessionId(a), start: a.start_time }))

  // Group windows pool every session's samples under the group's key.
  const groupWindows = groupBy
    ? timed.map((a, i) => ({ ...windows[i]!, key: groupKey(fieldValue(a.data?.[groupBy]) ?? null) }))
    : []

  const [zoneSecs, hrDistributions] = await Promise.all([
    timed.length === 0
      ? Promise.resolve([])
      : getEffectiveHrZones(user).then(({ zones }) => getHrZoneSecsForWindows(user, windows, zones)),
    getTimeSeriesDistributions(user, 'heart_rate', [...windows, ...groupWindows]),
  ])

  const sessions = buildSessions(
    activities,
    fieldNames,
    new Map(timed.map((a, i) => [a, zoneSecs[i]])),
    hrDistributions,
  )

  return {
    activity_type: activityType,
    group_by: groupBy,
    groups: groupBy ? groupSessions(sessions, groupBy, hrDistributions) : undefined,
    sessions,
  }
}
