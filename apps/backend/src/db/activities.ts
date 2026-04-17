/**
 * Activity CRUD operations and merge logic.
 */
import format from 'pg-format'

import type { ActivityType } from '../schema.ts'
import type { Activity, ActivityUpdate, MergedActivity } from './types.ts'

import { query } from './connection.ts'
import { buildDynamicUpdate, type UpdateEntry } from './dynamic-update.ts'
import { mapActivityRow } from './row-mappers.ts'

// =============================================================================
// Cross-source merge: collapse near-simultaneous activities from different
// sync sources into a single activity using priority-based winner selection.
// =============================================================================

/** Max start_time difference (ms) for cross-source merge eligibility. */
const CROSS_MERGE_THRESHOLD_MS = 120_000

/** Sources that track physical activities and are eligible for cross-source merge. */
const CROSS_MERGE_SOURCES = new Set([
  'aurboda',
  'deduction-rule',
  'garmin',
  'health_connect',
  'manual',
  'oura',
])

/** Display categories whose activities can cross-merge with each other. */
const CROSS_MERGEABLE_CATEGORIES = new Set(['exercise', 'meditation', 'wellness'])

/** Higher number = higher priority when picking the cross-merge winner. */
const SOURCE_PRIORITY: Record<string, number> = {
  health_connect: 1,
  oura: 2,
  garmin: 3,
  'deduction-rule': 4,
  manual: 5,
  aurboda: 6,
}

const getEffectivePriority = (a: Activity): number => {
  const base = SOURCE_PRIORITY[a.source] ?? 0
  const edited = (a.data as Record<string, unknown> | undefined)?._user_edited
  return edited ? base + 100 : base
}

// Simple union-find for grouping cross-merge candidates.
const ufFind = (parent: number[], i: number): number => {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]] // path compression
    i = parent[i]
  }
  return i
}

const ufUnion = (parent: number[], rank: number[], a: number, b: number) => {
  const ra = ufFind(parent, a)
  const rb = ufFind(parent, b)
  if (ra === rb) return
  if (rank[ra] < rank[rb]) {
    parent[ra] = rb
  } else if (rank[ra] > rank[rb]) {
    parent[rb] = ra
  } else {
    parent[rb] = ra
    rank[ra]++
  }
}

/** Check if two activities are eligible for cross-source merge. */
const isCrossMergePair = (a: Activity, b: Activity, categoryMap: Map<string, string>): boolean => {
  if (!CROSS_MERGE_SOURCES.has(b.source)) return false
  if (a.source === b.source) return false
  if (a.activity_type === b.activity_type) return false
  const catB = categoryMap.get(b.activity_type)
  return !!catB && CROSS_MERGEABLE_CATEGORIES.has(catB)
}

/** Merge a group of activities into one, using priority-based winner selection. */
const mergeGroupByPriority = (members: Activity[]): MergedActivity => {
  const sorted = [...members].sort(
    (a, b) =>
      getEffectivePriority(b) - getEffectivePriority(a) || a.start_time.getTime() - b.start_time.getTime(),
  )

  const winner: MergedActivity = { ...sorted[0] }
  const sourceIds: string[] = []

  for (const member of sorted) {
    if (member.id) sourceIds.push(member.id)
    if (member.start_time < winner.start_time) winner.start_time = member.start_time
    if (member.end_time && (!winner.end_time || member.end_time > winner.end_time)) {
      winner.end_time = member.end_time
    }
    if (member !== sorted[0] && member.data) {
      winner.data = { ...member.data, ...winner.data }
    }
    if (!winner.title && member.title) winner.title = member.title
    if (member !== sorted[0] && member.notes) {
      winner.notes = winner.notes ? `${winner.notes}\n${member.notes}` : member.notes
    }
  }

  if (sourceIds.length > 1) winner.source_ids = sourceIds
  return winner
}

/**
 * Cross-source merge pass: merge near-simultaneous activities from different
 * sync sources that represent the same physical session.
 *
 * Winner is selected by source priority (aurboda > garmin > health_connect, etc.)
 * with a boost for _user_edited activities.
 */
