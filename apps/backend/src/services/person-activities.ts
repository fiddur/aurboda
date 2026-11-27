import type { Activity, PersonActivitiesQuery, PersonActivityTypeCount } from '@aurboda/api-spec'

import { PERSON_ACTIVITIES_DEFAULT_LIMIT, UUID_RE } from '@aurboda/api-spec'

import type { Activity as DbActivity, MergedActivity } from '../db/types.ts'

import {
  countPersonActivityGroups,
  countPersonActivityGroupsByType,
  expandActivityTypes,
  fetchCategoryMap,
  getActivityTypeDefinitions,
  listActivityGroupMembers,
  listPersonActivityGroups,
  mergeOverlappingActivities,
  type PersonActivityCursor,
} from '../db/index.ts'
import { humanizeName } from './correlations/utils.ts'
import { activityResultId } from './queries/activities.ts'

export interface PersonActivitiesDeps {
  listGroups: typeof listPersonActivityGroups
  countGroups: typeof countPersonActivityGroups
  countByType: typeof countPersonActivityGroupsByType
  members: typeof listActivityGroupMembers
  categoryMap: (user: string) => Promise<Map<string, string>>
  expandTypes: (user: string, types: string[]) => Promise<string[]>
  typeNames: (user: string) => Promise<Map<string, string>>
}

export const personActivitiesDeps: PersonActivitiesDeps = {
  categoryMap: (user) => fetchCategoryMap(user),
  countByType: (user, personId) => countPersonActivityGroupsByType(user, personId),
  countGroups: (user, personId, filter) => countPersonActivityGroups(user, personId, filter),
  expandTypes: (user, types) => expandActivityTypes(user, types),
  listGroups: (user, personId, filter, page) => listPersonActivityGroups(user, personId, filter, page),
  members: (user, ids) => listActivityGroupMembers(user, ids),
  typeNames: async (user) =>
    new Map((await getActivityTypeDefinitions(user)).map((d) => [d.name, d.display_name])),
}

export interface PersonActivitiesPage {
  data: Activity[]
  next_cursor?: string
  total: number
}

export interface PersonActivitySummary {
  activity_count: number
  activity_types: PersonActivityTypeCount[]
}

export const INVALID_CURSOR = 'Invalid cursor: pass the next_cursor of the previous page'

const CURSOR_RE = /^(-?\d{1,19})\|(.+)$/

export const encodeCursor = (cursor: PersonActivityCursor): string =>
  Buffer.from(`${cursor.start_us}|${cursor.id}`, 'utf8').toString('base64url')

export const decodeCursor = (raw: string): PersonActivityCursor | null => {
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) return null
  const match = CURSOR_RE.exec(Buffer.from(raw, 'base64url').toString('utf8'))
  if (!match || !UUID_RE.test(match[2]!)) return null
  return { id: match[2]!, start_us: match[1]! }
}

/**
 * The merged activity of one group: its own row with the rows it supersedes, merged the way the
 * activity list merges them, so the id is the one the detail page takes. Undefined when the
 * group's row is gone.
 */
export const collapseGroup = (
  groupId: string,
  members: DbActivity[],
  categoryMap: Map<string, string>,
): MergedActivity | undefined => {
  const own = members.find((m) => m.id === groupId)
  if (!own) return undefined
  if (members.length === 1) return { ...own }
  const merged = mergeOverlappingActivities(members, categoryMap)
  return (
    merged.find((m) => m.id === groupId || m.source_ids?.includes(groupId)) ?? {
      ...own,
      source_ids: members.map((m) => m.id!),
    }
  )
}

export const serializePersonActivity = (activity: MergedActivity): Activity => ({
  activity_type: activity.activity_type,
  data: activity.data,
  duration: activity.end_time
    ? Math.round((activity.end_time.getTime() - activity.start_time.getTime()) / 60_000)
    : undefined,
  end_time: activity.end_time?.toISOString(),
  id: activityResultId(activity),
  source: activity.source,
  start_time: activity.start_time.toISOString(),
  title: activity.title,
})

const membersByGroup = (groupIds: string[], rows: DbActivity[]): Map<string, DbActivity[]> => {
  const groups = new Map(groupIds.map((id) => [id, [] as DbActivity[]]))
  for (const row of rows) {
    const key = row.id && groups.has(row.id) ? row.id : row.superseded_by
    if (key) groups.get(key)?.push(row)
  }
  return groups
}

const splitTypes = (types: string): string[] =>
  types
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)

/** A page of the activities the person was with, newest first; the person is assumed live. */
export const listPersonActivityPage = async (
  user: string,
  personId: string,
  query: PersonActivitiesQuery,
  deps: PersonActivitiesDeps = personActivitiesDeps,
): Promise<{ ok: true; value: PersonActivitiesPage } | { ok: false; error: string }> => {
  const before = query.before === undefined ? undefined : decodeCursor(query.before)
  if (before === null) return { error: INVALID_CURSOR, ok: false }
  const filter = {
    end: query.end ? new Date(query.end) : undefined,
    start: query.start ? new Date(query.start) : undefined,
    types: query.types ? await deps.expandTypes(user, splitTypes(query.types)) : undefined,
  }
  const limit = query.limit ?? PERSON_ACTIVITIES_DEFAULT_LIMIT
  const [groups, total] = await Promise.all([
    deps.listGroups(user, personId, filter, { before, limit: limit + 1 }),
    deps.countGroups(user, personId, filter),
  ])
  const page = groups.slice(0, limit)
  const ids = page.map((g) => g.id)
  const [rows, categoryMap] = await Promise.all([deps.members(user, ids), deps.categoryMap(user)])
  const byGroup = membersByGroup(ids, rows)
  const data = page
    .map((g) => collapseGroup(g.id, byGroup.get(g.id) ?? [], categoryMap))
    .filter((a): a is MergedActivity => a !== undefined)
    .map(serializePersonActivity)
  const last = page.at(-1)
  return {
    ok: true,
    value: {
      data,
      ...(groups.length > limit && last ? { next_cursor: encodeCursor(last) } : {}),
      total,
    },
  }
}

/**
 * How many activities the person was with, in all and by type, most frequent first. A type's count
 * includes its subtypes, as the `types` filter does; `activity_count` counts each activity once.
 */
export const personActivitySummary = async (
  user: string,
  personId: string,
  deps: PersonActivitiesDeps = personActivitiesDeps,
): Promise<PersonActivitySummary> => {
  const [counts, names] = await Promise.all([deps.countByType(user, personId), deps.typeNames(user)])
  const exact = new Map(counts.map((c) => [c.activity_type, c.count]))
  const widened = await Promise.all(
    counts.map(async (c) => {
      const types = await deps.expandTypes(user, [c.activity_type])
      return {
        activity_type: c.activity_type,
        count: types.reduce((sum, t) => sum + (exact.get(t) ?? 0), 0),
        type_name: names.get(c.activity_type) ?? humanizeName(c.activity_type),
      }
    }),
  )
  return {
    activity_count: counts.reduce((sum, c) => sum + c.count, 0),
    activity_types: widened.toSorted(
      (a, b) => b.count - a.count || a.activity_type.localeCompare(b.activity_type),
    ),
  }
}
