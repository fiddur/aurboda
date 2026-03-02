/* eslint-disable max-lines -- TODO: refactor */
import { Signal, signal } from '@preact/signals'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import * as d3 from 'd3'
import { addDays, endOfDay, format, formatISO, startOfDay, subDays } from 'date-fns'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  Activity,
  fetchActivities,
  fetchHeartRate,
  fetchHrv,
  fetchPlaces,
  fetchProductivity,
  fetchTagMappings,
  fetchTags,
  Place,
  ProductivityRecord,
  Tag,
} from '../../state/api'
import { preprocessData } from '../../utils/chart'
import { isEmoji, isUrl } from '../../utils/emojiLookup'
import { packLanes } from '../../utils/lanePacking'

import './style.css'

// ── Types ─────────────────────────────────────────────────────────────────────

/** A unified item in the Activity lane: activities + duration tags merged together. */
interface ActivityLaneItem {
  id: string
  start: Date
  end: Date
  label: string
  color: string
  opacity: number
  type: 'sleep' | 'nap' | 'meditation' | 'exercise' | 'duration-tag'
  icon?: string
  /** Original source for dedup detection */
  source?: string
  /** Merged annotation: if this item subsumes a tag that represents the same real-world event */
  mergedAnnotations?: string[]
  /** Warning about overlaps for user notification */
  overlapWarning?: string
  tooltipTitle: string
  tooltipTime: string
  tooltipDetails?: string
}

interface TooltipState {
  visible: boolean
  x: number
  y: number
  content: {
    title: string
    time: string
    value?: string
    warning?: string
  }
}

// ── Signals ───────────────────────────────────────────────────────────────────

const fromDate = signal(formatISO(subDays(new Date(), 1), { representation: 'date' }))
const toDate = signal(formatISO(new Date(), { representation: 'date' }))
const viewStart = signal<Date | null>(null)
const viewEnd = signal<Date | null>(null)

// Toggle signals for data layers
const showHeartRate = signal(true)
const showHrv = signal(true)
const showActivities = signal(true)
const showProductivity = signal(true)
const showPlaces = signal(true)
const showTags = signal(true)

// ── Colors ────────────────────────────────────────────────────────────────────

const colors = {
  axis: 'currentColor',
  computer: '#3b82f6',
  durationTag: '#f59e0b', // Amber for duration tags in activity lane
  exercise: '#22c55e',
  heartRate: '#ef4444',
  hrv: '#10b981',
  meditation: '#a855f7',
  mobile: '#06b6d4',
  nap: '#60a5fa',
  sleep: '#3b82f6',
  tags: 'rgba(156, 163, 175, 0.5)',
  travel: '#9ca3af',
}

const placeColorPalette = [
  '#f59e0b',
  '#10b981',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#f97316',
  '#84cc16',
  '#6366f1',
]

const exerciseColorPalette = [
  '#22c55e',
  '#f97316',
  '#3b82f6',
  '#ec4899',
  '#8b5cf6',
  '#14b8a6',
  '#eab308',
  '#ef4444',
]

// Tag-specific colors for the activity lane
const durationTagColors: Record<string, string> = {
  Breathwork: '#06b6d4', // Cyan
  'Cold Exposure': '#38bdf8', // Sky
  Holosync: '#a78bfa', // Violet (similar to meditation)
  'Hot Bath': '#f97316', // Orange
  Meditation: '#a855f7', // Purple (same as activity meditation)
  Sauna: '#ef4444', // Red
  Sex: '#ec4899', // Pink
  'Vocal Training': '#14b8a6', // Teal
  YinYoga: '#c084fc', // Light purple
}

// ── HealthConnect exercise type mapping ───────────────────────────────────────