const mergeCrossSources = (activities: Activity[], categoryMap: Map<string, string>): MergedActivity[] => {
  if (activities.length <= 1) return activities.map((a) => ({ ...a }))

  const sorted = [...activities].sort((a, b) => a.start_time.getTime() - b.start_time.getTime())

  // Union-find: group cross-merge candidates
  const parent = sorted.map((_, i) => i)
  const rank = sorted.map(() => 0)

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]
    if (!CROSS_MERGE_SOURCES.has(a.source)) continue
    const catA = categoryMap.get(a.activity_type)
    if (!catA || !CROSS_MERGEABLE_CATEGORIES.has(catA)) continue

    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].start_time.getTime() - a.start_time.getTime() > CROSS_MERGE_THRESHOLD_MS) break
      if (isCrossMergePair(a, sorted[j], categoryMap)) ufUnion(parent, rank, i, j)
    }
  }

  // Build groups from union-find
  const groups = new Map<number, number[]>()
  for (let i = 0; i < sorted.length; i++) {
    const root = ufFind(parent, i)
    const group = groups.get(root)
    if (group) group.push(i)
    else groups.set(root, [i])
  }

  // Merge each group
  const result: MergedActivity[] = []
  for (const indices of groups.values()) {
    if (indices.length === 1) {
      result.push({ ...sorted[indices[0]] })
    } else {
      result.push(mergeGroupByPriority(indices.map((i) => sorted[i])))
    }
  }

  return result
}

// =============================================================================
// Same-type merge + generic exercise absorption
// =============================================================================

/**
 * Merge overlapping activities of the same type, with optional cross-source deduplication.
 *
 * When the same activity is logged in multiple apps (e.g., Polar for HR data
 * and Gravl for workout details), this function merges them into a single
 * activity using the earliest start time and latest end time.
 *
 * Pipeline:
 * 1. Cross-source merge (when categoryMap provided): collapse near-simultaneous
 *    activities from different sync sources into one (priority-based winner).
 * 2. Same-type merge: group by activityType, merge overlapping within each group.
 * 3. Absorb generic exercises into overlapping specific activities.
 *
 * Merge rules (same-type pass):
 * - Activities are grouped by activityType
 * - Activities overlap if: a1.endTime >= a2.startTime (or a1 has no endTime and a2 starts during a1's day)
 * - Merged activity uses: earliest startTime, latest endTime
 * - First activity's source and id are kept
 * - First non-empty title is used
 * - Notes are concatenated with newline
 * - Data objects are merged (later values override earlier for same keys)
 *
 * @param categoryMap Optional map of activity_type -> display_category. When provided,
 *   enables cross-source merge for near-simultaneous activities from different sources.
 */
// eslint-disable-next-line complexity -- TODO: refactor
export const mergeOverlappingActivities = (
  activities: Activity[],
  categoryMap?: Map<string, string>,
): MergedActivity[] => {
  if (activities.length === 0) return []

  // Pass 0: Cross-source merge (when category info is available)
  const input = categoryMap ? mergeCrossSources(activities, categoryMap) : activities

  // Pass 1: Same-type merge — group by activity type
  const byType = new Map<string, Activity[]>()
  for (const a of input) {
    const group = byType.get(a.activity_type) ?? []
    group.push(a)
    byType.set(a.activity_type, group)
  }

  const result: MergedActivity[] = []

  for (const [, typeActivities] of byType) {
    // Sort by start time
    const sorted = [...typeActivities].sort((a, b) => a.start_time.getTime() - b.start_time.getTime())

    let current: MergedActivity = { ...sorted[0] }
    let currentSourceIds: string[] = sorted[0].id ? [sorted[0].id] : []

    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i]
      const currentEnd = current.end_time?.getTime() ?? current.start_time.getTime()
      const nextStart = next.start_time.getTime()

      // Check if activities overlap or touch
      if (currentEnd >= nextStart) {
        // Merge: extend end time if needed
        const nextEnd = next.end_time?.getTime()
        if (
          nextEnd !== undefined &&
          (current.end_time === undefined || nextEnd > current.end_time.getTime())
        ) {
          current.end_time = next.end_time
        }

        // Use first non-empty title
        if (!current.title && next.title) {
          current.title = next.title
        }

        // Concatenate notes
        if (next.notes) {
          current.notes = current.notes ? `${current.notes}\n${next.notes}` : next.notes
        }

        // Merge data objects
        if (next.data) {
          current.data = { ...current.data, ...next.data }
        }

        // Track source IDs
        if (next.id) {
          currentSourceIds.push(next.id)
        }
      } else {
        // No overlap, save current and start new
        if (currentSourceIds.length > 1) {
          current.source_ids = currentSourceIds
        }
        result.push(current)
        current = { ...next }
        currentSourceIds = next.id ? [next.id] : []
      }
    }

    // Don't forget the last one
    if (currentSourceIds.length > 1) {
      current.source_ids = currentSourceIds
    }
    result.push(current)
  }

  // Sort final result by start time
  result.sort((a, b) => a.start_time.getTime() - b.start_time.getTime())

  // Second pass: absorb generic exercises (other_workout, unknown, no subtype)
  // into overlapping specific activities of a different type.
  return absorbGenericExercises(result)
}

