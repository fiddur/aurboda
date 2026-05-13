/**
 * Activity merge logic: unifies duration activities with matching activity types.
 *
 * When a duration activity (e.g. "Holosync") overlaps >50% with a matching activity
 * (e.g. a meditation session from Oura), they are merged into one item instead
 * of showing as duplicates.
 */
import { format } from 'date-fns'

import type { Activity } from '../../state/api'
import type { ChartItem } from './types'

import { toDisplayName } from '../../utils/displayName'
import { resolveItemIcon } from '../../utils/emojiLookup'

/** Maps an activity type to the activity_type values it should merge with. */
export const ACTIVITY_TYPE_MERGE_MAP: Record<string, string[]> = {
  breathwork: ['meditation'],
  holosync: ['meditation', 'nap'],
  meditation: ['meditation'],
  yin_yoga: ['meditation', 'exercise'],
}

/**
 * Activity sources that should NOT be merged into built-in activity items.
 * They still appear in the Activity lane but as separate items.
 */
export const EXCLUDED_ACTIVITY_SOURCES = new Set(['lastfm'])

/**
 * Activity types that are rendered on dedicated timeline tracks and should
 * not appear in the main Activity lane.
 */
export const EXCLUDED_ACTIVITY_TYPES = new Set(['screentime', 'location_visit'])

/** Activity types that start with these prefixes are excluded from duration merging. */
export const EXCLUDED_ACTIVITY_PREFIXES = ['computer:']

/** Returns true if an activity (with end_time) should appear in the Activity lane. */
export const isDurationActivityLike = (activity: Activity): boolean => {
  if (!activity.end_time) return false
  if (activity.source && EXCLUDED_ACTIVITY_SOURCES.has(activity.source)) return false
  if (EXCLUDED_ACTIVITY_TYPES.has(activity.activity_type)) return false
  for (const prefix of EXCLUDED_ACTIVITY_PREFIXES) {
    if (activity.activity_type.startsWith(prefix)) return false
  }
  return true
}

/**
 * Overlap in minutes between two intervals.
 */
export const overlapMinutes = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number => {
  const start = Math.max(aStart.getTime(), bStart.getTime())
  const end = Math.min(aEnd.getTime(), bEnd.getTime())
  return Math.max(0, (end - start) / 60000)
}

/**
 * Try to merge a duration activity into an existing activity chart item.
 * Returns true if merged (the item is mutated in-place with an annotation).
 */
export const tryMergeActivityIntoItem = (activity: Activity, items: ChartItem[]): boolean => {
  const actEnd = activity.end_time!
  const mergeableTypes = ACTIVITY_TYPE_MERGE_MAP[activity.activity_type]
  if (!mergeableTypes) return false

  const displayName = activity.title ?? toDisplayName(activity.activity_type)

  for (const item of items) {
    if (!item.activity_type || !mergeableTypes.includes(item.activity_type)) continue
    const overlap = overlapMinutes(activity.start_time, actEnd, item.start, item.end)
    const actDuration = (actEnd.getTime() - activity.start_time.getTime()) / 60000
    if (overlap > actDuration * 0.5) {
      // Annotate the item tooltip with the merged activity name
      item.tooltip.details.push(`Also tagged: ${displayName}`)
      return true
    }
  }
  return false
}

export interface OverlapWarning {
  item1Label: string
  item1Time: string
  item2Label: string
  item2Time: string
  overlapMinutes: number
}

const formatTime = (d: Date) => format(d, 'HH:mm')