const exerciseTypeNames: Record<number, string> = {
  0: 'Workout',
  2: 'Badminton',
  4: 'Baseball',
  5: 'Basketball',
  8: 'Biking',
  9: 'Biking (Stationary)',
  10: 'Boot Camp',
  11: 'Boxing',
  13: 'Calisthenics',
  14: 'Cricket',
  16: 'Dancing',
  25: 'Elliptical',
  26: 'Fencing',
  27: 'Football (American)',
  28: 'Football (Australian)',
  29: 'Frisbee',
  30: 'Golf',
  31: 'Guided Breathing',
  32: 'Gymnastics',
  33: 'Handball',
  34: 'HIIT',
  35: 'Hiking',
  36: 'Ice Hockey',
  37: 'Ice Skating',
  44: 'Martial Arts',
  46: 'Paddling',
  47: 'Paragliding',
  48: 'Pilates',
  50: 'Racquetball',
  51: 'Rock Climbing',
  52: 'Roller Hockey',
  53: 'Rowing',
  54: 'Rowing Machine',
  55: 'Rugby',
  56: 'Running',
  57: 'Running (Treadmill)',
  58: 'Sailing',
  59: 'Scuba Diving',
  60: 'Skating',
  61: 'Skiing',
  62: 'Skiing (Cross Country)',
  63: 'Skiing (Downhill)',
  64: 'Snowboarding',
  65: 'Snowshoeing',
  66: 'Soccer',
  67: 'Softball',
  68: 'Squash',
  69: 'Stair Climbing',
  70: 'Stair Climbing (Machine)',
  71: 'Strength Training',
  72: 'Stretching',
  73: 'Surfing',
  74: 'Swimming (Open Water)',
  75: 'Swimming (Pool)',
  76: 'Table Tennis',
  77: 'Tennis',
  78: 'Volleyball',
  79: 'Walking',
  80: 'Water Polo',
  81: 'Weightlifting',
  82: 'Wheelchair',
  83: 'Yoga',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const getExerciseTypeName = (activity: Activity): string => {
  const exerciseType = (activity.data as Record<string, unknown> | undefined)?.exerciseType as
    | number
    | undefined
  if (exerciseType !== undefined && exerciseTypeNames[exerciseType]) {
    return exerciseTypeNames[exerciseType]
  }
  return activity.title || 'Workout'
}

const getPlaceColor = (placeName: string, allPlaces: string[]): string => {
  if (!placeName || placeName === 'Travel' || placeName === 'Unknown') return colors.travel
  const index = allPlaces.indexOf(placeName)
  return placeColorPalette[index % placeColorPalette.length]
}

const getExerciseColor = (exerciseTypeName: string, allTypes: string[]): string => {
  const index = allTypes.indexOf(exerciseTypeName)
  if (index === -1) return exerciseColorPalette[0]
  return exerciseColorPalette[index % exerciseColorPalette.length]
}

const formatDuration = (start: Date, end: Date): string => {
  const ms = end.getTime() - start.getTime()
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

/** Check if two time ranges overlap. */
const rangesOverlap = (s1: Date, e1: Date, s2: Date, e2: Date): boolean => s1 < e2 && s2 < e1

/** Compute overlap in minutes between two time ranges. */
const overlapMinutes = (s1: Date, e1: Date, s2: Date, e2: Date): number => {
  const overlapStart = Math.max(s1.getTime(), s2.getTime())
  const overlapEnd = Math.min(e1.getTime(), e2.getTime())
  return Math.max(0, (overlapEnd - overlapStart) / 60000)
}

/** Resolve the icon for a tag from the icon mappings. */
const resolveTagIcon = (tag: Tag, icons: Record<string, string>): string | undefined =>
  icons[tag.tag] ?? icons[tag.tag.toLowerCase()] ?? (tag.tag_key ? icons[tag.tag_key] : undefined)

// ── Tags to exclude from activity lane (they are not activity-like) ──────────
const COMPUTER_TAG_PREFIX = 'computer:'

/** Check if a duration tag should be shown in the activity lane */
const isDurationTagActivityLike = (tag: Tag): boolean => {
  if (!tag.end_time) return false
  if (tag.tag.startsWith(COMPUTER_TAG_PREFIX)) return false
  if (tag.source === 'lastfm' || tag.source === 'lastfm-auto') return false
  return true
}

// ── Source merging ────────────────────────────────────────────────────────────
// Tags that typically represent the same real-world event as a detected activity.
// e.g. Holosync (lastfm) often coincides exactly with an Oura meditation session.
// YinYoga (manual/oura tag) often coincides with meditation.
const TAG_ACTIVITY_MERGE_MAP: Record<string, string[]> = {
  Breathwork: ['meditation'],
  Holosync: ['meditation', 'nap'],
  Meditation: ['meditation'],
  YinYoga: ['meditation'],
}

/** Convert an Activity record to an ActivityLaneItem. Returns undefined for unknown types. */
const activityToLaneItem = (a: Activity, exerciseTypes: string[]): ActivityLaneItem | undefined => {
  if (!a.end_time) return undefined
  const end = a.end_time

  let label: string
  let color: string
  let type: ActivityLaneItem['type']

  switch (a.activity_type) {
    case 'sleep':
      label = 'Sleep'
      color = colors.sleep
      type = 'sleep'
      break
    case 'nap':
      label = 'Nap'
      color = colors.nap
      type = 'nap'
      break
    case 'meditation':
      label = a.title || 'Meditation'
      color = colors.meditation
      type = 'meditation'
      break
    case 'exercise':
      label = getExerciseTypeName(a)
      color = getExerciseColor(label, exerciseTypes)
      type = 'exercise'
      break
    default:
      return undefined
  }

  return {
    color,
    end,
    id: a.id,
    label,
    mergedAnnotations: [],
    opacity: a.activity_type === 'sleep' ? 0.5 : 0.7,
    source: a.source ?? undefined,
    start: a.start_time,
    tooltipDetails: formatDuration(a.start_time, end),
    tooltipTime: `${format(a.start_time, 'HH:mm')} - ${format(end, 'HH:mm')}`,
    tooltipTitle: label,
    type,
  }
}

/** Try to merge a duration tag into an existing activity item. Returns true if merged. */
const tryMergeTagIntoActivity = (tag: Tag, items: ActivityLaneItem[]): boolean => {
  const tagEnd = tag.end_time!
  const mergeableTypes = TAG_ACTIVITY_MERGE_MAP[tag.tag]
  if (!mergeableTypes) return false

  for (const item of items) {
    if (!mergeableTypes.includes(item.type)) continue
    const overlap = overlapMinutes(tag.start_time, tagEnd, item.start, item.end)
    const tagDuration = (tagEnd.getTime() - tag.start_time.getTime()) / 60000
    if (overlap > tagDuration * 0.5) {
      item.mergedAnnotations = item.mergedAnnotations ?? []
      item.mergedAnnotations.push(tag.tag)
      item.label = `${item.label} (${tag.tag})`
      return true
    }
  }
  return false
}

/** Create a duration tag item and detect overlaps with existing items. */
const createDurationTagItem = (
  tag: Tag,
  items: ActivityLaneItem[],
  overlaps: OverlapWarning[],
  tagIcons: Record<string, string>,
): ActivityLaneItem => {
  const tagEnd = tag.end_time!
  const icon = resolveTagIcon(tag, tagIcons)

  const tagItem: ActivityLaneItem = {
    color: durationTagColors[tag.tag] ?? colors.durationTag,
    end: tagEnd,
    icon,
    id: tag.id,
    label: tag.tag,
    opacity: 0.6,
    source: tag.source ?? undefined,
    start: tag.start_time,
    tooltipDetails: formatDuration(tag.start_time, tagEnd),
    tooltipTime: `${format(tag.start_time, 'HH:mm')} - ${format(tagEnd, 'HH:mm')}`,
    tooltipTitle: tag.tag,
    type: 'duration-tag',
  }

  // Check for overlaps with existing items
  for (const existing of items) {
    if (!rangesOverlap(tag.start_time, tagEnd, existing.start, existing.end)) continue
    const mins = overlapMinutes(tag.start_time, tagEnd, existing.start, existing.end)
    if (mins > 2) {
      overlaps.push({
        item1Label: existing.label,
        item1Time: `${format(existing.start, 'HH:mm')}-${format(existing.end, 'HH:mm')}`,
        item2Label: tag.tag,
        item2Time: `${format(tag.start_time, 'HH:mm')}-${format(tagEnd, 'HH:mm')}`,
        overlapMinutes: Math.round(mins),
      })
      tagItem.overlapWarning = `Overlaps with ${existing.label} by ${Math.round(mins)}min`
    }
  }

  return tagItem
}

/**
 * Build the unified activity lane items from activities and duration tags.
 *
 * Strategy:
 * 1. Convert all activities to ActivityLaneItems.
 * 2. For each duration tag, check if it should be merged with an existing activity
 *    (same-event from different source) or added as a separate item.
 * 3. Detect remaining overlaps and annotate them for visual handling.
 */
const buildActivityLaneItems = (
  activities: Activity[],
  tags: Tag[],
  tagIcons: Record<string, string>,
  exerciseTypes: string[],
): { items: ActivityLaneItem[]; overlaps: OverlapWarning[] } => {
  const items: ActivityLaneItem[] = []
  const overlaps: OverlapWarning[] = []

  // 1. Convert activities
  for (const a of activities) {
    const item = activityToLaneItem(a, exerciseTypes)
    if (item) items.push(item)
  }

  // 2. Process duration tags
  for (const tag of tags.filter(isDurationTagActivityLike)) {
    if (!tryMergeTagIntoActivity(tag, items)) {
      items.push(createDurationTagItem(tag, items, overlaps, tagIcons))
    }
  }

  return { items, overlaps }
}

interface OverlapWarning {
  item1Label: string
  item1Time: string
  item2Label: string
  item2Time: string
  overlapMinutes: number
}

// ── Layout constants ──────────────────────────────────────────────────────────

const margin = { bottom: 30, left: 100, right: 50, top: 10 }
const CHART_HEIGHT = 500
const chartHeight = CHART_HEIGHT - margin.top - margin.bottom

// Track layout: 3 lanes instead of 4 (Activity, Places, Tags/Icons)
const TRACK_COUNT = 3
const trackHeight = chartHeight / TRACK_COUNT
const trackActivity = 0
const trackPlaces = trackHeight
const trackTags = 2 * trackHeight

const TAG_ICON_SIZE = 18

// ── Default view ──────────────────────────────────────────────────────────────

const getDefaultStart = () => startOfDay(subDays(new Date(), 1))
const getDefaultEnd = () => endOfDay(new Date())

// ── D3 zoom transform from visible domain ────────────────────────────────────

const computeTransform = (
  start: Date,
  end: Date,
  baseScale: d3.ScaleTime<number, number>,
  chartWidth: number,
): d3.ZoomTransform => {
  const bx0 = baseScale(start)
  const bx1 = baseScale(end)
  const k = chartWidth / (bx1 - bx0)
  const tx = -k * bx0
  return d3.zoomIdentity.translate(tx, 0).scale(k)
}

// ── Main Component ────────────────────────────────────────────────────────────

// eslint-disable-next-line complexity -- TODO: refactor
export const Timeline = () => {
  const start = startOfDay(new Date(fromDate.value))
  const end = endOfDay(new Date(toDate.value))

  // Responsive width
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(1200)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width)
      }
    })
    observer.observe(el)
    setContainerWidth(el.clientWidth)
    return () => observer.disconnect()
  }, [])

  const svgWidth = containerWidth
  const chartWidth = svgWidth - margin.left - margin.right

  // ── Data queries ──────────────────────────────────────────────────────────

  const heartRateQuery = useQuery({
    enabled: showHeartRate.value,
    placeholderData: keepPreviousData,
    queryFn: () => fetchHeartRate(start, end),
    queryKey: ['heartRate', fromDate.value, toDate.value],
    staleTime: 10 * 60 * 1000,
  })

  const hrvQuery = useQuery({
    enabled: showHrv.value,
    placeholderData: keepPreviousData,
    queryFn: () => fetchHrv(start, end),
    queryKey: ['hrv', fromDate.value, toDate.value],
    staleTime: 10 * 60 * 1000,
  })

  const activitiesQuery = useQuery({
    enabled: showActivities.value,
    placeholderData: keepPreviousData,
    queryFn: () => fetchActivities(start, end),
    queryKey: ['activities', fromDate.value, toDate.value],
    staleTime: 10 * 60 * 1000,
  })

  const productivityQuery = useQuery({
    enabled: showProductivity.value,
    placeholderData: keepPreviousData,
    queryFn: () => fetchProductivity(start, end),
    queryKey: ['productivity', fromDate.value, toDate.value],
    staleTime: 10 * 60 * 1000,
  })

  const placesQuery = useQuery({
    enabled: showPlaces.value,
    placeholderData: keepPreviousData,
    queryFn: () => fetchPlaces(start, end),
    queryKey: ['places', fromDate.value, toDate.value],
    staleTime: 10 * 60 * 1000,
  })

  const tagsQuery = useQuery({
    enabled: showTags.value || showActivities.value,
    placeholderData: keepPreviousData,
    queryFn: () => fetchTags(start, end),
    queryKey: ['tags', fromDate.value, toDate.value],
    staleTime: 10 * 60 * 1000,
  })

  const tagMappingsQuery = useQuery({
    queryFn: fetchTagMappings,
    queryKey: ['tag-mappings'],
    staleTime: 30 * 60 * 1000,
  })

  // ── Derived data ────────────────────────────────────────────────────────────

  const isLoading =
    heartRateQuery.isLoading ||
    hrvQuery.isLoading ||
    activitiesQuery.isLoading ||
    productivityQuery.isLoading ||
    placesQuery.isLoading ||
    tagsQuery.isLoading
  const isFetching =
    heartRateQuery.isFetching ||
    hrvQuery.isFetching ||
    activitiesQuery.isFetching ||
    productivityQuery.isFetching ||
    placesQuery.isFetching ||
    tagsQuery.isFetching
  const hasError =
    heartRateQuery.isError ||
    hrvQuery.isError ||
    activitiesQuery.isError ||
    productivityQuery.isError ||
    placesQuery.isError ||
    tagsQuery.isError

  const places = placesQuery.data || []
  const uniquePlaceNames = useMemo(
    () => [...new Set(places.map((p) => p.region))].filter(Boolean).sort(),
    [places],
  )
  const activities = activitiesQuery.data || []
  const allTags = tagsQuery.data || []
  const tagIcons = useMemo(() => tagMappingsQuery.data?.icons ?? {}, [tagMappingsQuery.data?.icons])

  const uniqueExerciseTypes = useMemo(() => {
    const exerciseSessions = activities.filter((a) => a.activity_type === 'exercise')
    return [...new Set(exerciseSessions.map(getExerciseTypeName))].filter(Boolean).sort()
  }, [activities])

  // Build unified activity lane
  const { items: activityLaneItems, overlaps: overlapWarnings } = useMemo(
    () => buildActivityLaneItems(activities, allTags, tagIcons, uniqueExerciseTypes),
    [activities, allTags, tagIcons, uniqueExerciseTypes],
  )

  // Point-only tags (no end_time) and non-activity duration tags for tag lane
  const pointAndNonActivityTags = useMemo(
    () =>
      allTags.filter((t) => {
        // Exclude lastfm source
        if (t.source === 'lastfm' || t.source === 'lastfm-auto') return false
        // If it's a duration tag that went into the activity lane, exclude
        if (isDurationTagActivityLike(t)) return false
        // Also exclude computer tags from the tag icons lane
        if (t.tag.startsWith(COMPUTER_TAG_PREFIX)) return false
        return true
      }),
    [allTags],
  )

  // Calculate effective view range
  const effectiveViewStart = viewStart.value || getDefaultStart()
  const effectiveViewEnd = viewEnd.value || getDefaultEnd()

  // ── Navigation ────────────────────────────────────────────────────────────

  const handleZoom = useCallback((zoomStart: Date, zoomEnd: Date) => {
    viewStart.value = zoomStart
    viewEnd.value = zoomEnd

    const fetchStart = startOfDay(new Date(fromDate.value))
    const fetchEnd = endOfDay(new Date(toDate.value))
    const todayStr = formatISO(new Date(), { representation: 'date' })

    let needsExpand = false
    let newFrom = fromDate.value
    let newTo = toDate.value

    if (zoomStart < fetchStart) {
      newFrom = formatISO(subDays(zoomStart, 3), { representation: 'date' })
      needsExpand = true
    }
    if (zoomEnd > fetchEnd) {
      const expanded = formatISO(addDays(zoomEnd, 3), { representation: 'date' })
      newTo = expanded > todayStr ? todayStr : expanded
      needsExpand = true
    }

    if (needsExpand) {
      fromDate.value = newFrom
      toDate.value = newTo
    }
  }, [])

  const handleJumpDays = useCallback(
    (days: number) => {
      const currentStart = viewStart.value || getDefaultStart()
      const currentEnd = viewEnd.value || getDefaultEnd()
      const newStart = addDays(currentStart, days)
      const newEnd = addDays(currentEnd, days)
      const todayEnd = endOfDay(new Date())
      if (newEnd > todayEnd) return
      handleZoom(newStart, newEnd)
    },
    [handleZoom],
  )

  const handleResetToToday = useCallback(() => {
    viewStart.value = null
    viewEnd.value = null
    fromDate.value = formatISO(subDays(new Date(), 1), { representation: 'date' })
    toDate.value = formatISO(new Date(), { representation: 'date' })
  }, [])

  return (
    <div class="timeline" ref={containerRef}>
      <h1>Timeline</h1>

      {/* Navigation controls */}
      <div class="timeline-controls">
        <div class="timeline-nav">
          <button class="nav-btn" onClick={() => handleJumpDays(-30)} title="Back 1 month">
            {'<<'}
          </button>
          <button class="nav-btn" onClick={() => handleJumpDays(-1)} title="Back 1 day">
            {'<'}
          </button>
          <button class="nav-btn nav-today" onClick={handleResetToToday}>
            Today
          </button>
          <button class="nav-btn" onClick={() => handleJumpDays(1)} title="Forward 1 day">
            {'>'}
          </button>
          <button class="nav-btn" onClick={() => handleJumpDays(30)} title="Forward 1 month">
            {'>>'}
          </button>
        </div>
        {isFetching && !isLoading && <span class="timeline-fetching">Loading...</span>}
      </div>

      {/* Layer toggles */}
      <div class="timeline-layers">
        <label>
          <input
            type="checkbox"
            checked={showHeartRate.value}
            onChange={(e) => (showHeartRate.value = (e.target as HTMLInputElement).checked)}
          />
          <span style={{ color: colors.heartRate }}>Heart Rate</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={showHrv.value}
            onChange={(e) => (showHrv.value = (e.target as HTMLInputElement).checked)}
          />
          <span style={{ color: colors.hrv }}>HRV</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={showProductivity.value}
            onChange={(e) => (showProductivity.value = (e.target as HTMLInputElement).checked)}
          />
          <span>
            Productivity <span style={{ color: colors.computer }}>●</span>
            <span style={{ color: colors.mobile }}>●</span>
          </span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={showTags.value}
            onChange={(e) => (showTags.value = (e.target as HTMLInputElement).checked)}
          />
          <span style={{ opacity: 0.6 }}>Tags</span>
        </label>
      </div>

      {/* Places legend */}
      {showPlaces.value && uniquePlaceNames.length > 0 && (
        <div class="timeline-legend">
          <strong>Places:</strong>
          {uniquePlaceNames.map((name) => (
            <span key={name} class="legend-item">
              <span class="legend-dot" style={{ backgroundColor: getPlaceColor(name, uniquePlaceNames) }} />
              {name}
            </span>
          ))}
          <span class="legend-item">
            <span class="legend-dot" style={{ backgroundColor: colors.travel }} />
            Travel
          </span>
        </div>
      )}

      {/* Overlap warnings */}
      {overlapWarnings.length > 0 && (
        <div class="timeline-overlap-warnings">
          <details>
            <summary>
              {overlapWarnings.length} overlap{overlapWarnings.length > 1 ? 's' : ''} detected
            </summary>
            <ul>
              {overlapWarnings.map((w, i) => (
                <li key={i}>
                  <strong>{w.item1Label}</strong> ({w.item1Time}) overlaps with{' '}
                  <strong>{w.item2Label}</strong> ({w.item2Time}) by {w.overlapMinutes}min
                </li>
              ))}
            </ul>
            <p class="overlap-hint">
              This may indicate duplicate tracking from different sources, or genuinely concurrent activities.
              Check your data sources if unexpected.
            </p>
          </details>
        </div>
      )}

      {isLoading && <div class="loading">Loading...</div>}
      {hasError && <div class="error">Error loading data</div>}

      <TimelineChart
        heartRates={showHeartRate.value ? heartRateQuery.data || [] : []}
        hrvData={showHrv.value ? hrvQuery.data || [] : []}
        activityLaneItems={showActivities.value ? activityLaneItems : []}
        productivity={showProductivity.value ? productivityQuery.data || [] : []}
        places={showPlaces.value ? places : []}
        pointTags={showTags.value ? pointAndNonActivityTags : []}
        tagIcons={tagIcons}
        showPlacesSignal={showPlaces}
        showActivitiesSignal={showActivities}
        visibleStart={effectiveViewStart}
        visibleEnd={effectiveViewEnd}
        uniquePlaceNames={uniquePlaceNames}
        onZoom={handleZoom}
        chartWidth={chartWidth}
        svgWidth={svgWidth}
      />

      <p class="timeline-help">Scroll to zoom · Drag to pan · Double-click to reset</p>
    </div>
  )
}