const GENERIC_EXERCISE_CODES = new Set([0, 2]) // UNKNOWN=0, OTHER_WORKOUT=2

const isGenericExercise = (a: MergedActivity): boolean => {
  if (a.activity_type !== 'exercise') return false
  const code = (a.data as Record<string, unknown> | undefined)?.exerciseType
  return !code || GENERIC_EXERCISE_CODES.has(code as number)
}

/** Check if generic's duration overlaps >50% with another activity. */
const findAbsorbingActivity = (
  gStart: number,
  gEnd: number,
  sorted: MergedActivity[],
  skipIndices: Set<number>,
  genericIndex: number,
): MergedActivity | undefined => {
  for (let j = 0; j < sorted.length; j++) {
    if (j === genericIndex || skipIndices.has(j) || isGenericExercise(sorted[j])) continue
    const oStart = sorted[j].start_time.getTime()
    const oEnd = sorted[j].end_time?.getTime() ?? oStart
    const overlapMs = Math.min(gEnd, oEnd) - Math.max(gStart, oStart)
    if (overlapMs > 0 && overlapMs / (gEnd - gStart) > 0.5) return sorted[j]
  }
  return undefined
}

/**
 * Absorb generic exercises into overlapping specific activities.
 * The specific activity's time range is extended to cover the generic's range.
 * Requires input sorted by start_time.
 */
const absorbGenericExercises = (sorted: MergedActivity[]): MergedActivity[] => {
  const absorbed = new Set<number>()

  for (let i = 0; i < sorted.length; i++) {
    if (!isGenericExercise(sorted[i]) || absorbed.has(i)) continue

    const generic = sorted[i]
    const gStart = generic.start_time.getTime()
    const gEnd = generic.end_time?.getTime() ?? gStart
    if (gEnd <= gStart) continue

    const match = findAbsorbingActivity(gStart, gEnd, sorted, absorbed, i)
    if (match) {
      if (generic.start_time < match.start_time) match.start_time = generic.start_time
      if (generic.end_time && (!match.end_time || generic.end_time > match.end_time)) {
        match.end_time = generic.end_time
      }
      absorbed.add(i)
    }
  }

  return sorted.filter((_, i) => !absorbed.has(i))
}

/**
 * Given merged results and the original raw activities, find all raw activities
 * belonging to the same merge group as the given activity ID.
 *
 * Pure function — no DB access, easy to unit test.
 */
export const findMergedGroupForActivity = (
  mergedResults: MergedActivity[],
  rawActivities: Activity[],
  activityId: string,
): Activity[] => {
  // Find which merged result contains the target activity ID
  const mergedGroup = mergedResults.find((m) => m.id === activityId || m.source_ids?.includes(activityId))
  if (!mergedGroup) return []

  // Collect all IDs in this merge group
  const groupIds = new Set(mergedGroup.source_ids ?? (mergedGroup.id ? [mergedGroup.id] : []))

  // Return the raw activities that belong to this group, sorted by start_time
  return rawActivities
    .filter((a) => a.id !== undefined && groupIds.has(a.id))
    .sort((a, b) => a.start_time.getTime() - b.start_time.getTime())
}

/**
 * Find all non-deleted activities of the same type that belong to the same merge group
 * as the given activity. Uses transitive merge logic (via mergeOverlappingActivities +
 * findMergedGroupForActivity) to guarantee consistency with the day view.
 *
 * Queries a wide time window (activity's day +/- 12h) and runs the merge algorithm
 * to find the full transitive chain.
 */
export const getOverlappingActivities = async (user: string, activity: Activity): Promise<Activity[]> => {
  // Query a wide window around the activity to catch all transitively-connected activities
  const activityTime = activity.start_time.getTime()
  const windowStart = new Date(activityTime - 12 * 60 * 60 * 1000)
  const windowEnd = new Date(activityTime + 24 * 60 * 60 * 1000)

  const result = await query(
    user,
    `SELECT id, source, external_id, activity_type, start_time, end_time, title, notes, data, deleted_at
     FROM activities
     WHERE activity_type = $1
       AND deleted_at IS NULL
       AND start_time >= $2
       AND start_time <= $3
     ORDER BY start_time`,
    [activity.activity_type, windowStart, windowEnd],
  )

  const rawActivities = result.rows.map(mapActivityRow)
  const merged = mergeOverlappingActivities(rawActivities)

  return findMergedGroupForActivity(merged, rawActivities, activity.id!)
}

