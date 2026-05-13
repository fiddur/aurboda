/**
 * Pure merge logic for activities. Two passes:
 * 1. Cross-source merge — collapse near-simultaneous activities from different
 *    sync sources using priority-based winner selection.
 * 2. Same-type merge + generic exercise absorption.
 *
 * No database access; this module is straightforward to unit test.
 */
import type { Activity, MergedActivity } from '../types.ts'

// =============================================================================
// Cross-source merge: collapse near-simultaneous activities from different
// sync sources into a single activity using priority-based winner selection.
// =============================================================================

/** Max start_time difference (ms) for cross-source merge eligibility. */
const CROSS_MERGE_THRESHOLD_MS = 120_000

/** Sources that track physical activities and are eligible for cross-source merge. */
export const CROSS_MERGE_SOURCES = new Set([
  'aurboda',
  'deduction-rule',
  'garmin',
  'health_connect',
  'manual',
  'oura',
  'strava',
])

/** Display categories whose activities can cross-merge with each other. */
const CROSS_MERGEABLE_CATEGORIES = new Set(['exercise', 'meditation', 'wellness'])

/**
 * Higher number = higher priority when picking the cross-merge winner.
 * Ranking rationale (low → high):
 *   health_connect — generic aggregator; often duplicated by a specific source
 *   oura — activity detection is inferred from sensors, not explicit
 *   strava — explicit exercise entry, but usually downstream of Garmin
 *   garmin — raw device data, richest metrics
 *   deduction-rule / manual — explicit user intent
 *   aurboda — edited inside the app, most authoritative
 */
const SOURCE_PRIORITY: Record<string, number> = {
  health_connect: 1,
  oura: 2,
  strava: 3,
  garmin: 4,
  'deduction-rule': 5,
  manual: 6,
  aurboda: 7,
}

