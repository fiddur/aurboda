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
export const EXCLUDED_ACTIVITY_SOURCES = new Set(['lastfm', 'lastfm-auto'])

/** Activity types that start with these prefixes are excluded from duration merging. */
export const EXCLUDED_ACTIVITY_PREFIXES = ['computer:']

/** Returns true if an activity (with end_time) should appear in the Activity lane. */
export const isDurationActivityLike = (activity: Activity): boolean => {
  if (!activity.end_time) return false
  if (activity.source && EXCLUDED_ACTIVITY_SOURCES.has(activity.source)) return false
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
    itemIcons[displayName] ??
    itemIcons[displayName.toLowerCase()] ??
    itemIcons[activity.activity_type] ??
    typeDefinitions?.get(activity.activity_type)?.icon

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

  if (a.notes) details.push(a.notes)

  if (a.activity_type === 'meditation') {
    const music = scrobbles
      .filter((s) => {
        const trackEnd = new Date(s.recorded_at.getTime() + 3.5 * 60 * 1000)
        return s.recorded_at < end && trackEnd > a.start_time
      })
      .map((s) => `${s.artist} – ${s.track}`)
    if (music.length > 0) details.push(`♪ ${music.slice(0, 3).join(', ')}`)
  }

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

export const buildActivityColumnItems = (
  activities: Activity[],
  tagActivities: Activity[],
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
    // For exercises, also check the sub-type key (e.g. "strength_training") in type definitions.
    const iconKey = getActivityIconKey(a, getExerciseTypeName)
    const exerciseSubType = a.activity_type === 'exercise'
      ? (a.data as Record<string, unknown> | undefined)?.activity_type_key as string | undefined
      : undefined
    const icon = resolveItemIcon(iconKey, itemIcons)
      ?? (exerciseSubType && typeDefinitions?.get(exerciseSubType)?.icon)
      ?? typeDefinitions?.get(a.activity_type)?.icon

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

  // 2. Handle duration activities (non-builtin)
  const durationActivities = tagActivities.filter(isDurationActivityLike)

  for (const act of durationActivities) {
    const merged = tryMergeActivityIntoItem(act, items)
    if (!merged) {
      items.push(createDurationActivityItem(act, items, overlaps, itemIcons, typeDefinitions))
    }
  }

  return { items, overlaps }
}