/**
 * Insert a new activity with a guaranteed new row (no upsert).
 * Used for merge operations where we need to ensure the activity is created.
 * Throws on conflict instead of silently doing nothing.
 */
export const insertNewActivity = async (user: string, activity: Activity): Promise<string> => {
  const result = await query(
    user,
    `INSERT INTO activities (id, source, activity_type, start_time, end_time, title, notes, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      activity.id,
      activity.source,
      activity.activity_type,
      activity.start_time,
      activity.end_time,
      activity.title,
      activity.notes,
      activity.data,
    ],
  )

  return result.rows[0].id as string
}

export const insertActivity = async (user: string, activity: Activity): Promise<string> => {
  if (activity.external_id) {
    // Upsert by external_id (for sourced data like calendar events, Oura tags, lastfm)
    const result = await query(
      user,
      `INSERT INTO activities (id, source, external_id, activity_type, start_time, end_time, title, notes, data)
       VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL DO UPDATE SET
         activity_type = EXCLUDED.activity_type,
         start_time = EXCLUDED.start_time,
         end_time = EXCLUDED.end_time,
         title = EXCLUDED.title,
         notes = EXCLUDED.notes,
         data = COALESCE(activities.data, '{}'::jsonb) || EXCLUDED.data
       WHERE activities.deleted_at IS NULL
       RETURNING id`,
      [
        activity.id,
        activity.source,
        activity.external_id,
        activity.activity_type,
        activity.start_time,
        activity.end_time,
        activity.title,
        activity.notes,
        activity.data,
      ],
    )
    return result.rows[0]?.id as string
  }

  // Upsert by type + time (for sync data without external_id)
  const result = await query(
    user,
    `INSERT INTO activities (id, source, activity_type, start_time, end_time, title, notes, data)
     VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (source, activity_type, start_time) WHERE external_id IS NULL DO UPDATE SET
       end_time = EXCLUDED.end_time,
       title = EXCLUDED.title,
       notes = EXCLUDED.notes,
       data = COALESCE(activities.data, '{}'::jsonb) || EXCLUDED.data
     WHERE activities.deleted_at IS NULL
     RETURNING id`,
    [
      activity.id,
      activity.source,
      activity.activity_type,
      activity.start_time,
      activity.end_time,
      activity.title,
      activity.notes,
      activity.data,
    ],
  )
  return result.rows[0]?.id as string
}

export const insertActivities = async (user: string, activities: Activity[]) => {
  if (activities.length === 0) return

  // Split into external_id and non-external_id batches for different conflict targets
  const withExtId = activities.filter((a) => a.external_id)
  const withoutExtId = activities.filter((a) => !a.external_id)

  if (withExtId.length > 0) {
    const values = withExtId.map((a) => [
      a.id ?? null,
      a.source,
      a.external_id!,
      a.activity_type,
      a.start_time,
      a.end_time ?? null,
      a.title ?? null,
      a.notes ?? null,
      a.data ?? null,
    ])
    await query(
      user,
      format(
        `INSERT INTO activities (id, source, external_id, activity_type, start_time, end_time, title, notes, data)
         SELECT COALESCE(v.id::uuid, gen_random_uuid()), v.source, v.external_id, v.activity_type,
                v.start_time::timestamptz, v.end_time::timestamptz, v.title, v.notes, v.data::jsonb
         FROM (VALUES %L) AS v(id, source, external_id, activity_type, start_time, end_time, title, notes, data)
         ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL DO UPDATE SET
           activity_type = EXCLUDED.activity_type,
           start_time = EXCLUDED.start_time,
           end_time = EXCLUDED.end_time,
           title = EXCLUDED.title,
           notes = EXCLUDED.notes,
           data = COALESCE(activities.data, '{}'::jsonb) || EXCLUDED.data
         WHERE activities.deleted_at IS NULL`,
        values,
      ),
    )
  }

  if (withoutExtId.length > 0) {
    const values = withoutExtId.map((a) => [
      a.id ?? null,
      a.source,
      a.activity_type,
      a.start_time,
      a.end_time ?? null,
      a.title ?? null,
      a.notes ?? null,
      a.data ?? null,
    ])
    await query(
      user,
      format(
        `INSERT INTO activities (id, source, activity_type, start_time, end_time, title, notes, data)
         SELECT COALESCE(v.id::uuid, gen_random_uuid()), v.source, v.activity_type,
                v.start_time::timestamptz, v.end_time::timestamptz, v.title, v.notes, v.data::jsonb
         FROM (VALUES %L) AS v(id, source, activity_type, start_time, end_time, title, notes, data)
         ON CONFLICT (source, activity_type, start_time) WHERE external_id IS NULL DO UPDATE SET
           end_time = EXCLUDED.end_time,
           title = EXCLUDED.title,
           notes = EXCLUDED.notes,
           data = COALESCE(activities.data, '{}'::jsonb) || EXCLUDED.data
         WHERE activities.deleted_at IS NULL`,
        values,
      ),
    )
  }
}

export const getActivityById = async (
  user: string,
  id: string,
  includeDeleted = false,
): Promise<Activity | null> => {
  const deletedClause = includeDeleted ? '' : ' AND deleted_at IS NULL'
  const result = await query(
    user,
    `SELECT id, source, external_id, activity_type, start_time, end_time, title, notes, data, deleted_at
     FROM activities
     WHERE id = $1${deletedClause}`,
    [id],
  )

  if (result.rows.length === 0) {
    return null
  }

  return mapActivityRow(result.rows[0])
}

export const deleteActivity = async (user: string, id: string): Promise<boolean> => {
  const result = await query(
    user,
    `UPDATE activities SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  )

  return (result.rowCount ?? 0) > 0
}