const formatDuration = (start: Date, end: Date): string => {
  const ms = end.getTime() - start.getTime()
  const totalMin = Math.round(ms / 60000)
  if (totalMin < 60) return `${totalMin}m`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

/** Duration activity colors — activities that appear in the Activity column */
export const DURATION_ACTIVITY_COLORS: Record<string, string> = {
  breathwork: '#a855f7',
  holosync: '#8b5cf6',
  hot_bath: '#f97316',
  sauna: '#ef4444',
  sex: '#ec4899',
  vocal_training: '#06b6d4',
  yin_yoga: '#a855f7',
}

const DURATION_ACTIVITY_DEFAULT_COLOR = '#f59e0b'

/**
 * Convert a duration activity into a ChartItem for the Activity column.
 * Also detects overlaps with existing items and records warnings.
 */
export const createDurationActivityItem = (
  activity: Activity,
  existingItems: ChartItem[],
  overlaps: OverlapWarning[],
  itemIcons: Record<string, string>,
  typeDefinitions?: Map<string, { icon?: string }>,
): ChartItem => {
  const actEnd = activity.end_time!
  const displayName = activity.title ?? toDisplayName(activity.activity_type)
  const icon =
    itemIcons[activity.activity_type] ??
    typeDefinitions?.get(activity.activity_type)?.icon ??
    itemIcons[displayName] ??
    itemIcons[displayName.toLowerCase()]

  // Detect overlaps with existing activity items
  let overlapWarning: string | undefined
  for (const item of existingItems) {
    if (item.isPoint) continue
    const mins = overlapMinutes(activity.start_time, actEnd, item.start, item.end)
    if (mins > 2) {
      const warning: OverlapWarning = {
        item1Label: displayName,
        item1Time: `${formatTime(activity.start_time)} – ${formatTime(actEnd)}`,
        item2Label: item.label,
        item2Time: item.tooltip.time,
        overlapMinutes: Math.round(mins),
      }
      overlaps.push(warning)
      overlapWarning = `Overlaps with ${item.label} by ${Math.round(mins)}m`
    }
  }

  return {
    activity_type: undefined,
    color: DURATION_ACTIVITY_COLORS[activity.activity_type] ?? DURATION_ACTIVITY_DEFAULT_COLOR,
    column: 'Activity',
    end: actEnd,
    entity_id: activity.id,
    entity_type: 'activity',
    icon,
    isPoint: false,
    label: displayName,
    start: activity.start_time,
    tooltip: {
      details: [formatDuration(activity.start_time, actEnd), ...(overlapWarning ? [overlapWarning] : [])],
      time: `${formatTime(activity.start_time)} – ${formatTime(actEnd)}`,
      title: displayName,
    },
  }
}

type ActivityMeta = {
  label: string
  color: string
  actType: string
}

/** Default colors and labels for built-in activity types. */
const BUILTIN_DEFAULTS: Record<string, { color: string; label: string }> = {
  meditation: { color: '#a855f7', label: 'Meditation' },
  nap: { color: '#60a5fa', label: 'Nap' },
  rest: { color: '#86efac', label: 'Rest' },
  sleep: { color: '#3b82f6', label: 'Sleep' },
}

/** Extract label, color, and activity type from an Activity. Returns null for unknown types. */
const getActivityMeta = (
  a: Activity,
  activityColors: Record<string, string>,
  exerciseColor: (a: Activity) => string,
  getExerciseTypeName: (a: Activity) => string,
  typeDefinitions?: Map<string, { display_name: string; color: string; icon?: string }>,
): ActivityMeta | null => {
  const type = a.activity_type
  if (!type) return null

  // Exercise has special label/color logic
  if (type === 'exercise') {
    return { actType: 'exercise', color: exerciseColor(a), label: getExerciseTypeName(a) }
  }

  // Built-in non-exercise types
  const builtin = BUILTIN_DEFAULTS[type]
  if (builtin) {
    return {
      actType: type,
      color: activityColors[type] ?? builtin.color,
      label: (type === 'rest' || type === 'meditation' ? a.title : undefined) || builtin.label,
    }
  }

  // Custom activity type — look up definition for display metadata
  const def = typeDefinitions?.get(type)
  if (!def) return null
  return { actType: type, color: activityColors[type] ?? def.color, label: a.title || def.display_name }
}

/** Build tooltip details for an activity item. */
const buildActivityDetails = (
  a: Activity,
  end: Date,
  buildSleepDetails: (a: Activity, end: Date) => string[],
  scrobbles: { artist: string; recorded_at: Date; track: string }[],
): string[] => {
  const details: string[] =
    a.activity_type === 'sleep'
      ? buildSleepDetails(a, end)
      : [formatDuration(a.start_time, end), ...(a.avg_hrv ? [`Avg HRV: ${a.avg_hrv} ms`] : [])]

  // User-typed comments (source-less) used to live on activity.notes — they
  // now arrive in `comments`. Synced comments (HC, Oura) are deliberately
  // skipped here to keep tooltip text user-driven.
  if (a.comments) {
    for (const c of a.comments) {
      if (!c.source) details.push(c.content)
    }
  }

  if (a.activity_type === 'meditation') {
    const music = scrobbles
      .filter((s) => {
        const trackEnd = new Date(s.recorded_at.getTime() + 3.5 * 60 * 1000)
        return s.recorded_at < end && trackEnd > a.start_time
      })
      .map((s) => `${s.artist} – ${s.track}`)
    if (music.length > 0) details.push(`♪ ${music.slice(0, 3).join(', ')}`)
  }

  // Hierarchy-collapsed bars (#657): surface the constituent sub-types so
  // a single "exercise" bar reveals it was actually running + strength + yoga.
  const mergedLine = formatCollapsedTypesLine(a.collapsed_types)
  if (mergedLine) details.push(mergedLine)

  return details
}

/**
 * Build the unified Activity column items from activities + non-builtin activities.
 * Activities are first; then duration activities are either merged into matching
 * activities (same event, dual source) or added as separate items.
 *
 * Returns the items list and any overlap warnings for display in UI.
 */
/**
 * Resolve the icon key for an activity based on its type.
 * - For exercise: "exercise:{TypeName}" (e.g. "exercise:Running")
 * - For other activity types: "activity:{type}" (e.g. "activity:sleep")
 */
const getActivityIconKey = (a: Activity, getExerciseTypeName: (a: Activity) => string): string => {
  if (a.activity_type === 'exercise') {
    return `exercise:${getExerciseTypeName(a)}`
  }
  return `activity:${a.activity_type}`
}

// ============================================================================
// Zoom-aware merging: bridge small gaps between same-key activities, and
// optionally collapse sibling sub-types into their parent_type when zoomed
// out far enough that sub-type detail is noise.
// ============================================================================

/** Default gap below which two adjacent same-parent activities merge. */
export const COLLAPSE_MERGE_GAP_MS = 30 * 60 * 1000 // 30 minutes

/**
 * Format a `collapsed_types` provenance list as a tooltip line. Used by both
 * the Activity-lane (`buildActivityDetails`) and Screen-Time-lane
 * (`categorizeScreentimeActivities`) tooltip builders. Returns undefined when
 * there's nothing to show — a single-entry provenance is still informative
 * (the parent bar is one sub-type only) so we keep that case.
 */
export const formatCollapsedTypesLine = (
  collapsedTypes: { type: string; count: number }[] | undefined,
): string | undefined => {
  if (!collapsedTypes || collapsedTypes.length < 1) return undefined
  const labels = collapsedTypes.map((e) => {
    const display = toDisplayName(e.type)
    return e.count > 1 ? `${display} ×${e.count}` : display
  })
  return `Merged: ${labels.join(', ')}`
}

/**
 * Look up the immediate parent_type of a type — the "collapse target" we
 * fold child activities into. Returns null when the type has no parent,
 * or when the referenced parent isn't itself a known type definition
 * (stale/orphaned parent_type values shouldn't retype activities to
 * something downstream rendering can't resolve).
 */
export const resolveCollapseTarget = (
  typeName: string,
  typeDefsByName: ReadonlyMap<string, { parent_type?: string }>,
): string | null => {
  const def = typeDefsByName.get(typeName)
  const parent = def?.parent_type
  if (!parent || !typeDefsByName.has(parent)) return null
  return parent
}

/**
 * Return the chain of ancestors for a type, ordered child→root, including the
 * input type itself. Cycle-guarded; an unknown ancestor terminates the walk.
 *
 *   running → exercise → activity   ⇒  ['running', 'exercise', 'activity']
 *   meditation                       ⇒  ['meditation']
 *   unknown                          ⇒  ['unknown']
 */
export const ancestorChain = (
  typeName: string,
  typeDefsByName: ReadonlyMap<string, { parent_type?: string }>,
): string[] => {
  const chain: string[] = [typeName]
  const visited = new Set<string>([typeName])
  let current: string | null = typeName
  while (current) {
    const next = resolveCollapseTarget(current, typeDefsByName)
    if (!next || visited.has(next)) break
    chain.push(next)
    visited.add(next)
    current = next
  }
  return chain
}

/** Return the top-level ancestor (root of parent_type chain). Falls back to the input on cycle/missing. */
export const rootTypeOf = (
  typeName: string,
  typeDefsByName: ReadonlyMap<string, { parent_type?: string }>,
): string => {
  const chain = ancestorChain(typeName, typeDefsByName)
  return chain[chain.length - 1]
}

/**
 * Merge adjacent activities sharing a key (computed by `keyFn`) when their
 * start-to-previous-end gap is ≤ `mergeGapMs`. Different keys never merge,
 * so we can never collapse two distinct activity types into one bar — the
 * user can still click each to edit.
 *
 * Pure: does not mutate inputs. The first member's id/title win; end_time
 * is extended to the max across merged members so an overlapping span from
 * a second source folds in cleanly.
 */
export const mergeAdjacentByKey = (
  activities: Activity[],
  keyFn: (a: Activity) => string,
  mergeGapMs: number,
): Activity[] => {
  if (activities.length === 0) return [...activities]
  const sorted = [...activities].sort((a, b) => a.start_time.getTime() - b.start_time.getTime())
  const merged: Activity[] = []
  for (const current of sorted) {
    const prev = merged[merged.length - 1]
    if (
      prev &&
      keyFn(prev) === keyFn(current) &&
      prev.end_time &&
      current.end_time &&
      current.start_time.getTime() - prev.end_time.getTime() <= mergeGapMs
    ) {
      if (current.end_time > prev.end_time) prev.end_time = current.end_time
      continue
    }
    merged.push({ ...current })
  }
  return merged
}

/**
 * Walk the ancestor chain capped at `depth` hops. depth=1 returns the
 * immediate parent (the common case); depth=Infinity walks to the root.
 * Returns the input type when no walk can happen.
 *
 * The depth=1 fast path uses `resolveCollapseTarget` directly to avoid
 * building a full ancestor chain we'd immediately discard.
 */
const collapseTargetAtDepth = (
  typeName: string,
  typeDefsByName: ReadonlyMap<string, { parent_type?: string }>,
  depth: number,
): string => {
  if (depth <= 0) return typeName
  if (depth === 1) return resolveCollapseTarget(typeName, typeDefsByName) ?? typeName
  const chain = ancestorChain(typeName, typeDefsByName)
  // chain[0] is typeName itself; ancestors at indices 1..chain.length-1.
  const targetIndex = Math.min(depth, chain.length - 1)
  return chain[targetIndex]
}

/**
 * Pure: returns a new list with `type` accounted for. Either bumps the
 * existing entry's count or appends a fresh `{ type, count: 1 }`. Never
 * mutates the input — important because `Activity.collapsed_types` may end
 * up shared across memoized references in a future iteration.
 */
const recordCollapsedType = (
  list: { type: string; count: number }[],
  type: string,
): { type: string; count: number }[] => {
  const idx = list.findIndex((e) => e.type === type)
  if (idx === -1) return [...list, { type, count: 1 }]
  return list.map((e, i) => (i === idx ? { ...e, count: e.count + 1 } : e))
}

/**
 * Collapse adjacent activities up to `depth` levels of parent_type into a
 * single bar.
 *
 *   1. Re-type each activity to its ancestor at the requested depth.
 *      depth=0: no walk (max-zoom; sibling sub-types stay distinct and
 *      individually clickable). depth=1: one hop (warmup_run → exercise).
 *      depth=Infinity: walk to root.
 *   2. Merge adjacent activities with the same effective type whose gap is
 *      within `mergeGapMs`. Identical sub-types still merge at depth=0 (a
 *      comb of consecutive `running` slivers folds to one).
 *
 * The synthetic survivor of a multi-child collapse carries `collapsed_types`
 * with the original child types and counts (deduped, ordered by first
 * appearance) — used by the tooltip enrichment in #657.
 */
// eslint-disable-next-line complexity -- single-pass merge with provenance accumulation; splitting hurts readability
export const collapseToParentType = (
  activities: Activity[],
  typeDefsByName: ReadonlyMap<string, { parent_type?: string }>,
  mergeGapMs: number = COLLAPSE_MERGE_GAP_MS,
  depth = 1,
): Activity[] => {
  if (activities.length === 0) return activities

  // Retype each activity to its target effective type, remembering the
  // original sub-type for provenance.
  const retyped = activities.map((a) => {
    const effective =
      depth > 0 ? collapseTargetAtDepth(a.activity_type, typeDefsByName, depth) : a.activity_type
    if (effective === a.activity_type) {
      return { ...a }
    }
    return { ...a, activity_type: effective, collapsed_types: [{ type: a.activity_type, count: 1 }] }
  })

  // Merge adjacent same-effective-type spans, accumulating provenance from
  // any participants that already carried one.
  if (retyped.length === 0) return retyped
  const sorted = [...retyped].sort((a, b) => a.start_time.getTime() - b.start_time.getTime())
  const merged: Activity[] = []
  for (const current of sorted) {
    const prev = merged[merged.length - 1]
    if (
      prev &&
      prev.activity_type === current.activity_type &&
      prev.end_time &&
      current.end_time &&
      current.start_time.getTime() - prev.end_time.getTime() <= mergeGapMs
    ) {
      if (current.end_time > prev.end_time) prev.end_time = current.end_time
      const incoming = current.collapsed_types ?? [{ type: current.activity_type, count: 1 }]
      let provenance = prev.collapsed_types ?? [{ type: prev.activity_type, count: 1 }]
      for (const entry of incoming) {
        for (let i = 0; i < entry.count; i++) provenance = recordCollapsedType(provenance, entry.type)
      }
      prev.collapsed_types = provenance
      continue
    }
    merged.push({ ...current })
  }
  // Drop trivial provenance: a survivor whose only entry matches its own
  // type carries no useful merge signal (single sub-type wasn't mixed).
  for (const m of merged) {
    if (
      m.collapsed_types &&
      m.collapsed_types.length === 1 &&
      m.collapsed_types[0].type === m.activity_type
    ) {
      delete m.collapsed_types
    }
  }
  return merged
}

/**
 * Merge adjacent screentime activities that share the same category_path.
 * `screentime` activities all share `activity_type='screentime'`, so the
 * discriminator must come from `data.category_path` — otherwise Communication
 * and Coding would get folded together. Source is intentionally NOT part of
 * the key: when both rescuetime and activitywatch report the same category
 * for an overlapping window we want one visual bar, not two.
 */
export const mergeScreentimeActivities = (activities: Activity[], mergeGapMs: number): Activity[] =>
  mergeAdjacentByKey(
    activities,
    (a) => {
      const path = typeof a.data?.category_path === 'string' ? a.data.category_path : ''
      return `screentime:${path}`
    },
    mergeGapMs,
  )

export const buildActivityColumnItems = (
  activities: Activity[],
  secondaryActivities: Activity[],
  itemIcons: Record<string, string>,
  activityColors: Record<string, string>,
  exerciseColor: (a: Activity) => string,
  getExerciseTypeName: (a: Activity) => string,
  sleepMetricsByDate: Map<string, Record<string, number>>,
  buildSleepDetails: (a: Activity, end: Date) => string[],
  scrobbles: { artist: string; track: string; recorded_at: Date }[],
  typeDefinitions?: Map<string, { display_name: string; color: string; icon?: string }>,
): { items: ChartItem[]; overlaps: OverlapWarning[] } => {
  const items: ChartItem[] = []
  const overlaps: OverlapWarning[] = []

  // 1. Convert activities to ChartItems
  for (const a of activities) {
    const meta = getActivityMeta(a, activityColors, exerciseColor, getExerciseTypeName, typeDefinitions)
    if (!meta) continue

    const end = a.end_time ?? new Date(a.start_time.getTime() + 60 * 60000)
    const details = buildActivityDetails(a, end, buildSleepDetails, scrobbles)

    // Resolve icon from user overrides, defaults, or type definition.
    // For migrated exercise types (e.g., activity_type='yoga' was previously 'exercise'
    // with exerciseType=yoga), also check the legacy "exercise:{TypeName}" icon key.
    const iconKey = getActivityIconKey(a, getExerciseTypeName)
    const formattedType = a.activity_type.replaceAll('_', ' ').replaceAll(/\b\w/g, (c) => c.toUpperCase())
    const icon =
      resolveItemIcon(iconKey, itemIcons) ??
      resolveItemIcon(`exercise:${formattedType}`, itemIcons) ??
      typeDefinitions?.get(a.activity_type)?.icon

    items.push({
      activity_type: meta.actType,
      color: meta.color,
      column: 'Activity',
      end,
      entity_id: a.id,
      entity_type: 'activity',
      icon,
      isPoint: false,
      label: meta.label,
      start: a.start_time,
      tooltip: {
        details,
        time: `${formatTime(a.start_time)} – ${formatTime(end)}`,
        title: meta.label,
      },
    })
  }

  // 2. Handle secondary activities (non-main categories like custom types)
  const durationActivities = secondaryActivities.filter(isDurationActivityLike)

  for (const act of durationActivities) {
    const merged = tryMergeActivityIntoItem(act, items)
    if (!merged) {
      items.push(createDurationActivityItem(act, items, overlaps, itemIcons, typeDefinitions))
    }
  }

  return { items, overlaps }
}
