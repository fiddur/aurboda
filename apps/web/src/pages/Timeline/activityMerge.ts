/**
 * Activity merge logic: unifies duration tags with matching activity types.
 *
 * When a duration tag (e.g. "Holosync") overlaps >50% with a matching activity
 * (e.g. a meditation session from Oura), they are merged into one item instead
 * of showing as duplicates.
 */
import { format } from 'date-fns'

import type { Activity, Tag } from '../../state/api'
import type { ChartItem } from './types'

import { resolveItemIcon } from '../../utils/emojiLookup'

/** Maps a tag name to the activity_type values it should merge with. */
export const TAG_ACTIVITY_MERGE_MAP: Record<string, string[]> = {
  Breathwork: ['meditation'],
  Holosync: ['meditation', 'nap'],
  Meditation: ['meditation'],
  YinYoga: ['meditation', 'exercise'],
}

/**
 * Tag sources that should NOT be pulled into the Activity lane.
 * These are always shown in the Tags column.
 */
export const EXCLUDED_TAG_SOURCES = new Set(['lastfm', 'lastfm-auto'])

/** Tags that start with these prefixes should stay in the Tags column. */
export const EXCLUDED_TAG_PREFIXES = ['computer:']

/** Returns true if a tag (with end_time) should appear in the Activity lane. */
export const isDurationTagActivityLike = (tag: Tag): boolean => {
  if (!tag.end_time) return false
  if (tag.source && EXCLUDED_TAG_SOURCES.has(tag.source)) return false
  for (const prefix of EXCLUDED_TAG_PREFIXES) {
    if (tag.tag.startsWith(prefix)) return false
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
 * Try to merge a duration tag into an existing activity chart item.
 * Returns true if merged (the item is mutated in-place with an annotation).
 */
export const tryMergeTagIntoActivity = (tag: Tag, items: ChartItem[]): boolean => {
  const tagEnd = tag.end_time!
  const mergeableTypes = TAG_ACTIVITY_MERGE_MAP[tag.tag]
  if (!mergeableTypes) return false

  for (const item of items) {
    if (!item.activity_type || !mergeableTypes.includes(item.activity_type)) continue
    const overlap = overlapMinutes(tag.start_time, tagEnd, item.start, item.end)
    const tagDuration = (tagEnd.getTime() - tag.start_time.getTime()) / 60000
    if (overlap > tagDuration * 0.5) {
      // Annotate the item tooltip with the merged tag name
      item.tooltip.details.push(`Also tagged: ${tag.tag}`)
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

/** Duration tag colors — tags that appear in the Activity column */
export const DURATION_TAG_COLORS: Record<string, string> = {
  Breathwork: '#a855f7',
  Holosync: '#8b5cf6',
  'Hot Bath': '#f97316',
  Sauna: '#ef4444',
  Sex: '#ec4899',
  'Vocal Training': '#06b6d4',
  YinYoga: '#a855f7',
}

const DURATION_TAG_DEFAULT_COLOR = '#f59e0b'

/**
 * Convert a duration tag into a ChartItem for the Activity column.
 * Also detects overlaps with existing items and records warnings.
 */
export const createDurationTagItem = (
  tag: Tag,
  existingItems: ChartItem[],
  overlaps: OverlapWarning[],
  itemIcons: Record<string, string>,
): ChartItem => {
  const tagEnd = tag.end_time!
  const icon =
    itemIcons[tag.tag] ??
    itemIcons[tag.tag.toLowerCase()] ??
    (tag.tag_key ? itemIcons[tag.tag_key] : undefined)

  // Detect overlaps with existing activity items
  let overlapWarning: string | undefined
  for (const item of existingItems) {
    if (item.isPoint) continue
    const mins = overlapMinutes(tag.start_time, tagEnd, item.start, item.end)
    if (mins > 2) {
      const warning: OverlapWarning = {
        item1Label: tag.tag,
        item1Time: `${formatTime(tag.start_time)} – ${formatTime(tagEnd)}`,
        item2Label: item.label,
        item2Time: item.tooltip.time,
        overlapMinutes: Math.round(mins),
      }
      overlaps.push(warning)
      overlapWarning = `Overlaps with ${item.label} by ${Math.round(mins)}m`
    }
  }

  const href = tag.tag_definition_id ? `/tag/${tag.tag_definition_id}` : undefined

  return {
    activity_type: undefined,
    color: DURATION_TAG_COLORS[tag.tag] ?? DURATION_TAG_DEFAULT_COLOR,
    column: 'Activity',
    end: tagEnd,
    entity_id: href ? undefined : tag.id,
    entity_type: href ? undefined : 'tag',
    href,
    icon,
    isPoint: false,
    label: tag.tag,
    start: tag.start_time,
    tooltip: {
      details: [formatDuration(tag.start_time, tagEnd), ...(overlapWarning ? [overlapWarning] : [])],
      time: `${formatTime(tag.start_time)} – ${formatTime(tagEnd)}`,
      title: tag.tag,
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
  typeDefinitions?: Map<string, { display_name: string; color: string }>,
): ActivityMeta | null => {
  const type = a.activity_type
  if (!type) return null

  // Exercise has special label/color logic
  if (type === 'exercise') return { actType: 'exercise', color: exerciseColor(a), label: getExerciseTypeName(a) }

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
 * Build the unified Activity column items from activities + duration tags.
 * Activities are first; then duration tags are either merged into matching
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
  tags: Tag[],
  itemIcons: Record<string, string>,
  activityColors: Record<string, string>,
  exerciseColor: (a: Activity) => string,
  getExerciseTypeName: (a: Activity) => string,
  sleepMetricsByDate: Map<string, Record<string, number>>,
  buildSleepDetails: (a: Activity, end: Date) => string[],
  scrobbles: { artist: string; track: string; recorded_at: Date }[],
  typeDefinitions?: Map<string, { display_name: string; color: string }>,
): { items: ChartItem[]; overlaps: OverlapWarning[] } => {
  const items: ChartItem[] = []
  const overlaps: OverlapWarning[] = []

  // 1. Convert activities to ChartItems
  for (const a of activities) {
    const meta = getActivityMeta(a, activityColors, exerciseColor, getExerciseTypeName, typeDefinitions)
    if (!meta) continue

    const end = a.end_time ?? new Date(a.start_time.getTime() + 60 * 60000)
    const details = buildActivityDetails(a, end, buildSleepDetails, scrobbles)

    // Resolve icon from user overrides or defaults
    const iconKey = getActivityIconKey(a, getExerciseTypeName)
    const icon = resolveItemIcon(iconKey, itemIcons)

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

  // 2. Handle duration tags
  const durationTags = tags.filter(isDurationTagActivityLike)

  for (const tag of durationTags) {
    const merged = tryMergeTagIntoActivity(tag, items)
    if (!merged) {
      items.push(createDurationTagItem(tag, items, overlaps, itemIcons))
    }
  }

  return { items, overlaps }
}