export const softDeleteActivityByExternalId = async (
  user: string,
  source: string,
  externalId: string,
): Promise<boolean> => {
  const result = await query(
    user,
    `UPDATE activities SET deleted_at = NOW() WHERE source = $1 AND external_id = $2 AND deleted_at IS NULL`,
    [source, externalId],
  )

  return (result.rowCount ?? 0) > 0
}

export const restoreActivity = async (user: string, id: string): Promise<boolean> => {
  const result = await query(
    user,
    `UPDATE activities SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL`,
    [id],
  )

  return (result.rowCount ?? 0) > 0
}

export const updateActivity = async (
  user: string,
  id: string,
  updates: ActivityUpdate,
): Promise<Activity | null> => {
  const fields: UpdateEntry[] = []
  if (updates.activity_type !== undefined) {
    fields.push({ column: 'activity_type', value: updates.activity_type })
  }
  if (updates.start_time !== undefined) fields.push({ column: 'start_time', value: updates.start_time })
  if (updates.end_time !== undefined) fields.push({ column: 'end_time', value: updates.end_time })
  if (updates.title !== undefined) fields.push({ column: 'title', value: updates.title })
  if (updates.notes !== undefined) fields.push({ column: 'notes', value: updates.notes })
  if (updates.data !== undefined) fields.push({ column: 'data', value: JSON.stringify(updates.data) })

  if (fields.length === 0) return getActivityById(user, id)

  const update = buildDynamicUpdate('activities', id, fields, {
    returning: 'id, source, external_id, activity_type, start_time, end_time, title, notes, data, deleted_at',
  })
  if (!update) return getActivityById(user, id)

  const result = await query(user, update.sql, update.params)
  if (result.rows.length === 0) return null
  return mapActivityRow(result.rows[0])
}

export const getActivities = async (
  user: string,
  activityType: ActivityType | ActivityType[],
  start: Date,
  end: Date,
  dataFilters?: Array<{ field: string; value: string | null }>,
  deductionRuleId?: string,
  categoryMap?: Map<string, string>,
): Promise<MergedActivity[]> => {
  const types = Array.isArray(activityType) ? activityType : [activityType]
  const params: unknown[] = [types, start, end]

  let filterClauses = ''
  if (dataFilters?.length) {
    for (const filter of dataFilters) {
      if (!/^[a-z][a-z0-9_]*$/.test(filter.field)) continue
      if (filter.value === null) {
        filterClauses += `\n       AND (data->>'${filter.field}' IS NULL OR data->>'${filter.field}' = '')`
      } else {
        params.push(filter.value)
        filterClauses += `\n       AND data->>'${filter.field}' = $${params.length}`
      }
    }
  }

  if (deductionRuleId) {
    params.push(deductionRuleId)
    filterClauses += `\n       AND (data->>'rule_id' = $${params.length} OR data->>'_enriched_by' = $${params.length})`
  }

  const result = await query(
    user,
    `SELECT id, source, external_id, activity_type, start_time, end_time, title, notes, data, deleted_at
     FROM activities
     WHERE activity_type = ANY($1) AND start_time >= $2 AND start_time <= $3
       AND deleted_at IS NULL${filterClauses}
     ORDER BY start_time`,
    params,
  )

  const activities = result.rows.map(mapActivityRow)

  return mergeOverlappingActivities(activities, categoryMap)
}