const getEffectivePriority = (a: Activity): number => {
  const base = SOURCE_PRIORITY[a.source] ?? 0
  const edited = a.data?._user_edited
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

/** True when one of the two activities is an aurboda override targeting the other. */
const isOverrideLinked = (a: Activity, b: Activity): boolean => {
  if (a.override_target_ids && b.id && a.override_target_ids.includes(b.id)) return true
  if (b.override_target_ids && a.id && b.override_target_ids.includes(a.id)) return true
  return false
}

/** Check if two activities are eligible for cross-source merge. */
const isCrossMergePair = (a: Activity, b: Activity, categoryMap: Map<string, string>): boolean => {
  if (!CROSS_MERGE_SOURCES.has(b.source)) return false
  if (a.source === b.source) return false
  // Override link forces a cross-merge pair regardless of type/category — the
  // aurboda override carries the user's chosen type, which may match (notes-
  // only edit) or differ from the synced row.
  if (isOverrideLinked(a, b)) return true
  if (a.activity_type === b.activity_type) return false
  const catB = categoryMap.get(b.activity_type)
  return !!catB && CROSS_MERGEABLE_CATEGORIES.has(catB)
}

/** Pick the override row that should be forced as winner, if any. */
const pickOverrideWinner = (members: Activity[]): Activity | undefined => {
  const memberIds = new Set(members.map((m) => m.id).filter((id): id is string => !!id))
  const overrides = members.filter(
    (m) => m.source === 'aurboda' && m.override_target_ids?.some((tid) => memberIds.has(tid)),
  )
  if (overrides.length === 0) return undefined
  if (overrides.length > 1) {
    console.warn(
      `merge: ${overrides.length} overrides in one group, picking earliest start_time. ids=${overrides.map((o) => o.id).join(',')}`,
    )
  }
  return overrides.reduce((acc, o) => (o.start_time < acc.start_time ? o : acc))
}

/** Merge a group of activities into one, using priority-based winner selection. */
// eslint-disable-next-line complexity -- single-pass winner selection + field blending; splitting hurts readability
const mergeGroupByPriority = (members: Activity[]): MergedActivity => {
  // An aurboda override row referencing any group member must win regardless
  // of computed priority — overrides are explicit user intent.
  const overrideWinner = pickOverrideWinner(members)
  const sorted = [...members].sort((a, b) => {
    if (overrideWinner) {
      if (a === overrideWinner) return -1
      if (b === overrideWinner) return 1
    }
    return (
      getEffectivePriority(b) - getEffectivePriority(a) || a.start_time.getTime() - b.start_time.getTime()
    )
  })

  const winner: MergedActivity = { ...sorted[0] }
  const sourceIds: string[] = []

  for (const member of sorted) {
    if (member.id) sourceIds.push(member.id)

    // Field blending below mirrors "two sources reporting the same physical
    // session" semantics — extend the time span, fill missing title from a
    // sibling, concat notes. That's wrong when the winner is a user-typed
    // override: the user's edits to start/end/title/notes are explicit
    // intent, not "missing data to fill in from the source." Skip blending
    // for override winners. Other winners (cross-source priority) still
    // blend so e.g. a Garmin/Polar pairing extends to the union of times.
    if (overrideWinner) continue

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
/**
 * Index override rows by target id to enable category-bypass and cross-window
 * pairing. Each target maps to the override that claims it; the
 * UNIQUE-on-target-id constraint in `activity_override_targets` guarantees
 * at most one override per target.
 */
const indexOverrides = (sorted: Activity[]): Map<string, number> => {
  const map = new Map<string, number>()
  for (let i = 0; i < sorted.length; i++) {
    const ov = sorted[i]
    if (ov.source === 'aurboda' && ov.override_target_ids) {
      for (const targetId of ov.override_target_ids) map.set(targetId, i)
    }
  }
  return map
}

/** Whether row `a` is eligible to be a cross-merge anchor (outer-loop seed). */
const eligibleAnchor = (
  a: Activity,
  categoryMap: Map<string, string>,
  overrideByTargetId: Map<string, number>,
): boolean => {
  if (!CROSS_MERGE_SOURCES.has(a.source)) return false
  const isOverride = a.source === 'aurboda' && !!a.override_target_ids?.length
  const targetedByOverride = a.id !== undefined && overrideByTargetId.has(a.id)
  if (isOverride || targetedByOverride) return true
  const catA = categoryMap.get(a.activity_type)
  return !!catA && CROSS_MERGEABLE_CATEGORIES.has(catA)
}

/**
 * Pair anchor i against subsequent rows in the same time window. The
 * override↔target union is handled explicitly (regardless of time drift); the
 * inner loop still respects the 120 s window so an override doesn't sweep up
 * unrelated cross-mergeable activities later in the day.
 */
const pairAnchor = (
  i: number,
  sorted: Activity[],
  categoryMap: Map<string, string>,
  idToIndex: Map<string, number>,
  parent: number[],
  rank: number[],
) => {
  const a = sorted[i]
  if (a.source === 'aurboda' && a.override_target_ids?.length) {
    // Union the override with EVERY target it claims — even when the targets
    // sit far apart in the sort (e.g. Garmin at 10:00, Strava at 10:01).
    // The 120s inner-loop window doesn't help when one target is 10 minutes
    // away from the override's own start_time.
    for (const targetId of a.override_target_ids) {
      const targetIdx = idToIndex.get(targetId)
      if (targetIdx !== undefined) ufUnion(parent, rank, i, targetIdx)
    }
  }
  for (let j = i + 1; j < sorted.length; j++) {
    if (sorted[j].start_time.getTime() - a.start_time.getTime() > CROSS_MERGE_THRESHOLD_MS) break
    if (isCrossMergePair(a, sorted[j], categoryMap)) ufUnion(parent, rank, i, j)
  }
}

const buildGroups = (parent: number[], len: number): Map<number, number[]> => {
  const groups = new Map<number, number[]>()
  for (let i = 0; i < len; i++) {
    const root = ufFind(parent, i)
    const group = groups.get(root)
    if (group) group.push(i)
    else groups.set(root, [i])
  }
  return groups
}

const mergeCrossSources = (activities: Activity[], categoryMap: Map<string, string>): MergedActivity[] => {
  if (activities.length <= 1) return activities.map((a) => ({ ...a }))

  const sorted = [...activities].sort((a, b) => a.start_time.getTime() - b.start_time.getTime())
  const parent = sorted.map((_, i) => i)
  const rank = sorted.map(() => 0)
  const overrideByTargetId = indexOverrides(sorted)
  const idToIndex = new Map<string, number>()
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].id) idToIndex.set(sorted[i].id!, i)
  }

  for (let i = 0; i < sorted.length; i++) {
    if (!eligibleAnchor(sorted[i], categoryMap, overrideByTargetId)) continue
    pairAnchor(i, sorted, categoryMap, idToIndex, parent, rank)
  }

  const groups = buildGroups(parent, sorted.length)
  const result: MergedActivity[] = []
  for (const indices of groups.values()) {
    if (indices.length === 1) result.push({ ...sorted[indices[0]] })
    else result.push(mergeGroupByPriority(indices.map((i) => sorted[i])))
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

const isGenericExercise = (a: MergedActivity): boolean => a.activity_type === 'exercise'

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

/** Cheap eligibility check: activity is a candidate for cross-source/same-type merge. */
export const isSupersedable = (a: Activity): boolean => CROSS_MERGE_SOURCES.has(a.source)