// ── Chart Component ───────────────────────────────────────────────────────────

interface TimelineChartProps {
  heartRates: [Date, number][]
  hrvData: [Date, number][]
  activityLaneItems: ActivityLaneItem[]
  productivity: ProductivityRecord[]
  places: Place[]
  pointTags: Tag[]
  tagIcons: Record<string, string>
  showPlacesSignal: Signal<boolean>
  showActivitiesSignal: Signal<boolean>
  visibleStart: Date
  visibleEnd: Date
  uniquePlaceNames: string[]
  onZoom: (start: Date, end: Date) => void
  chartWidth: number
  svgWidth: number
}

function TimelineChart({
  heartRates,
  hrvData,
  activityLaneItems,
  productivity,
  places,
  pointTags,
  tagIcons,
  showPlacesSignal,
  showActivitiesSignal,
  visibleStart,
  visibleEnd,
  uniquePlaceNames,
  onZoom,
  chartWidth,
  svgWidth,
}: TimelineChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const xAxisRef = useRef<SVGGElement>(null)
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown>>()
  const isProgrammaticZoom = useRef(false)
  const zoomRafRef = useRef<number>(0)

  const [tooltip, setTooltip] = useState<TooltipState>({
    content: { time: '', title: '' },
    visible: false,
    x: 0,
    y: 0,
  })

  // Stable base scale
  const baseScale = useMemo(
    () => d3.scaleTime().domain([getDefaultStart(), getDefaultEnd()]).range([0, chartWidth]),
    [chartWidth],
  )

  const showTooltip = (event: MouseEvent, title: string, time: string, value?: string, warning?: string) => {
    if (!chartContainerRef.current) return
    const rect = chartContainerRef.current.getBoundingClientRect()
    setTooltip({
      content: { time, title, value, warning },
      visible: true,
      x: event.clientX - rect.left + 10,
      y: event.clientY - rect.top - 10,
    })
  }

  const hideTooltip = () => setTooltip((prev) => ({ ...prev, visible: false }))

  // Time scale based on view range
  const x = useMemo(
    () => d3.scaleTime().domain([visibleStart, visibleEnd]).range([0, chartWidth]),
    [visibleStart, visibleEnd, chartWidth],
  )

  // Heart rate y scale (left axis)
  const yHr = d3.scaleLinear().domain([40, 200]).range([chartHeight, 0])

  // HRV y scale (right axis)
  const hrvExtent = d3.extent(hrvData, ([, v]) => v) as [number, number]
  const hrvMin = hrvExtent[0] ?? 0
  const hrvMax = hrvExtent[1] ?? 150
  const hrvPadding = Math.max((hrvMax - hrvMin) * 0.2, 5)
  const yHrv = d3
    .scaleLinear()
    .domain([Math.max(0, hrvMin - hrvPadding), hrvMax + hrvPadding])
    .nice()
    .range([chartHeight, 0])

  // Pack activity lane items into sub-lanes for overlap handling
  const packedActivityItems = useMemo(
    () =>
      packLanes(
        activityLaneItems,
        (i) => i.start,
        (i) => i.end,
      ),
    [activityLaneItems],
  )

  // Pack point tags into sub-lanes for vertical stacking
  const packedPointTags = useMemo(
    () =>
      packLanes(
        pointTags,
        (t) => t.start_time,
        (t) => t.end_time,
      ),
    [pointTags],
  )

  // Midnight markers
  const midnights = useMemo(() => {
    const result: Date[] = []
    const d = new Date(visibleStart)
    d.setHours(0, 0, 0, 0)
    if (d <= visibleStart) d.setDate(d.getDate() + 1)
    while (d <= visibleEnd) {
      result.push(new Date(d))
      d.setDate(d.getDate() + 1)
    }
    return result
  }, [visibleStart, visibleEnd])

  // D3 zoom setup
  useEffect(() => {
    if (!svgRef.current) return
    const svg = d3.select(svgRef.current)

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 50])
      .filter((event) => event.type !== 'dblclick')
      .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        if (isProgrammaticZoom.current) return
        cancelAnimationFrame(zoomRafRef.current)
        zoomRafRef.current = requestAnimationFrame(() => {
          const newX = event.transform.rescaleX(baseScale)
          const domain = newX.domain()
          onZoom(domain[0], domain[1])
        })
      })

    svg.call(zoom)
    svg.on('wheel.zoom', function (event: WheelEvent) {
      event.preventDefault()
    })
    zoomBehaviorRef.current = zoom

    return () => {
      cancelAnimationFrame(zoomRafRef.current)
      svg.on('.zoom', null)
    }
  }, [baseScale, onZoom])

  // Sync D3 zoom transform from navigation
  useEffect(() => {
    if (!svgRef.current || !zoomBehaviorRef.current) return
    const transform = computeTransform(visibleStart, visibleEnd, baseScale, chartWidth)
    isProgrammaticZoom.current = true
    d3.select(svgRef.current).call(zoomBehaviorRef.current.transform, transform)
    isProgrammaticZoom.current = false
  }, [visibleStart, visibleEnd, baseScale, chartWidth])

  // Update x-axis ticks
  useEffect(() => {
    if (!xAxisRef.current) return
    const rangeMs = visibleEnd.getTime() - visibleStart.getTime()
    const rangeHours = rangeMs / (1000 * 60 * 60)
    const rangeDays = rangeHours / 24

    let tickInterval: d3.TimeInterval
    let tickFormat: string

    if (rangeHours <= 1) {
      tickInterval = d3.timeMinute.every(5)!
      tickFormat = '%H:%M'
    } else if (rangeHours <= 3) {
      tickInterval = d3.timeMinute.every(15)!
      tickFormat = '%H:%M'
    } else if (rangeHours <= 6) {
      tickInterval = d3.timeMinute.every(30)!
      tickFormat = '%H:%M'
    } else if (rangeHours <= 12) {
      tickInterval = d3.timeHour.every(1)!
      tickFormat = '%H:%M'
    } else if (rangeHours <= 24) {
      tickInterval = d3.timeHour.every(2)!
      tickFormat = '%H:%M'
    } else if (rangeHours <= 48) {
      tickInterval = d3.timeHour.every(4)!
      tickFormat = '%a %H'
    } else if (rangeDays <= 7) {
      tickInterval = d3.timeHour.every(12)!
      tickFormat = '%a %H'
    } else if (rangeDays <= 14) {
      tickInterval = d3.timeDay.every(1)!
      tickFormat = '%b %d'
    } else if (rangeDays <= 31) {
      tickInterval = d3.timeDay.every(2)!
      tickFormat = '%b %d'
    } else if (rangeDays <= 90) {
      tickInterval = d3.timeWeek.every(1)!
      tickFormat = '%b %d'
    } else {
      tickInterval = d3.timeWeek.every(2)!
      tickFormat = '%b %d'
    }

    d3.select(xAxisRef.current).call(
      d3
        .axisBottom(x)
        .ticks(tickInterval)
        .tickFormat((d) => d3.timeFormat(tickFormat)(d as Date)),
    )
  }, [visibleStart, visibleEnd, chartWidth])

  const handleDoubleClick = useCallback(() => {
    onZoom(getDefaultStart(), getDefaultEnd())
  }, [onZoom])

  // Sub-lane height for activity lane
  const activityLaneCount = Math.max(1, packedActivityItems.laneCount)
  const activitySubLaneHeight = trackHeight / activityLaneCount

  return (
    <div ref={chartContainerRef} class="timeline-chart-container">
      {/* Tooltip */}
      {tooltip.visible && (
        <div class="timeline-tooltip" style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }}>
          <div class="tooltip-title">{tooltip.content.title}</div>
          <div class="tooltip-time">{tooltip.content.time}</div>
          {tooltip.content.value && <div class="tooltip-value">{tooltip.content.value}</div>}
          {tooltip.content.warning && <div class="tooltip-warning">{tooltip.content.warning}</div>}
        </div>
      )}

      <svg
        ref={svgRef}
        width={svgWidth}
        height={CHART_HEIGHT}
        style={{ color: 'currentColor', cursor: 'grab' }}
        onDblClick={handleDoubleClick}
      >
        {/* Lane labels on the left */}
        <g transform={`translate(0,${margin.top})`}>
          {/* Activity lane label */}
          <foreignObject x={5} y={trackActivity} width={margin.left - 10} height={trackHeight}>
            <label
              style={{
                alignItems: 'center',
                cursor: 'pointer',
                display: 'flex',
                fontSize: '12px',
                gap: '4px',
                height: '100%',
              }}
            >
              <input
                type="checkbox"
                checked={showActivitiesSignal.value}
                onChange={(e) => (showActivitiesSignal.value = (e.target as HTMLInputElement).checked)}
              />
              <span>Activity</span>
            </label>
          </foreignObject>

          {/* Places lane label */}
          <foreignObject x={5} y={trackPlaces} width={margin.left - 10} height={trackHeight}>
            <label
              style={{
                alignItems: 'center',
                cursor: 'pointer',
                display: 'flex',
                fontSize: '12px',
                gap: '4px',
                height: '100%',
              }}
            >
              <input
                type="checkbox"
                checked={showPlacesSignal.value}
                onChange={(e) => (showPlacesSignal.value = (e.target as HTMLInputElement).checked)}
              />
              <span>Location</span>
            </label>
          </foreignObject>

          {/* Tags lane label */}
          <foreignObject x={5} y={trackTags} width={margin.left - 10} height={trackHeight}>
            <span style={{ alignItems: 'center', display: 'flex', fontSize: '12px', height: '100%' }}>
              Tags
            </span>
          </foreignObject>
        </g>

        <g transform={`translate(${margin.left},${margin.top})`}>
          {/* Clip path */}
          <defs>
            <clipPath id="chart-clip">
              <rect x={0} y={0} width={chartWidth} height={chartHeight} />
            </clipPath>
          </defs>

          {/* Lane separator lines */}
          <line
            x1={0}
            y1={trackHeight}
            x2={chartWidth}
            y2={trackHeight}
            stroke="currentColor"
            opacity={0.2}
          />
          <line
            x1={0}
            y1={trackHeight * 2}
            x2={chartWidth}
            y2={trackHeight * 2}
            stroke="currentColor"
            opacity={0.2}
          />
          <line
            x1={0}
            y1={trackHeight * 3}
            x2={chartWidth}
            y2={trackHeight * 3}
            stroke="currentColor"
            opacity={0.2}
          />

          {/* Midnight markers */}
          {midnights.map((midnight) => {
            const mx = x(midnight)
            if (mx < 0 || mx > chartWidth) return null
            return (
              <g key={midnight.getTime()}>
                <line
                  x1={mx}
                  y1={0}
                  x2={mx}
                  y2={chartHeight}
                  stroke="currentColor"
                  opacity={0.3}
                  strokeWidth={1.5}
                  strokeDasharray="6 3"
                />
                <text x={mx + 4} y={12} fill="currentColor" opacity={0.5} fontSize="10">
                  {format(midnight, 'MMM d')}
                </text>
              </g>
            )
          })}

          {/* Clipped chart content */}
          <g clip-path="url(#chart-clip)">
            {/* ── Activity lane: unified activities + duration tags ── */}
            {packedActivityItems.items.map(({ item, lane }) => {
              const laneY = trackActivity + lane * activitySubLaneHeight
              const laneH = activitySubLaneHeight - 1 // 1px gap between sub-lanes
              const rectX = x(item.start)
              const rectW = Math.max(0, x(item.end) - rectX)
              const hasOverlap = !!item.overlapWarning

              return (
                <g key={`activity-${item.id}`}>
                  <rect
                    x={rectX}
                    y={laneY}
                    width={rectW}
                    height={laneH}
                    fill={item.color}
                    opacity={hasOverlap ? 0.45 : item.opacity}
                    rx={2}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={(e) => {
                      const details = [item.tooltipDetails]
                      if (item.mergedAnnotations && item.mergedAnnotations.length > 0) {
                        details.push(`Merged: ${item.mergedAnnotations.join(', ')}`)
                      }
                      showTooltip(
                        e as unknown as MouseEvent,
                        item.tooltipTitle,
                        item.tooltipTime,
                        details.filter(Boolean).join(' | '),
                        item.overlapWarning,
                      )
                    }}
                    onMouseLeave={hideTooltip}
                  />
                  {/* Overlap indicator: dashed border */}
                  {hasOverlap && (
                    <rect
                      x={rectX}
                      y={laneY}
                      width={rectW}
                      height={laneH}
                      fill="none"
                      stroke="#fbbf24"
                      strokeWidth={1.5}
                      strokeDasharray="4 2"
                      rx={2}
                      style={{ pointerEvents: 'none' }}
                    />
                  )}
                  {/* Label text if block is wide enough */}
                  {rectW > 40 && (
                    <text
                      x={rectX + 4}
                      y={laneY + laneH / 2 + 4}
                      fill="white"
                      fontSize={Math.min(11, laneH - 4)}
                      style={{ pointerEvents: 'none' }}
                    >
                      {item.icon && isEmoji(item.icon) ? `${item.icon} ` : ''}
                      {item.label}
                    </text>
                  )}
                  {/* Icon for duration tags with image icons */}
                  {item.icon && isUrl(item.icon) && rectW > 20 && (
                    <image
                      href={item.icon}
                      x={rectX + 2}
                      y={laneY + 2}
                      width={Math.min(laneH - 4, 16)}
                      height={Math.min(laneH - 4, 16)}
                      style={{ pointerEvents: 'none' }}
                    />
                  )}
                </g>
              )
            })}

            {/* ── Productivity: thin bars at top of chart ── */}
            {productivity
              .filter((p) => !p.is_mobile)
              .map((p, i) => (
                <rect
                  key={`computer-${i}`}
                  x={x(p.start_time)}
                  y={0}
                  width={Math.max(0, x(p.end_time) - x(p.start_time))}
                  height={4}
                  fill={colors.computer}
                />
              ))}
            {productivity
              .filter((p) => p.is_mobile)
              .map((p, i) => (
                <rect
                  key={`mobile-${i}`}
                  x={x(p.start_time)}
                  y={4}
                  width={Math.max(0, x(p.end_time) - x(p.start_time))}
                  height={4}
                  fill={colors.mobile}
                />
              ))}

            {/* ── Places lane ── */}
            {showPlacesSignal.value &&
              places.map((place, i) => (
                <rect
                  key={`place-${i}`}
                  x={x(place.start_time)}
                  y={trackPlaces}
                  width={Math.max(0, x(place.end_time) - x(place.start_time))}
                  height={trackHeight}
                  fill={getPlaceColor(place.region, uniquePlaceNames)}
                  opacity={0.7}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) =>
                    showTooltip(
                      e as unknown as MouseEvent,
                      place.region || 'Unknown Location',
                      `${format(place.start_time, 'HH:mm')} - ${format(place.end_time, 'HH:mm')}`,
                      formatDuration(place.start_time, place.end_time),
                    )
                  }
                  onMouseLeave={hideTooltip}
                />
              ))}

            {/* ── Tags lane: vertically stacked icons ── */}
            {packedPointTags.items.map(({ item: tag, lane }, i) => {
              const icon = resolveTagIcon(tag, tagIcons)
              const tx = x(tag.start_time)
              // Stack icons vertically using lane assignment
              const tagY = trackTags + 4 + lane * (TAG_ICON_SIZE + 2)

              if (icon && isEmoji(icon)) {
                return (
                  <text
                    key={`tag-${i}`}
                    x={tx}
                    y={tagY + TAG_ICON_SIZE * 0.8}
                    fontSize={TAG_ICON_SIZE}
                    textAnchor="middle"
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={(e) =>
                      showTooltip(e as unknown as MouseEvent, tag.tag, format(tag.start_time, 'HH:mm'))
                    }
                    onMouseLeave={hideTooltip}
                  >
                    {icon}
                  </text>
                )
              }

              if (icon && isUrl(icon)) {
                return (
                  <image
                    key={`tag-${i}`}
                    href={icon}
                    x={tx - TAG_ICON_SIZE / 2}
                    y={tagY}
                    width={TAG_ICON_SIZE}
                    height={TAG_ICON_SIZE}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={(e) =>
                      showTooltip(e as unknown as MouseEvent, tag.tag, format(tag.start_time, 'HH:mm'))
                    }
                    onMouseLeave={hideTooltip}
                  />
                )
              }

              // No icon: show a small diamond marker
              const dy = tagY + TAG_ICON_SIZE / 2
              const s = 4
              return (
                <g
                  key={`tag-${i}`}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) =>
                    showTooltip(e as unknown as MouseEvent, tag.tag, format(tag.start_time, 'HH:mm'))
                  }
                  onMouseLeave={hideTooltip}
                >
                  <polygon
                    points={`${tx},${dy - s} ${tx + s},${dy} ${tx},${dy + s} ${tx - s},${dy}`}
                    fill={colors.tags}
                  />
                  <text x={tx + s + 3} y={dy + 3} fill="currentColor" fontSize="9" opacity={0.6}>
                    {tag.tag}
                  </text>
                </g>
              )
            })}

            {/* ── HRV Line ── */}
            {hrvData.length > 0 && (
              <path
                fill="none"
                stroke={colors.hrv}
                strokeWidth="1.5"
                d={
                  d3
                    .line<[Date, number] | null>()
                    .defined(Boolean)
                    .x(([time]) => x(time))
                    .y(([, value]) => yHrv(value))(preprocessData(hrvData, 10)) || ''
                }
              />
            )}

            {/* ── Heart Rate Line ── */}
            {heartRates.length > 0 && (
              <path
                fill="none"
                stroke={colors.heartRate}
                strokeWidth="1.5"
                d={
                  d3
                    .line<[Date, number] | null>()
                    .defined(Boolean)
                    .x(([time]) => x(time))
                    .y(([, rate]) => yHr(rate))(preprocessData(heartRates, 10)) || ''
                }
              />
            )}
          </g>

          {/* Y-axis for heart rate (left) */}
          <g
            ref={(g) => {
              if (g) d3.select(g).call(d3.axisLeft(yHr)).selectAll('text').style('fill', colors.heartRate)
            }}
          />

          {/* Y-axis for HRV (right) */}
          <g
            transform={`translate(${chartWidth},0)`}
            ref={(g) => {
              if (g)
                d3.select(g).call(d3.axisRight(yHrv).ticks(6)).selectAll('text').style('fill', colors.hrv)
            }}
          />

          {/* X-axis */}
          <g ref={xAxisRef} transform={`translate(0,${chartHeight})`} />
        </g>
      </svg>
    </div>
  )
}