/**
 * Get sleep sessions that overlap with a date range.
 * Uses date overlap logic so overnight sleep (starting 11pm, ending 7am)
 * appears on the wake-up day rather than the start day.
 */
export const getSleepSessions = async (user: string, start: Date, end: Date): Promise<MergedActivity[]> => {
  const result = await query(
    user,
    `SELECT id, source, external_id, activity_type, start_time, end_time, title, notes, data, deleted_at
     FROM activities
     WHERE activity_type = 'sleep'
       AND start_time < $2
       AND (end_time >= $1 OR end_time IS NULL)
       AND deleted_at IS NULL
     ORDER BY start_time`,
    [start, end],
  )

  const activities = result.rows.map(mapActivityRow)

  return mergeOverlappingActivities(activities)
}

/**
 * Get activities that have a garmin_activity_id but haven't had their
 * per-second detail data synced yet. Includes merged activities (source may be
 * 'health_connect' or 'aurboda' after merging).
 */
export const getActivitiesNeedingDetail = async (
  user: string,
  { forceAll = false, limit = 10 }: { forceAll?: boolean; limit?: number } = {},
): Promise<Activity[]> => {
  const detailFilter = forceAll ? '' : "AND (a.data->>'detail_synced') IS NULL"
  const result = await query(
    user,
    `SELECT a.id, a.source, a.external_id, a.activity_type, a.start_time, a.end_time, a.title, a.notes, a.data, a.deleted_at
     FROM activities a
     JOIN activity_type_definitions atd ON a.activity_type = atd.name
     WHERE atd.display_category IN ('exercise', 'meditation')
       AND a.data->>'garmin_activity_id' IS NOT NULL
       ${detailFilter}
       AND a.deleted_at IS NULL
     ORDER BY a.start_time DESC
     LIMIT $1`,
    [limit],
  )

  return result.rows.map(mapActivityRow)
}

/**
 * Find nearby same-type activities for merge suggestions.
 * Returns non-deleted activities of the same type within ±hoursWindow of the given time range,
 * excluding the given activity ID.
 */
export const getNearbyActivities = async (
  user: string,
  activityId: string,
  activityType: string,
  startTime: Date,
  endTime: Date | undefined,
  hoursWindow: number,
): Promise<Activity[]> => {
  const windowMs = hoursWindow * 60 * 60 * 1000
  const windowStart = new Date(startTime.getTime() - windowMs)
  const windowEnd = new Date((endTime ?? startTime).getTime() + windowMs)

  const result = await query(
    user,
    `SELECT id, source, external_id, activity_type, start_time, end_time, title, notes, data, deleted_at
     FROM activities
     WHERE activity_type = $1
       AND id != $2
       AND deleted_at IS NULL
       AND start_time >= $3
       AND start_time <= $4
     ORDER BY start_time`,
    [activityType, activityId, windowStart, windowEnd],
  )

  return result.rows.map(mapActivityRow)
}

/**
 * Check if an activity with the same (source, activity_type, start_time) already exists,
 * excluding the given activity ID. Used to preemptively detect unique constraint violations
 * before changing an activity's type.
 */
export const checkActivityConflict = async (
  user: string,
  source: string,
  activityType: string,
  startTime: Date,
  excludeId: string,
): Promise<boolean> => {
  const result = await query(
    user,
    `SELECT 1 FROM activities
     WHERE source = $1 AND activity_type = $2 AND start_time = $3
       AND id != $4 AND deleted_at IS NULL
     LIMIT 1`,
    [source, activityType, startTime, excludeId],
  )
  return result.rows.length > 0
}

/**
 * Delete a Garmin activity that has the given garmin_activity_id but a different activity_type.
 * Used during re-sync to prevent duplicates when the type mapping changes
 * (e.g., meditation activities previously imported as exercise).
 */
export const deleteGarminActivityWithWrongType = async (
  user: string,
  garminActivityId: number,
  correctType: string,
): Promise<string | null> => {
  const result = await query(
    user,
    `DELETE FROM activities
     WHERE source = 'garmin'
       AND (data->>'garmin_activity_id')::bigint = $1
       AND activity_type != $2
       AND deleted_at IS NULL
     RETURNING id`,
    [garminActivityId, correctType],
  )
  return result.rows.length > 0 ? (result.rows[0].id as string) : null
}

/** Mark an activity's detail data as synced using JSONB merge (preserves existing data). */
export const markActivityDetailSynced = async (user: string, id: string): Promise<void> => {
  await query(user, `UPDATE activities SET data = data || '{"detail_synced": true}'::jsonb WHERE id = $1`, [
    id,
  ])
}

/** Get activities by display category (e.g., 'exercise' gets all exercise types). */
export const getActivitiesByCategory = async (
  user: string,
  displayCategory: string,
  start: Date,
  end: Date,
  categoryMap?: Map<string, string>,
): Promise<MergedActivity[]> => {
  const result = await query(
    user,
    `SELECT a.id, a.source, a.external_id, a.activity_type, a.start_time, a.end_time, a.title, a.notes, a.data, a.deleted_at
     FROM activities a
     JOIN activity_type_definitions atd ON a.activity_type = atd.name
     WHERE atd.display_category = $1 AND a.start_time >= $2 AND a.start_time <= $3
       AND a.deleted_at IS NULL
     ORDER BY a.start_time`,
    [displayCategory, start, end],
  )
  const activities = result.rows.map(mapActivityRow)
  return mergeOverlappingActivities(activities, categoryMap)
}

/**
 * Get all distinct activity_type values from the activities table.
 * Unlike getActivityTypeNames (which reads from definitions), this reads actual data.
 */
export const getAllActivityTypeNames = async (user: string): Promise<string[]> => {
  const result = await query(
    user,
    `SELECT DISTINCT activity_type FROM activities WHERE deleted_at IS NULL ORDER BY activity_type`,
  )
  return result.rows.map((r) => r.activity_type as string)
}

/**
 * Get activities whose type definition is NOT in the given display categories.
 * Used to get "tag-like" activities (everything except sleep/exercise).
 */
export const getActivitiesExcludingCategories = async (
  user: string,
  excludeCategories: string[],
  start: Date,
  end: Date,
): Promise<Activity[]> => {
  const result = await query(
    user,
    `SELECT a.id, a.source, a.external_id, a.activity_type, a.start_time, a.end_time, a.title, a.notes, a.data, a.deleted_at
     FROM activities a
     LEFT JOIN activity_type_definitions atd ON a.activity_type = atd.name
     WHERE a.deleted_at IS NULL
       AND a.start_time >= $1 AND a.start_time <= $2
       AND (atd.display_category IS NULL OR atd.display_category != ALL($3))
     ORDER BY a.start_time`,
    [start, end, excludeCategories],
  )
  return result.rows.map(mapActivityRow)
}

/**
 * Get all non-sleep activities for a time range, with overlapping same-type activities merged.
 * Used by the daily summary to build a unified activity timeline.
 */
export const getNonSleepActivitiesMerged = async (
  user: string,
  start: Date,
  end: Date,
  categoryMap?: Map<string, string>,
): Promise<MergedActivity[]> => {
  const result = await query(
    user,
    `SELECT a.id, a.source, a.external_id, a.activity_type, a.start_time, a.end_time, a.title, a.notes, a.data, a.deleted_at
     FROM activities a
     LEFT JOIN activity_type_definitions atd ON a.activity_type = atd.name
     WHERE a.deleted_at IS NULL
       AND a.start_time >= $1 AND a.start_time <= $2
       AND (atd.display_category IS NULL OR atd.display_category != 'sleep_rest')
     ORDER BY a.start_time`,
    [start, end],
  )
  const activities = result.rows.map(mapActivityRow)
  return mergeOverlappingActivities(activities, categoryMap)
}

/** Get all activities in a date range (all types, unmerged individual records). */
export const getAllActivitiesInRange = async (user: string, start: Date, end: Date): Promise<Activity[]> => {
  const result = await query(
    user,
    `SELECT id, source, external_id, activity_type, start_time, end_time, title, notes, data, deleted_at
     FROM activities WHERE deleted_at IS NULL AND start_time >= $1 AND start_time <= $2
     ORDER BY start_time`,
    [start, end],
  )
  return result.rows.map(mapActivityRow)
}

/** Hard-delete all activities from a given source. */
export const hardDeleteActivitiesBySource = async (user: string, source: string): Promise<number> => {
  const result = await query(user, `DELETE FROM activities WHERE source = $1`, [source])
  return result.rowCount ?? 0
}

/** Hard-delete activities by source and external_id prefix. */
export const hardDeleteActivitiesByExternalIdPrefix = async (
  user: string,
  source: string,
  prefix: string,
): Promise<number> => {
  const result = await query(user, `DELETE FROM activities WHERE source = $1 AND external_id LIKE $2`, [
    source,
    `${prefix}%`,
  ])
  return result.rowCount ?? 0
}

/** Find a mergeable activity of the same type near a given time.
 *  When matchData is provided, only matches activities whose data contains all the same key-value pairs. */
export const findMergeableActivity = async (
  user: string,
  activityType: string,
  startTime: Date,
  mergeSpanSeconds: number,
  source?: string,
  matchData?: Record<string, unknown>,
): Promise<Activity | null> => {
  const windowStart = new Date(startTime.getTime() - mergeSpanSeconds * 1000)
  const params: unknown[] = [activityType, windowStart, startTime]
  let nextParam = 4

  const clauses: string[] = []
  if (source) {
    clauses.push(`AND source = $${nextParam++}`)
    params.push(source)
  }
  if (matchData && Object.keys(matchData).length > 0) {
    clauses.push(`AND data @> $${nextParam++}::jsonb`)
    params.push(JSON.stringify(matchData))
  }

  const result = await query(
    user,
    `SELECT id, source, external_id, activity_type, start_time, end_time, title, notes, data, deleted_at
     FROM activities
     WHERE activity_type = $1
       AND deleted_at IS NULL
       AND (
         (end_time IS NOT NULL AND end_time >= $2 AND end_time <= $3)
         OR (end_time IS NULL AND start_time >= $2 AND start_time <= $3)
       )${clauses.join(' ')}
     ORDER BY COALESCE(end_time, start_time) DESC
     LIMIT 1`,
    params,
  )
  if (result.rows.length === 0) return null
  return mapActivityRow(result.rows[0])
}

/** Update an activity's end_time by external_id. */
export const updateActivityEndTimeByExternalId = async (
  user: string,
  externalId: string,
  endTime: Date,
): Promise<void> => {
  await query(user, `UPDATE activities SET end_time = $1 WHERE external_id = $2 AND deleted_at IS NULL`, [
    endTime,
    externalId,
  ])
}

/**
 * Update activity_type for all activities with a given tag_key in their data.
 * Used when a user renames a programmatic tag via tag mappings.
 */
export const updateActivityTypeByTagKey = async (
  user: string,
  tagKey: string,
  newActivityType: string,
): Promise<number> => {
  const result = await query(
    user,
    `UPDATE activities SET activity_type = $1 WHERE data->>'tag_key' = $2 AND deleted_at IS NULL`,
    [newActivityType, tagKey],
  )
  return result.rowCount ?? 0
}

/**
 * Migrate activities with generic 'exercise' type to their specific type.
 * Handles both legacy activity_type_key and HC exerciseTypeName fields.
 * Returns the number of activities updated.
 */
export const migrateExerciseTypes = async (user: string): Promise<number> => {
  // Step 1: activity_type_key path (legacy)
  const r1 = await query(
    user,
    `UPDATE activities
     SET activity_type = data->>'activity_type_key',
         data = data - 'activity_type_key'
     WHERE activity_type = 'exercise'
       AND data->>'activity_type_key' IS NOT NULL
       AND data->>'activity_type_key' != 'unknown'
       AND deleted_at IS NULL`,
  )

  // Step 2: exerciseTypeName path (Health Connect)
  const r2 = await query(
    user,
    `UPDATE activities
     SET activity_type = data->>'exerciseTypeName'
     WHERE activity_type = 'exercise'
       AND data->>'exerciseTypeName' IS NOT NULL
       AND data->>'exerciseTypeName' NOT IN ('other_workout', 'unknown')
       AND deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM activities a2
         WHERE a2.source = activities.source
           AND a2.activity_type = activities.data->>'exerciseTypeName'
           AND a2.start_time = activities.start_time
           AND a2.external_id IS NULL
           AND a2.id != activities.id
       )`,
  )

  return (r1.rowCount ?? 0) + (r2.rowCount ?? 0)
}
