/* eslint-disable max-lines -- large visualization component */
import {
  metricUnits as builtinMetricUnits,
  type QueryMetricsBucketedResponse,
  type ScreentimeCategory,
} from '@aurboda/api-spec'
import { signal, useSignalEffect } from '@preact/signals'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import * as d3 from 'd3'
import { addDays, differenceInCalendarDays, endOfDay, format, formatISO, startOfDay, subDays } from 'date-fns'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  Activity,
  fetchActivities,
  fetchBucketedMetrics,
  fetchCustomMetrics,
  fetchPlaces,
  fetchProductivity,
  fetchScreentimeCategories,
  fetchScrobbles,
  fetchTagMappings,
  fetchTags,
  fetchTrainingLoad,
  fetchUserSettings,
  Place,
  ProductivityRecord,
  Tag,
} from '../../state/api'
import { parseBucketedResponse } from '../../utils/chart'
import { isEmoji, isUrl } from '../../utils/emojiLookup'
import { packLanes } from '../../utils/lanePacking'
import { buildActivityColumnItems, EXCLUDED_TAG_PREFIXES, EXCLUDED_TAG_SOURCES } from './activityMerge'
import { categorizeMusic } from './categorizeMusic'
import { drawActivitySparklines, parseBucketedData } from './drawActivitySparklines'
import {
  CALORIES_COLOR,
  computeYScales,
  drawMetricsTrack,
  HR_COLOR,
  HRV_COLOR,
  STEPS_COLOR,
} from './drawMetricsTrack'
import {
  buildMusicTooltipHtml,
  drawMusicSessions,
  getMergeGapMs,
  mergeScrobblesIntoSessions,
  MUSIC_STAFF_HEIGHT,
} from './drawMusicStaff'
import { CTL_COLOR, drawTrainingLoadTrack } from './drawTrainingLoadTrack'
import { findOverlappingScrobbles } from './findOverlappingScrobbles'
import type { ChartItem, Column, Orientation } from './types'

import './style.css'

// ── Signals (module-level, persist across SPA navigations) ────────────────────

const fromDate = signal(formatISO(subDays(new Date(), 1), { representation: 'date' }))
const toDate = signal(formatISO(new Date(), { representation: 'date' }))
const viewStart = signal<Date | null>(null)
const viewEnd = signal<Date | null>(null)

// Default view: start of today to end of today
const getDefaultViewStart = () => startOfDay(new Date())
const getDefaultViewEnd = () => endOfDay(new Date())

// ── URL hash helpers ──────────────────────────────────────────────────────────
// Hash format: #from=2026-02-27T06:00&to=2026-02-27T18:00&hide=sleep,music&o=h

// Top-level track toggles + sub-toggles, all stored in one flat Set.
type LegendCategory =
  // Top-level track toggles
  | 'music'
  | 'activity'
  | 'metrics'
  | 'location'
  // Activity sub-toggles
  | 'sleep_rest' // replaces sleep+nap+rest
  | 'meditation'
  | 'exercise'
  | 'tags'
  | 'calendar'
  | 'screentime' // vertical only
  // Metrics sub-toggles
  | 'hr'
  | 'hrv'
  | 'steps' // horizontal only
  | 'calories' // horizontal only
  | 'training_load' // horizontal only

// Legacy category names for URL hash backward compatibility
const LEGACY_CATEGORY_MAP: Record<string, LegendCategory> = {
  nap: 'sleep_rest',
  rest: 'sleep_rest',
  sleep: 'sleep_rest',
}

/** Parse window.location.hash into view state. */
const parseViewHash = (): {
  from: Date | null
  to: Date | null
  hide: LegendCategory[]
  orientation: Orientation | null
} => {
  const hash = window.location.hash.slice(1)
  if (!hash) return { from: null, hide: [], orientation: null, to: null }
  const params = new URLSearchParams(hash)
  const fromStr = params.get('from')
  const toStr = params.get('to')
  const hideStr = params.get('hide')
  const oStr = params.get('o')
  const from = fromStr ? new Date(fromStr) : null
  const to = toStr ? new Date(toStr) : null
  const hide =
    hideStr ?
      ([
        ...new Set(
          hideStr
            .split(',')
            .filter(Boolean)
            .map((c) => LEGACY_CATEGORY_MAP[c] ?? c),
        ),
      ] as LegendCategory[])
    : []
  const orientation: Orientation | null =
    oStr === 'h' ? 'horizontal'
    : oStr === 'v' ? 'vertical'
    : null
  return {
    from: from && !isNaN(from.getTime()) ? from : null,
    hide,
    orientation,
    to: to && !isNaN(to.getTime()) ? to : null,
  }
}

const getDefaultOrientation = (): Orientation =>
  typeof window !== 'undefined' && window.innerWidth >= window.innerHeight ? 'horizontal' : 'vertical'

/** Build hash string from current view state. */
const buildViewHash = (
  start: Date | null,
  end: Date | null,
  hidden: ReadonlySet<string>,
  orientation: Orientation,
): string => {
  const params = new URLSearchParams()
  if (start) params.set('from', start.toISOString())
  if (end) params.set('to', end.toISOString())
  if (hidden.size > 0) params.set('hide', [...hidden].join(','))
  // Only write orientation when it differs from the viewport default
  const defaultO = getDefaultOrientation()
  if (orientation !== defaultO) params.set('o', orientation === 'horizontal' ? 'h' : 'v')
  const str = params.toString()
  return str ? `#${str}` : ''
}

// Initialise signals from hash on page load
const _initialHash = parseViewHash()
if (_initialHash.from) {
  viewStart.value = _initialHash.from
  viewEnd.value = _initialHash.to
  const fetchFrom = _initialHash.from
  const fetchTo = _initialHash.to ?? _initialHash.from
  fromDate.value = formatISO(subDays(fetchFrom, 1), { representation: 'date' })
  const todayStr = formatISO(new Date(), { representation: 'date' })
  const expandedTo = formatISO(addDays(fetchTo, 1), { representation: 'date' })
  toDate.value = expandedTo > todayStr ? todayStr : expandedTo
}

// ── Column definitions ────────────────────────────────────────────────────────

const BASE_COLUMNS: Column[] = ['Activity', 'Location', 'Tags / Events', 'Screen Time']
const MUSIC_COLOR = '#ec4899'

// ── Colors ────────────────────────────────────────────────────────────────────

const activityColors: Record<string, string> = {
  meditation: '#a855f7',
  nap: '#60a5fa',
  rest: '#86efac',
  sleep: '#3b82f6',
}

const hrZoneColors: Record<number, string> = {
  0: '#22c55e',
  1: '#22c55e',
  2: '#3b82f6',
  3: '#f59e0b',
  4: '#f97316',
  5: '#ef4444',
}

const TAG_COLOR = '#8b5cf6'
const METRIC_COLOR = '#14b8a6'
const NOW_COLOR = '#ef4444'

/** Max data points per metric across the time range to be treated as "occasional" (shown as point markers). */
const OCCASIONAL_METRIC_MAX_COUNT = 10

/** Metrics to exclude from the unified bucketed query (fetched via separate endpoints). */
const TIMELINE_EXCLUDED_METRICS = ['training_impulse', 'activity_impulse']

/** Core metrics used for band/bar charts and sparklines. */
const CORE_CHART_METRICS = new Set([
  'heart_rate',
  'hrv_rmssd',
  'hrv_sleep',
  'hrv_awake',
  'hrv_activity',
  'steps',
  'calories_active',
  'calories_total',
  'calories_basal',
])

const tagSourceColors: Record<string, string> = {
  calendar: '#f59e0b',
  default: TAG_COLOR,
  lastfm: '#ec4899',
  'lastfm-auto': '#ec4899',
  manual: TAG_COLOR,
  oura: TAG_COLOR,
}

const productivityColors: Record<number, string> = {
  '-1': '#f97316',
  '-2': '#ef4444',
  0: '#9ca3af',
  1: '#3b82f6',
  2: '#22c55e',
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

// ── Helpers ───────────────────────────────────────────────────────────────────

const getPlaceColor = (name: string, allNames: string[]): string => {
  if (!name || name === 'Travel' || name === 'Unknown') return '#9ca3af'
  const index = allNames.indexOf(name)
  return placeColorPalette[index % placeColorPalette.length]
}

const getExerciseColor = (activity: Activity): string => {
  const zones = activity.hr_zone_secs
  if (!zones) return hrZoneColors[0]!
  let maxZone = 0
  let maxSecs = 0
  for (let z = 0; z <= 5; z++) {
    const secs = (zones as Record<number, number>)[z] ?? 0
    if (secs > maxSecs) {
      maxSecs = secs
      maxZone = z
    }
  }
  return hrZoneColors[maxZone] ?? hrZoneColors[0]!
}

const getTagColor = (tag: Tag): string => tagSourceColors[tag.source ?? 'default'] ?? tagSourceColors.default!

const getProductivityColor = (score: number | undefined): string =>
  productivityColors[score ?? 0] ?? productivityColors[0]!

const exerciseTypeNames: Record<number, string> = {
  0: 'Workout',
  8: 'Biking',
  10: 'Boot Camp',
  13: 'Calisthenics',
  16: 'Dancing',
  25: 'Elliptical',
  34: 'HIIT',
  35: 'Hiking',
  37: 'Ice Skating',
  48: 'Pilates',
  51: 'Rock Climbing',
  53: 'Rowing',
  56: 'Running',
  57: 'Treadmill',
  66: 'Soccer',
  68: 'Stair Climbing',
  70: 'Strength Training',
  71: 'Stretching',
  74: 'Swimming (Open Water)',
  75: 'Swimming (Pool)',
  79: 'Walking',
  81: 'Weightlifting',
  83: 'Yoga',
}

const getExerciseTypeName = (activity: Activity): string => {
  const exerciseType = (activity.data as Record<string, unknown> | undefined)?.exerciseType as
    | number
    | undefined
  if (exerciseType !== undefined && exerciseTypeNames[exerciseType]) {
    return exerciseTypeNames[exerciseType]
  }
  return activity.title || 'Workout'
}

const formatTime = (date: Date): string => format(date, 'HH:mm')

const formatDuration = (start: Date, end: Date): string => {
  const ms = end.getTime() - start.getTime()
  const totalMin = Math.round(ms / 60000)
  if (totalMin < 60) return `${totalMin}m`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

const escapeHtml = (str: string): string =>
  str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

type SleepMetrics = Record<string, number>
type SleepMetricsByDate = Map<string, SleepMetrics>

const buildSleepDetails = (a: Activity, end: Date, sleepByDate: SleepMetricsByDate): string[] => {
  const details: string[] = []
  details.push(`Bed: ${formatDuration(a.start_time, end)}`)

  if (a.total_sleep !== undefined) {
    const h = Math.floor(a.total_sleep / 60)
    const m = a.total_sleep % 60
    details.push(`Sleep: ${m > 0 ? `${h}h ${m}m` : `${h}h`}`)
  }

  const sleepData = sleepByDate.get(format(end, 'yyyy-MM-dd'))
  if (sleepData) {
    if (sleepData.sleep_score !== undefined) details.push(`Score: ${Math.round(sleepData.sleep_score)}`)
    if (sleepData.sleep_efficiency !== undefined)
      details.push(`Efficiency: ${Math.round(sleepData.sleep_efficiency)}%`)
    if (sleepData.sleep_restfulness !== undefined)
      details.push(`Restfulness: ${Math.round(sleepData.sleep_restfulness)}`)
    if (sleepData.sleep_deep_score !== undefined)
      details.push(`Deep: ${Math.round(sleepData.sleep_deep_score)}`)
    if (sleepData.sleep_rem_score !== undefined) details.push(`REM: ${Math.round(sleepData.sleep_rem_score)}`)
  }

  if (a.avg_hrv) details.push(`Avg HRV: ${a.avg_hrv} ms`)
  return details
}

const CATEGORY_MATCHERS: Record<LegendCategory, (item: ChartItem) => boolean> = {
  activity: (item) =>
    item.column === 'Activity' || item.column === 'Tags / Events' || item.column === 'Screen Time',
  calendar: (item) => item.column === 'Tags / Events' && item.color === tagSourceColors.calendar,
  calories: () => false, // metrics sub-toggles handled at draw level
  exercise: (item) => item.column === 'Activity' && item.activity_type === 'exercise',
  hr: () => false,
  hrv: () => false,
  location: (item) => item.column === 'Location',
  meditation: (item) => item.column === 'Activity' && item.activity_type === 'meditation',
  metrics: () => false, // metrics track controlled via sub-toggles at draw level
  music: (item) => item.column === 'Music',
  screentime: (item) => item.column === 'Screen Time',
  sleep_rest: (item) =>
    item.column === 'Activity' && ['sleep', 'nap', 'rest'].includes(item.activity_type ?? ''),
  steps: () => false,
  tags: (item) =>
    // Tags in Tags/Events column (excluding calendar and metrics)
    (item.column === 'Tags / Events' &&
      item.color !== tagSourceColors.calendar &&
      item.color !== METRIC_COLOR) ||
    // Duration tags promoted to Activity column (have entity_type 'tag' but no activity_type)
    (item.column === 'Activity' && item.entity_type === 'tag' && !item.activity_type),
  training_load: () => false,
}

// ── Categorization helpers ────────────────────────────────────────────────────

const categorizeLocations = (places: Place[], uniquePlaceNames: string[]): ChartItem[] =>
  places.map((p) => ({
    color: getPlaceColor(p.region, uniquePlaceNames),
    column: 'Location' as Column,
    end: p.end_time,
    href: `/places?date=${format(p.start_time, 'yyyy-MM-dd')}&name=${encodeURIComponent(p.region || '')}`,
    isPoint: false,
    label: p.region || 'Unknown',
    start: p.start_time,
    tooltip: {
      details: [formatDuration(p.start_time, p.end_time)],
      time: `${formatTime(p.start_time)} – ${formatTime(p.end_time)}`,
      title: p.region || 'Unknown',
    },
  }))

const categorizeTags = (tags: Tag[], itemIcons: Record<string, string>): ChartItem[] =>
  tags
    .filter((t) => t.source !== 'lastfm')
    .map((t) => {
      const isPoint = !t.end_time
      const end = t.end_time ?? new Date(t.start_time.getTime() + 15 * 60000)
      const sourceLabel = t.source ? ` (${t.source})` : ''
      const icon =
        itemIcons[t.tag] ?? itemIcons[t.tag.toLowerCase()] ?? (t.tag_key ? itemIcons[t.tag_key] : undefined)
      return {
        color: getTagColor(t),
        column: 'Tags / Events' as Column,
        end,
        entity_id: t.id,
        entity_type: 'tag' as const,
        icon,
        isPoint,
        label: t.tag,
        start: t.start_time,
        tooltip: {
          details:
            isPoint ? [`Point event${sourceLabel}`] : [formatDuration(t.start_time, end) + sourceLabel],
          time: isPoint ? formatTime(t.start_time) : `${formatTime(t.start_time)} – ${formatTime(end)}`,
          title: t.tag,
        },
      }
    })

const formatMetricLabel = (metric: string): string =>
  metric.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

/**
 * Extract occasional (sparse) metrics from bucketed data as point ChartItems.
 * A metric is "occasional" if it has data in ≤ OCCASIONAL_METRIC_MAX_COUNT buckets
 * and is not a core chart metric (HR, HRV, steps, calories).
 */
const categorizeOccasionalMetrics = (
  data: QueryMetricsBucketedResponse | undefined,
  metricUnitsMap: Record<string, string>,
): ChartItem[] => {
  if (!data?.buckets?.length) return []

  // Count how many buckets each metric appears in
  const metricBucketCounts: Record<string, number> = {}
  for (const bucket of data.buckets) {
    for (const metric of Object.keys(bucket.metrics)) {
      metricBucketCounts[metric] = (metricBucketCounts[metric] ?? 0) + 1
    }
  }

  // Find occasional metrics: sparse, non-core
  const occasionalMetrics = new Set(
    Object.entries(metricBucketCounts)
      .filter(([metric, count]) => count <= OCCASIONAL_METRIC_MAX_COUNT && !CORE_CHART_METRICS.has(metric))
      .map(([metric]) => metric),
  )

  if (occasionalMetrics.size === 0) return []

  const items: ChartItem[] = []
  for (const bucket of data.buckets) {
    const bucketStart = new Date(bucket.start)
    for (const [metric, stats] of Object.entries(bucket.metrics)) {
      if (!occasionalMetrics.has(metric)) continue

      const unit = metricUnitsMap[metric] ?? ''
      const displayValue = Number(stats.avg.toFixed(2))
      const valueStr = `${displayValue}${unit ? ` ${unit}` : ''}`
      const metricLabel = formatMetricLabel(metric)
      const end = new Date(bucketStart.getTime() + 15 * 60000)
      const entityId = `${bucketStart.toISOString()}|${metric}`

      items.push({
        color: METRIC_COLOR,
        column: 'Tags / Events' as Column,
        end,
        entity_id: entityId,
        entity_type: 'metric' as const,
        isPoint: true,
        label: `${metricLabel}: ${valueStr}`,
        start: bucketStart,
        tooltip: {
          details: [`Value: ${valueStr}`, 'Metric measurement'],
          time: formatTime(bucketStart),
          title: metricLabel,
        },
      })
    }
  }
  return items
}

const getResolvedColor = (p: ProductivityRecord, categories: ScreentimeCategory[]): string => {
  if (p.resolved_category && p.resolved_category.length > 0 && categories.length > 0) {
    for (let depth = p.resolved_category.length; depth > 0; depth--) {
      const path = p.resolved_category.slice(0, depth)
      const match = categories.find(
        (c) => c.name.length === path.length && c.name.every((n, i) => n === path[i]),
      )
      if (match?.color) return match.color
    }
  }
  return getProductivityColor(p.productivity)
}

const categorizeProductivity = (
  productivity: ProductivityRecord[],
  categories: ScreentimeCategory[],
): ChartItem[] =>
  productivity.map((p) => {
    const categoryLabel = p.resolved_category?.join(' > ') || p.category || ''
    return {
      color: getResolvedColor(p, categories),
      column: 'Screen Time' as Column,
      end: p.end_time,
      entity_id: p.id,
      entity_type: 'productivity' as const,
      isPoint: false,
      label: p.activity,
      start: p.start_time,
      tooltip: {
        details: [
          categoryLabel,
          p.title ? `Title: ${p.title}` : '',
          formatDuration(p.start_time, p.end_time),
          p.productivity != null ? `Score: ${p.productivity}` : '',
        ].filter(Boolean),
        time: `${formatTime(p.start_time)} – ${formatTime(p.end_time)}`,
        title: p.activity,
      },
    }
  })

// ── Tooltip HTML builder ──────────────────────────────────────────────────────

const buildHrZoneBarHtml = (zones: Record<number, number>): string => {
  const total = Object.values(zones).reduce((s, v) => s + v, 0)
  if (total <= 0) return ''
  let html = '<div class="hr-zone-bar">'
  for (let z = 0; z <= 5; z++) {
    const pct = ((zones[z] ?? 0) / total) * 100
    if (pct > 0) {
      html += `<span style="width:${pct}%;background:${hrZoneColors[z]}"></span>`
    }
  }
  return html + '</div>'
}

export const buildTooltipHtml = (item: ChartItem, music: string[], activities: Activity[]): string => {
  const datePrefix = format(item.start, 'EEE d MMM')
  let html = `<div class="tooltip-title">${escapeHtml(item.tooltip.title)}</div>`
  html += `<div class="tooltip-time">${escapeHtml(datePrefix)} · ${escapeHtml(item.tooltip.time)}</div>`
  for (const d of item.tooltip.details) {
    html += `<div class="tooltip-detail">${escapeHtml(d)}</div>`
  }

  if (item.activity_type === 'exercise') {
    const activity = activities.find(
      (a) => a.activity_type === 'exercise' && a.start_time.getTime() === item.start.getTime(),
    )
    const zones = activity?.hr_zone_secs as Record<number, number> | undefined
    if (zones) html += buildHrZoneBarHtml(zones)
  }

  if (music.length > 0) {
    const musicList = music.slice(0, 3).join(', ')
    const suffix = music.length > 3 ? ` +${music.length - 3} more` : ''
    html += `<div class="tooltip-music">♪ ${escapeHtml(musicList + suffix)}</div>`
  }

  return html
}

// ── Chart layout constants ────────────────────────────────────────────────────

const HORIZONTAL_MARGIN = { bottom: 30, left: 60, right: 60, top: 10 }
const VERTICAL_MARGIN = { bottom: 10, left: 60, right: 10, top: 30 }

const computeVerticalZoomTransform = (
  baseScale: d3.ScaleTime<number, number>,
  vStart: Date,
  vEnd: Date,
  chartHeight: number,
): d3.ZoomTransform => {
  const by0 = baseScale(vStart)
  const by1 = baseScale(vEnd)
  const k = chartHeight / (by1 - by0)
  return d3.zoomIdentity.translate(0, -k * by0).scale(k)
}

const computeHorizontalZoomTransform = (
  baseScale: d3.ScaleTime<number, number>,
  vStart: Date,
  vEnd: Date,
  chartWidth: number,
): d3.ZoomTransform => {
  const bx0 = baseScale(vStart)
  const bx1 = baseScale(vEnd)
  const k = chartWidth / (bx1 - bx0)
  return d3.zoomIdentity.translate(-k * bx0, 0).scale(k)
}

// ── Main Timeline component ───────────────────────────────────────────────────

// eslint-disable-next-line complexity -- D3 visualization component
export const Timeline = () => {
  const queryClient = useQueryClient()
  const effectiveViewStart = viewStart.value ?? getDefaultViewStart()
  const effectiveViewEnd = viewEnd.value ?? getDefaultViewEnd()

  const fetchStart = startOfDay(new Date(fromDate.value))
  const fetchEnd = endOfDay(new Date(toDate.value))

  // ── Orientation state ──────────────────────────────────────────────────────
  const [orientation, setOrientation] = useState<Orientation>(
    () => _initialHash.orientation ?? getDefaultOrientation(),
  )

  const orientationRef = useRef(orientation)
  orientationRef.current = orientation

  const [isFullscreen, setIsFullscreen] = useState(false)
  const [legendCollapsed, setLegendCollapsed] = useState(false)
  const legendRef = useRef<HTMLDivElement>(null)

  // Auto-collapse legend if it wraps to more than one row
  useEffect(() => {
    const el = legendRef.current
    if (!el) return
    // First render: measure if content height exceeds one-row height
    const firstChild = el.firstElementChild as HTMLElement | null
    if (!firstChild) return
    const oneRowHeight = firstChild.getBoundingClientRect().height || 36
    if (el.scrollHeight > oneRowHeight + 8) {
      setLegendCollapsed(true)
    }
  }, []) // run once after mount

  // Escape key exits fullscreen
  useEffect(() => {
    if (!isFullscreen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isFullscreen])

  // ── Data queries ───────────────────────────────────────────────────────────

  const activitiesQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () =>
      fetchActivities(subDays(fetchStart, 0.5), addDays(fetchEnd, 0.5), [
        'sleep',
        'exercise',
        'meditation',
        'nap',
        'rest',
      ]),
    queryKey: ['timeline-activities', fromDate.value, toDate.value],
    staleTime: 5 * 60 * 1000,
  })

  const placesQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => fetchPlaces(subDays(fetchStart, 0.5), addDays(fetchEnd, 0.5)),
    queryKey: ['timeline-places', fromDate.value, toDate.value],
    staleTime: 5 * 60 * 1000,
  })

  const tagsQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => fetchTags(subDays(fetchStart, 0.5), addDays(fetchEnd, 0.5)),
    queryKey: ['timeline-tags', fromDate.value, toDate.value],
    staleTime: 5 * 60 * 1000,
  })

  const productivityQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => fetchProductivity(fetchStart, fetchEnd),
    queryKey: ['timeline-productivity', fromDate.value, toDate.value],
    staleTime: 5 * 60 * 1000,
  })

  const screentimeCategoriesQuery = useQuery<ScreentimeCategory[]>({
    queryFn: fetchScreentimeCategories,
    queryKey: ['screentime-categories'],
    staleTime: 30 * 60 * 1000,
  })

  const settingsQuery = useQuery({
    queryFn: fetchUserSettings,
    queryKey: ['user-settings'],
    staleTime: 30 * 60 * 1000,
  })

  const hasLastFm = Boolean(settingsQuery.data?.lastfm_username)

  const scrobblesQuery = useQuery({
    enabled: hasLastFm,
    placeholderData: keepPreviousData,
    queryFn: () => fetchScrobbles(subDays(fetchStart, 0.5), addDays(fetchEnd, 0.5)),
    queryKey: ['timeline-scrobbles', fromDate.value, toDate.value],
    staleTime: 5 * 60 * 1000,
  })

  // Unified bucketed metrics: all metrics in one request
  // Scale bucket size with date range to avoid overwhelming the API on large ranges
  const metricBucketSize = useMemo(() => {
    const days = differenceInCalendarDays(fetchEnd, fetchStart)
    if (days > 90) return '1d'
    if (days > 30) return '1h'
    if (days > 7) return '15m'
    return '5m'
  }, [fetchStart, fetchEnd])

  const bucketedMetricsQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () =>
      fetchBucketedMetrics(
        subDays(fetchStart, 0.5),
        addDays(fetchEnd, 0.5),
        undefined,
        metricBucketSize,
        TIMELINE_EXCLUDED_METRICS,
      ),
    queryKey: ['timeline-bucketed-metrics', fromDate.value, toDate.value, metricBucketSize],
    staleTime: 5 * 60 * 1000,
  })

  const tagMappingsQuery = useQuery({
    queryFn: fetchTagMappings,
    queryKey: ['tag-mappings'],
    staleTime: 30 * 60 * 1000,
  })

  const customMetricsQuery = useQuery({
    queryFn: fetchCustomMetrics,
    queryKey: ['custom-metrics'],
    staleTime: 30 * 60 * 1000,
  })

  const allMetricUnits = useMemo(() => {
    const units: Record<string, string> = { ...builtinMetricUnits }
    for (const m of customMetricsQuery.data ?? []) {
      units[m.name] = m.unit
    }
    return units
  }, [customMetricsQuery.data])

  // ── Refs ───────────────────────────────────────────────────────────────────

  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown>>()
  const isProgrammaticZoom = useRef(false)
  const baseScaleRef = useRef<d3.ScaleTime<number, number>>()

  const drawRef = useRef<((scale: d3.ScaleTime<number, number>) => void) | null>(null)
  /** rAF handle for coalescing rapid zoom events into a single draw per frame. */
  const zoomRafRef = useRef<number>(0)
  // Horizontal chart: stable reference for x-axis (updated in place, never rebuilt)
  const hAxisGroupRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null)

  // ── Derived data ───────────────────────────────────────────────────────────

  const todayKey = format(new Date(), 'yyyy-MM-dd')
  const baseScaleDomain = useMemo(
    () => [startOfDay(new Date(todayKey)), endOfDay(new Date(todayKey))] as [Date, Date],
    [todayKey],
  )

  const activities = activitiesQuery.data ?? []
  const places = placesQuery.data ?? []
  const tags = tagsQuery.data ?? []
  const productivity = productivityQuery.data ?? []
  const scrobbles = scrobblesQuery.data ?? []

  // Extract sleep score metrics from unified bucketed data, keyed by date
  const sleepMetricsByDate = useMemo<SleepMetricsByDate>(() => {
    const map: SleepMetricsByDate = new Map()
    const sleepMetricNames = [
      'sleep_score',
      'sleep_efficiency',
      'sleep_restfulness',
      'sleep_deep_score',
      'sleep_rem_score',
    ]
    for (const bucket of bucketedMetricsQuery.data?.buckets ?? []) {
      for (const name of sleepMetricNames) {
        const stats = bucket.metrics[name]
        if (!stats) continue
        const key = format(new Date(bucket.start), 'yyyy-MM-dd')
        const existing = map.get(key) ?? {}
        existing[name] = stats.avg
        map.set(key, existing)
      }
    }
    return map
  }, [bucketedMetricsQuery.data])

  const itemIcons = useMemo<Record<string, string>>(() => {
    return tagMappingsQuery.data?.icons ?? {}
  }, [tagMappingsQuery.data])

  const musicItems = useMemo(() => (hasLastFm ? categorizeMusic(scrobbles) : []), [hasLastFm, scrobbles])
  const showMusicColumn = musicItems.length > 0

  const occasionalMetricItems = useMemo(
    () => categorizeOccasionalMetrics(bucketedMetricsQuery.data, allMetricUnits),
    [bucketedMetricsQuery.data, allMetricUnits],
  )

  const sparklineBuckets = useMemo(
    () => parseBucketedData(bucketedMetricsQuery.data),
    [bucketedMetricsQuery.data],
  )

  // Parsed bucketed metrics for horizontal mode band/bar charts
  const horizontalMetricBuckets = useMemo(
    () => parseBucketedResponse(bucketedMetricsQuery.data),
    [bucketedMetricsQuery.data],
  )

  const uniquePlaceNames = useMemo(
    () => [...new Set(places.map((p) => p.region))].filter(Boolean).sort(),
    [places],
  )

  // Unified Activity column items (activities + merged duration tags)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- UI temporarily commented out, will be redesigned
  const { items: activityItems, overlaps: overlapWarnings } = useMemo(
    () =>
      buildActivityColumnItems(
        activities,
        tags,
        itemIcons,
        activityColors,
        getExerciseColor,
        getExerciseTypeName,
        sleepMetricsByDate,
        (a, end) => buildSleepDetails(a, end, sleepMetricsByDate),
        scrobbles,
      ),
    [activities, tags, itemIcons, sleepMetricsByDate, scrobbles],
  )

  // Tags that should stay in the Tags / Events column (not pulled into Activity)
  const nonActivityTags = useMemo(
    () =>
      tags.filter((t) => {
        if (!t.end_time) return true // point tags always go to Tags column
        if (t.source && EXCLUDED_TAG_SOURCES.has(t.source)) return true
        for (const prefix of EXCLUDED_TAG_PREFIXES) {
          if (t.tag.startsWith(prefix)) return true
        }
        // Check if this tag was placed in the Activity column
        return !activityItems.some((i) => i.entity_id === t.id)
      }),
    [tags, activityItems],
  )

  // ── Legend / filtering ─────────────────────────────────────────────────────

  const [hiddenCategories, setHiddenCategories] = useState<Set<LegendCategory>>(
    () => new Set(_initialHash.hide),
  )
  const hiddenCategoriesRef = useRef<Set<LegendCategory>>(hiddenCategories)
  hiddenCategoriesRef.current = hiddenCategories

  // Training load data (fetched when toggle is on, uses daily granularity)
  const trainingLoadQuery = useQuery({
    enabled: !hiddenCategories.has('training_load'),
    placeholderData: keepPreviousData,
    queryFn: () => fetchTrainingLoad(subDays(fetchStart, 0.5), addDays(fetchEnd, 0.5)),
    queryKey: ['timeline-training-load', fromDate.value, toDate.value],
    staleTime: 5 * 60 * 1000,
  })

  // Sync view state + orientation → URL hash
  useSignalEffect(() => {
    const hash = buildViewHash(
      viewStart.value,
      viewEnd.value,
      hiddenCategoriesRef.current,
      orientationRef.current,
    )
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`)
  })

  useEffect(() => {
    const hash = buildViewHash(viewStart.value, viewEnd.value, hiddenCategories, orientation)
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`)
  }, [hiddenCategories, orientation])

  const toggleCategory = useCallback((cat: LegendCategory) => {
    setHiddenCategories((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }, [])

  const isItemHidden = useCallback(
    (item: ChartItem): boolean => {
      // If a parent track is hidden, all children are implicitly hidden
      if (hiddenCategories.has('activity') && CATEGORY_MATCHERS.activity(item)) return true
      if (hiddenCategories.has('location') && CATEGORY_MATCHERS.location(item)) return true
      if (hiddenCategories.has('music') && CATEGORY_MATCHERS.music(item)) return true
      // Check sub-toggles
      for (const cat of hiddenCategories) {
        if (cat === 'activity' || cat === 'location' || cat === 'music' || cat === 'metrics') continue
        if (CATEGORY_MATCHERS[cat](item)) return true
      }
      return false
    },
    [hiddenCategories],
  )

  const allColumns: Column[] = useMemo(
    () => (showMusicColumn ? [...BASE_COLUMNS, 'Music'] : BASE_COLUMNS),
    [showMusicColumn],
  )

  const allChartItems = useMemo(
    () => [
      ...activityItems,
      ...categorizeLocations(places, uniquePlaceNames),
      ...categorizeTags(nonActivityTags, itemIcons),
      ...categorizeProductivity(productivity, screentimeCategoriesQuery.data ?? []),
      ...occasionalMetricItems,
      ...musicItems,
    ],
    [
      activityItems,
      places,
      uniquePlaceNames,
      nonActivityTags,
      itemIcons,
      productivity,
      screentimeCategoriesQuery.data,
      occasionalMetricItems,
      musicItems,
    ],
  )

  const chartItems = useMemo(
    () => allChartItems.filter((item) => !isItemHidden(item)),
    [allChartItems, isItemHidden],
  )

  const columns = useMemo(
    () => allColumns.filter((col) => chartItems.some((item) => item.column === col)),
    [allColumns, chartItems],
  )

  const columnData = useMemo(
    () =>
      columns.map((col) => {
        const colItems = chartItems.filter((i) => i.column === col)
        const packed = packLanes(
          colItems,
          (i) => i.start,
          (i) => (i.isPoint ? undefined : i.end),
        )
        return { column: col, ...packed }
      }),
    [columns, chartItems],
  )

  const isFetching =
    activitiesQuery.isFetching ||
    placesQuery.isFetching ||
    tagsQuery.isFetching ||
    productivityQuery.isFetching ||
    scrobblesQuery.isFetching ||
    bucketedMetricsQuery.isFetching

  // ── Navigation ─────────────────────────────────────────────────────────────

  const handleZoom = useCallback((zoomStart: Date, zoomEnd: Date) => {
    viewStart.value = zoomStart
    viewEnd.value = zoomEnd

    const currentFetchStart = startOfDay(new Date(fromDate.value))
    const currentFetchEnd = endOfDay(new Date(toDate.value))
    const todayStr = formatISO(new Date(), { representation: 'date' })

    let needsExpand = false
    let newFrom = fromDate.value
    let newTo = toDate.value

    if (zoomStart < currentFetchStart) {
      newFrom = formatISO(subDays(zoomStart, 3), { representation: 'date' })
      needsExpand = true
    }
    if (zoomEnd > currentFetchEnd) {
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
      const currentStart = viewStart.value ?? getDefaultViewStart()
      const currentEnd = viewEnd.value ?? getDefaultViewEnd()
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

  // ── showTooltip / hideTooltip (shared) ────────────────────────────────────

  const showTooltip = useCallback(
    (event: MouseEvent, item: ChartItem) => {
      if (!tooltipRef.current || !containerRef.current) return
      const music = findOverlappingScrobbles(scrobbles, item.start, item.end)
      const tip = tooltipRef.current
      const containerRect = containerRef.current.getBoundingClientRect()
      tip.innerHTML = buildTooltipHtml(item, music, activities)
      tip.style.display = 'block'
      const x = event.clientX - containerRect.left + 12
      const yRaw = event.clientY - containerRect.top - 10
      // Clamp so tooltip stays within the container vertically
      const tipH = tip.scrollHeight
      const yMax = containerRect.height - tipH - 4
      const y = Math.min(yRaw, Math.max(yMax, 4))
      tip.style.left = `${Math.min(x, containerRect.width - 320)}px`
      tip.style.top = `${y}px`
    },
    [scrobbles, activities],
  )

  const hideTooltip = useCallback(() => {
    if (tooltipRef.current) tooltipRef.current.style.display = 'none'
  }, [])

  const showMusicTooltip = useCallback(
    (
      event: MouseEvent,
      session: { start: Date; end: Date; scrobbles: { artist: string; track: string }[] },
    ) => {
      if (!tooltipRef.current || !containerRef.current) return
      const tip = tooltipRef.current
      const containerRect = containerRef.current.getBoundingClientRect()
      tip.innerHTML = buildMusicTooltipHtml(session as Parameters<typeof buildMusicTooltipHtml>[0])
      tip.style.display = 'block'
      const x = event.clientX - containerRect.left + 12
      const yRaw = event.clientY - containerRect.top - 10
      const tipH = tip.scrollHeight
      const yMax = containerRect.height - tipH - 4
      const y = Math.min(yRaw, Math.max(yMax, 4))
      tip.style.left = `${Math.min(x, containerRect.width - 320)}px`
      tip.style.top = `${y}px`
    },
    [],
  )

  // ── Vertical chart rendering ───────────────────────────────────────────────

  const renderVerticalChart = useCallback(() => {
    if (!svgRef.current || !containerRef.current) return

    const containerWidth = containerRef.current.clientWidth
    const containerHeight = containerRef.current.clientHeight
    const margin = VERTICAL_MARGIN
    const chartWidth = containerWidth - margin.left - margin.right
    const chartHeight = Math.max(200, containerHeight - margin.top - margin.bottom)

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', containerWidth).attr('height', containerHeight)

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    const baseScale = d3.scaleTime().domain(baseScaleDomain).range([0, chartHeight])
    baseScaleRef.current = baseScale

    const yScale = d3.scaleTime().domain([effectiveViewStart, effectiveViewEnd]).range([0, chartHeight])

    const colWidth = chartWidth / columns.length
    const colGap = 4
    const colPadding = 2

    const defs = svg.append('defs')
    defs
      .append('clipPath')
      .attr('id', 'chart-clip')
      .append('rect')
      .attr('width', chartWidth)
      .attr('height', chartHeight)

    const chartGroup = g.append('g').attr('clip-path', 'url(#chart-clip)')

    // eslint-disable-next-line complexity -- D3 vertical layout draw loop
    const draw = (currentYScale: d3.ScaleTime<number, number>) => {
      chartGroup.selectAll('*').remove()
      g.selectAll('.hour-label').remove()
      g.selectAll('.day-label').remove()

      const domain = currentYScale.domain()
      const domainStart = domain[0]!
      const domainEnd = domain[1]!

      const oneHourLater = new Date(domainStart.getTime() + 3600000)
      const pixelsPerHour = Math.abs(currentYScale(oneHourLater) - currentYScale(domainStart))
      let hourIntervalHours: number
      if (pixelsPerHour >= 30) hourIntervalHours = 1
      else if (pixelsPerHour >= 15) hourIntervalHours = 2
      else if (pixelsPerHour >= 8) hourIntervalHours = 4
      else if (pixelsPerHour >= 4) hourIntervalHours = 6
      else if (pixelsPerHour >= 2) hourIntervalHours = 12
      else hourIntervalHours = 24

      const hours = d3.timeHour.range(domainStart, domainEnd)
      chartGroup
        .selectAll('.grid-line')
        .data(hours)
        .enter()
        .append('line')
        .attr('x1', 0)
        .attr('x2', chartWidth)
        .attr('y1', (d) => currentYScale(d))
        .attr('y2', (d) => currentYScale(d))
        .attr('stroke', 'currentColor')
        .attr('stroke-opacity', 0.1)

      const labelHours = hours.filter((d) => d.getHours() % hourIntervalHours === 0)
      const hourFontSize = chartWidth > 1200 ? '0.85rem' : '0.7rem'
      g.selectAll('.hour-label')
        .data(labelHours)
        .enter()
        .append('text')
        .attr('class', 'hour-label')
        .attr('x', -8)
        .attr('y', (d) => currentYScale(d))
        .attr('dy', '0.35em')
        .attr('text-anchor', 'end')
        .attr('fill', 'currentColor')
        .attr('font-size', hourFontSize)
        .attr('opacity', 0.6)
        .text((d) => format(d, 'HH:mm'))

      // Time separators — adapt interval to zoom level
      const separatorDates: Date[] =
        pixelsPerHour >= 2 ? d3.timeDay.range(domainStart, domainEnd)
        : pixelsPerHour >= 0.3 ? d3.timeMonday.range(domainStart, domainEnd)
        : d3.timeMonth.range(domainStart, domainEnd)

      const separatorLabelFormat =
        pixelsPerHour >= 2 ? 'MMM d'
        : pixelsPerHour >= 0.3 ? "'w'w MMM d"
        : 'MMM yyyy'

      for (const sep of separatorDates) {
        const my = currentYScale(sep)
        chartGroup
          .append('line')
          .attr('x1', 0)
          .attr('x2', chartWidth)
          .attr('y1', my)
          .attr('y2', my)
          .attr('stroke', 'currentColor')
          .attr('stroke-opacity', 0.3)
          .attr('stroke-width', 1.5)
          .attr('stroke-dasharray', '6,3')

        g.append('text')
          .attr('class', 'day-label')
          .attr('x', chartWidth + margin.right)
          .attr('y', my + 4)
          .attr('dy', '0.35em')
          .attr('text-anchor', 'end')
          .attr('fill', 'currentColor')
          .attr('font-size', '0.65rem')
          .attr('font-weight', '600')
          .attr('opacity', 0.5)
          .text(format(sep, separatorLabelFormat))
      }

      for (let i = 1; i < columns.length; i++) {
        chartGroup
          .append('line')
          .attr('x1', i * colWidth)
          .attr('x2', i * colWidth)
          .attr('y1', currentYScale.range()[0]!)
          .attr('y2', currentYScale.range()[1]!)
          .attr('stroke', 'currentColor')
          .attr('stroke-opacity', 0.08)
      }

      drawColumnItems(
        chartGroup,
        columnData,
        colWidth,
        colGap,
        colPadding,
        currentYScale,
        showTooltip,
        hideTooltip,
      )

      const showSparkHR = !hiddenCategories.has('hr')
      const showSparkHRV = !hiddenCategories.has('hrv')
      if (sparklineBuckets.length > 0 && (showSparkHR || showSparkHRV)) {
        const getItemRect = (item: ChartItem): { x: number; width: number } | undefined => {
          for (let ci = 0; ci < columnData.length; ci++) {
            const cd = columnData[ci]!
            const found = cd.items.find((packed) => packed.item === item)
            if (found) {
              const cx = ci * colWidth + colGap
              const usable = colWidth - colGap * 2
              const lanes = Math.max(cd.laneCount, 1)
              const lw = (usable - (lanes - 1) * colPadding) / lanes
              return { width: lw, x: cx + found.lane * (lw + colPadding) }
            }
          }
          return undefined
        }

        drawActivitySparklines(
          chartGroup,
          defs,
          chartItems,
          sparklineBuckets,
          currentYScale,
          showSparkHR,
          showSparkHRV,
          getItemRect,
        )
      }

      drawNowLine(chartGroup, chartWidth, currentYScale)
    }

    drawRef.current = draw
    draw(yScale)

    if (zoomBehaviorRef.current) {
      isProgrammaticZoom.current = true
      svg.call(zoomBehaviorRef.current)
      svg.call(
        zoomBehaviorRef.current.transform,
        computeVerticalZoomTransform(baseScale, effectiveViewStart, effectiveViewEnd, chartHeight),
      )
      isProgrammaticZoom.current = false
    }
  }, [
    baseScaleDomain,
    chartItems,
    columnData,
    columns,
    effectiveViewEnd,
    effectiveViewStart,
    sparklineBuckets,
    hiddenCategories,
    showTooltip,
    hideTooltip,
  ])

  // ── Horizontal chart rendering ─────────────────────────────────────────────

  // eslint-disable-next-line complexity -- D3 horizontal layout with dynamic track visibility
  const renderHorizontalChart = useCallback(() => {
    if (!svgRef.current || !containerRef.current) return

    const containerWidth = containerRef.current.clientWidth
    const containerHeight = containerRef.current.clientHeight
    const margin = HORIZONTAL_MARGIN
    const chartWidth = containerWidth - margin.left - margin.right
    const chartHeight = Math.max(150, containerHeight - margin.top - margin.bottom)

    const LOCATION_TRACK_HEIGHT = 34
    const ICON_SIZE = 18

    // Dynamic track visibility based on legend state
    const showMusicTrack = scrobbles.length > 0 && !hiddenCategories.has('music')
    const showActivityTrack = !hiddenCategories.has('activity')
    const showMetricsTrack = !hiddenCategories.has('metrics')
    const showLocationTrack = !hiddenCategories.has('location')

    const musicTrackHeight = showMusicTrack ? MUSIC_STAFF_HEIGHT : 0
    const locationTrackHeight = showLocationTrack ? LOCATION_TRACK_HEIGHT : 0

    const remainingHeight = chartHeight - musicTrackHeight - locationTrackHeight
    const dynamicTrackCount = [showActivityTrack, showMetricsTrack].filter(Boolean).length
    const dynamicTrackHeight = dynamicTrackCount > 0 ? remainingHeight / dynamicTrackCount : 0

    const activityTrackHeight = showActivityTrack ? Math.max(40, dynamicTrackHeight) : 0
    const metricsTrackHeight = showMetricsTrack ? Math.max(40, dynamicTrackHeight) : 0

    // Compute Y positions dynamically
    let nextY = 0
    const trackMusic = nextY
    nextY += musicTrackHeight
    const trackActivity = nextY
    nextY += activityTrackHeight
    const trackMetrics = nextY
    nextY += metricsTrackHeight
    const trackPlaces = nextY

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', containerWidth).attr('height', containerHeight)

    // Add defs once
    const defs = svg.append('defs')
    defs
      .append('clipPath')
      .attr('id', 'h-chart-clip')
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', chartWidth)
      .attr('height', chartHeight)

    // Use the full fetch window as the base scale so items are positioned
    // in "native" coordinates; zoom/pan applies a transform to this group.
    const hFetchStart = startOfDay(new Date(fromDate.value))
    const hFetchEnd = endOfDay(new Date(toDate.value))
    const baseScale = d3.scaleTime().domain([hFetchStart, hFetchEnd]).range([0, chartWidth])
    baseScaleRef.current = baseScale

    // Bucketed metrics for band/bar charts in the metrics track
    const metricBuckets = horizontalMetricBuckets

    // Training load data (daily points + workouts)
    const trainingLoadData = trainingLoadQuery.data ?? null

    // Compute Y-scales once (stable per render, only depends on data, not zoom)
    const metricsTrackBottom = trackMetrics + metricsTrackHeight
    const metricsYScales =
      metricBuckets.length > 0 ? computeYScales(metricBuckets, trackMetrics, metricsTrackBottom) : null

    // Combine activity items and all non-hidden tags (point and duration) into the activity lane
    const visibleActivityItems = activityItems.filter((i) => !isItemHidden(i))
    const visibleTagItems = chartItems.filter((i) => i.column === 'Tags / Events' && !isItemHidden(i))
    const allActivityLaneItems = [...visibleActivityItems, ...visibleTagItems]
    const packedActivityItems = packLanes(
      allActivityLaneItems,
      (i) => i.start,
      (i) => (i.isPoint ? undefined : i.end),
    )

    const activitySubLaneHeight =
      packedActivityItems.laneCount > 1 ?
        activityTrackHeight / packedActivityItems.laneCount
      : activityTrackHeight

    // Outer group for margin offset — static, never removed
    const outerG = svg
      .append('g')
      .attr('class', 'chart-outer')
      .attr('transform', `translate(${margin.left},${margin.top})`)

    // Static lane labels and separators (not affected by zoom/pan)
    // Separator lines — only between visible tracks
    const separatorYs: number[] = []
    if (showMusicTrack && musicTrackHeight > 0) separatorYs.push(musicTrackHeight)
    if (showActivityTrack && showMetricsTrack) separatorYs.push(trackMetrics)
    if (showLocationTrack && locationTrackHeight > 0) separatorYs.push(trackPlaces)
    for (const sy of separatorYs) {
      outerG
        .append('line')
        .attr('x1', 0)
        .attr('x2', chartWidth)
        .attr('y1', sy)
        .attr('y2', sy)
        .attr('stroke', 'currentColor')
        .attr('stroke-opacity', 0.2)
    }

    const laneLabels: { label: string; y: number; height: number }[] = [
      ...(showMusicTrack ? [{ height: musicTrackHeight, label: 'Music', y: trackMusic }] : []),
      ...(showActivityTrack ? [{ height: activityTrackHeight, label: 'Activity', y: trackActivity }] : []),
      ...(showMetricsTrack ? [{ height: metricsTrackHeight, label: 'Metrics', y: trackMetrics }] : []),
      ...(showLocationTrack ? [{ height: locationTrackHeight, label: 'Location', y: trackPlaces }] : []),
    ]
    for (const { label, y, height } of laneLabels) {
      outerG
        .append('text')
        .attr('x', -margin.left + 4)
        .attr('y', y + height / 2)
        .attr('dy', '0.35em')
        .attr('fill', 'currentColor')
        .attr('font-size', '0.65rem')
        .attr('opacity', 0.5)
        .text(label)
    }

    // X-axis group — updated in place on zoom
    const xAxisGroup = outerG
      .append('g')
      .attr('class', 'h-x-axis')
      .attr('transform', `translate(0,${chartHeight})`)
    hAxisGroupRef.current = xAxisGroup

    // Clipped content group — cleared and redrawn each frame (like vertical mode)
    const clipped = outerG.append('g').attr('clip-path', 'url(#h-chart-clip)')
    const chartGroup = clipped.append('g').attr('class', 'h-content')

    // draw() clears and redraws all content using the current x-scale.
    // This is fast because the browser batches DOM mutations into a single paint.
    // eslint-disable-next-line complexity -- D3 visualization draw loop
    const draw = (currentXScale: d3.ScaleTime<number, number>) => {
      chartGroup.selectAll('*').remove()
      const ag = hAxisGroupRef.current
      if (!ag) return

      const domain = currentXScale.domain()
      const domainStart = domain[0]!
      const domainEnd = domain[1]!
      const domainStartMs = domainStart.getTime()
      const domainEndMs = domainEnd.getTime()

      // Viewport culling: skip items fully outside the visible domain
      const isInViewport = (item: { start: Date; end: Date }) => {
        const startMs = item.start.getTime()
        const endMs = item.end.getTime()
        return endMs >= domainStartMs && startMs <= domainEndMs
      }

      // ── Time grid lines ──
      const oneHourLater = new Date(domainStart.getTime() + 3600000)
      const pixelsPerHour = Math.abs(currentXScale(oneHourLater) - currentXScale(domainStart))
      let hourIntervalHours: number
      if (pixelsPerHour >= 60) hourIntervalHours = 1
      else if (pixelsPerHour >= 30) hourIntervalHours = 2
      else if (pixelsPerHour >= 15) hourIntervalHours = 4
      else if (pixelsPerHour >= 8) hourIntervalHours = 6
      else if (pixelsPerHour >= 4) hourIntervalHours = 12
      else hourIntervalHours = 24

      const hours = d3.timeHour.range(domainStart, domainEnd)
      const gridHours = hours.filter((d) => d.getHours() % hourIntervalHours === 0)
      for (const h of gridHours) {
        const hx = currentXScale(h)
        chartGroup
          .append('line')
          .attr('x1', hx)
          .attr('x2', hx)
          .attr('y1', 0)
          .attr('y2', chartHeight)
          .attr('stroke', 'currentColor')
          .attr('stroke-opacity', 0.1)
      }

      // Time separators — adapt interval to zoom level
      // pixelsPerHour >= 2  → daily (midnight lines)
      // pixelsPerHour >= 0.3 → weekly (Monday boundaries)
      // otherwise           → monthly (1st of month)
      const separatorDates: Date[] =
        pixelsPerHour >= 2 ? d3.timeDay.range(domainStart, domainEnd)
        : pixelsPerHour >= 0.3 ? d3.timeMonday.range(domainStart, domainEnd)
        : d3.timeMonth.range(domainStart, domainEnd)

      for (const sep of separatorDates) {
        const mx = currentXScale(sep)
        chartGroup
          .append('line')
          .attr('x1', mx)
          .attr('x2', mx)
          .attr('y1', 0)
          .attr('y2', chartHeight)
          .attr('stroke', 'currentColor')
          .attr('stroke-opacity', 0.3)
          .attr('stroke-width', 1.5)
          .attr('stroke-dasharray', '6,3')
      }

      // ── Music staff (sheet-music notation) ──
      if (showMusicTrack) {
        const mergeGapMs = getMergeGapMs(pixelsPerHour)
        const allSessions = mergeScrobblesIntoSessions(scrobbles, mergeGapMs)
        const sessions = allSessions.filter(isInViewport)
        drawMusicSessions(
          chartGroup,
          sessions,
          currentXScale,
          trackMusic,
          showMusicTooltip,
          hideTooltip,
          pixelsPerHour,
        )
      }

      // ── Helper: build detail URL for an item ──
      const getDetailUrl = (item: ChartItem): string | undefined =>
        item.entity_id && item.entity_type ?
          `/detail/${item.entity_type}/${encodeURIComponent(item.entity_id)}`
        : (item.href ?? undefined)

      // ── Activity lane (activities + tags) ──
      for (const { item, lane } of packedActivityItems.items) {
        if (!isInViewport(item)) continue
        const laneY = trackActivity + lane * activitySubLaneHeight
        const laneH = activitySubLaneHeight - 1
        const rx = currentXScale(item.start)
        const detailUrl = getDetailUrl(item)

        if (item.isPoint) {
          // Point tags/metrics: render as icon only in the activity lane
          const icon = item.icon
          const tagCx = rx
          const tagCy = laneY + laneH / 2

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const parent: d3.Selection<any, unknown, null, undefined> =
            detailUrl ?
              chartGroup.append('a').attr('href', detailUrl).attr('data-clickable', 'true')
            : chartGroup

          if (icon && isEmoji(icon)) {
            parent
              .append('text')
              .attr('x', tagCx)
              .attr('y', tagCy)
              .attr('dy', '0.35em')
              .attr('font-size', ICON_SIZE)
              .attr('text-anchor', 'middle')
              .attr('cursor', detailUrl ? 'pointer' : 'default')
              .text(icon)
              .on('mouseenter', (event: MouseEvent) => showTooltip(event, item))
              .on('mouseleave', hideTooltip)
          } else if (icon && isUrl(icon)) {
            parent
              .append('image')
              .attr('href', icon)
              .attr('x', tagCx - ICON_SIZE / 2)
              .attr('y', tagCy - ICON_SIZE / 2)
              .attr('width', ICON_SIZE)
              .attr('height', ICON_SIZE)
              .attr('cursor', detailUrl ? 'pointer' : 'default')
              .on('mouseenter', (event: MouseEvent) => showTooltip(event, item))
              .on('mouseleave', hideTooltip)
          } else {
            // No icon: dashed vertical line
            parent
              .append('line')
              .attr('x1', tagCx)
              .attr('x2', tagCx)
              .attr('y1', laneY)
              .attr('y2', laneY + laneH)
              .attr('stroke', item.color)
              .attr('stroke-width', 1.5)
              .attr('stroke-dasharray', '3,2')
              .attr('opacity', 0.6)
              .attr('cursor', detailUrl ? 'pointer' : 'default')
              .on('mouseenter', (event: MouseEvent) => showTooltip(event, item))
              .on('mouseleave', hideTooltip)
          }
          continue
        }

        // Duration items (activities, duration tags)
        const rw = Math.max(0, currentXScale(item.end) - rx)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parent: d3.Selection<any, unknown, null, undefined> =
          detailUrl ?
            chartGroup.append('a').attr('href', detailUrl).attr('data-clickable', 'true')
          : chartGroup

        parent
          .append('rect')
          .attr('x', rx)
          .attr('y', laneY)
          .attr('width', rw)
          .attr('height', laneH)
          .attr('fill', item.color)
          .attr('opacity', 0.7)
          .attr('rx', 2)
          .attr('cursor', detailUrl ? 'pointer' : 'default')
          .on('mouseenter', function (event: MouseEvent) {
            d3.select(this).attr('opacity', 0.9)
            showTooltip(event, item)
          })
          .on('mouseleave', function () {
            d3.select(this).attr('opacity', 0.7)
            hideTooltip()
          })

        if (item.icon && isEmoji(item.icon)) {
          parent
            .append('text')
            .attr('x', rx + rw / 2)
            .attr('y', laneY + laneH / 2)
            .attr('dy', '0.35em')
            .attr('text-anchor', 'middle')
            .attr('font-size', `${ICON_SIZE}px`)
            .attr('pointer-events', 'none')
            .text(item.icon)
        } else if (item.icon && isUrl(item.icon)) {
          parent
            .append('image')
            .attr('href', item.icon)
            .attr('x', rx + rw / 2 - ICON_SIZE / 2)
            .attr('y', laneY + laneH / 2 - ICON_SIZE / 2)
            .attr('width', ICON_SIZE)
            .attr('height', ICON_SIZE)
            .attr('pointer-events', 'none')
        } else if (rw > 40) {
          const maxChars = Math.floor(rw / 6)
          const text = item.label.length > maxChars ? item.label.slice(0, maxChars) + '…' : item.label
          parent
            .append('text')
            .attr('x', rx + 4)
            .attr('y', laneY + Math.min(laneH * 0.6, 14))
            .attr('fill', 'white')
            .attr('font-size', '0.65rem')
            .attr('pointer-events', 'none')
            .text(text)
        }
      }

      // ── Places lane ──
      const placeItems = chartItems.filter((i) => i.column === 'Location')
      for (const place of placeItems) {
        if (!isInViewport(place)) continue
        const px = currentXScale(place.start)
        const pw = Math.max(0, currentXScale(place.end) - px)
        const placeUrl = getDetailUrl(place)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parent: d3.Selection<any, unknown, null, undefined> =
          placeUrl ? chartGroup.append('a').attr('href', placeUrl).attr('data-clickable', 'true') : chartGroup

        parent
          .append('rect')
          .attr('x', px)
          .attr('y', trackPlaces)
          .attr('width', pw)
          .attr('height', LOCATION_TRACK_HEIGHT)
          .attr('fill', place.color)
          .attr('opacity', 0.7)
          .attr('rx', 2)
          .attr('cursor', placeUrl ? 'pointer' : 'default')
          .on('mouseenter', function (event: MouseEvent) {
            d3.select(this).attr('opacity', 0.9)
            showTooltip(event, place)
          })
          .on('mouseleave', function () {
            d3.select(this).attr('opacity', 0.7)
            hideTooltip()
          })

        // Place name label (when there's enough room)
        if (pw > 30) {
          const maxChars = Math.floor(pw / 6)
          const text = place.label.length > maxChars ? place.label.slice(0, maxChars - 1) + '…' : place.label
          parent
            .append('text')
            .attr('x', px + 4)
            .attr('y', trackPlaces + LOCATION_TRACK_HEIGHT / 2)
            .attr('dy', '0.35em')
            .attr('fill', 'white')
            .attr('font-size', '0.6rem')
            .attr('pointer-events', 'none')
            .text(text)
        }
      }

      // ── Metrics track (HR/HRV band charts + steps/calories bars + combined tooltip) ──
      const showHR = !hiddenCategories.has('hr') && showMetricsTrack
      const showHRV = !hiddenCategories.has('hrv') && showMetricsTrack
      const showSteps = !hiddenCategories.has('steps') && showMetricsTrack
      const showCalories = !hiddenCategories.has('calories') && showMetricsTrack
      const showTL = !hiddenCategories.has('training_load') && showMetricsTrack
      if (showMetricsTrack && (metricsYScales || (showTL && trainingLoadData))) {
        drawMetricsTrack({
          buckets: metricBuckets,
          chartGroup,
          chartWidth,
          hideTooltip,
          outerG,
          pixelsPerHour,
          showCalories,
          showHR,
          showHRV,
          showSteps,
          showTooltipHtml: (event: MouseEvent, html: string) => {
            if (!tooltipRef.current || !containerRef.current) return
            const tip = tooltipRef.current
            const containerRect = containerRef.current.getBoundingClientRect()
            tip.innerHTML = html
            tip.style.display = 'block'
            const x = event.clientX - containerRect.left + 12
            const yRaw = event.clientY - containerRect.top - 10
            const tipH = tip.scrollHeight
            const yMax = containerRect.height - tipH - 4
            const y = Math.min(yRaw, Math.max(yMax, 4))
            tip.style.left = `${Math.min(x, containerRect.width - 320)}px`
            tip.style.top = `${y}px`
          },
          trackHeight: metricsTrackHeight,
          trackY: trackMetrics,
          ...(metricsYScales ?
            { yScales: metricsYScales }
          : { yScales: computeYScales([], trackMetrics, trackMetrics + metricsTrackHeight) }),
          xScale: currentXScale,
          ...(showTL && trainingLoadData ?
            {
              trainingLoadPoints: trainingLoadData.points,
              trainingLoadWorkouts: trainingLoadData.workouts,
              trainingLoadZones: trainingLoadData.zones ?? undefined,
            }
          : {}),
        })
      }

      // ── Training load track (CTL/ATL/TSB overlaid on metrics area) ──
      if (showMetricsTrack && showTL && trainingLoadData) {
        drawTrainingLoadTrack({
          bootstrapping: trainingLoadData.bootstrapping,
          chartGroup,
          points: trainingLoadData.points,
          trackHeight: metricsTrackHeight,
          trackY: trackMetrics,
          workouts: trainingLoadData.workouts,
          xScale: currentXScale,
          zones: trainingLoadData.zones ?? undefined,
        })
      }

      // ── Now line ──
      drawHorizontalNowLine(chartGroup, chartHeight, currentXScale)

      // Update x-axis in place
      ag.call(d3.axisBottom(currentXScale).ticks(8) as never)
        .selectAll('text')
        .style('fill', 'currentColor')
    }

    drawRef.current = draw

    // ── Static HR/HRV y-axes (drawn once per render, not per zoom frame) ──
    if (showMetricsTrack && metricsYScales) {
      outerG
        .append('g')
        .attr('class', 'metrics-y-axis')
        .call(d3.axisLeft(metricsYScales.yHr).ticks(4))
        .selectAll('text')
        .style('fill', HR_COLOR)
      outerG
        .append('g')
        .attr('class', 'metrics-y-axis')
        .attr('transform', `translate(${chartWidth},0)`)
        .call(d3.axisRight(metricsYScales.yHrv).ticks(4))
        .selectAll('text')
        .style('fill', HRV_COLOR)
    }

    draw(d3.scaleTime().domain([effectiveViewStart, effectiveViewEnd]).range([0, chartWidth]))

    if (zoomBehaviorRef.current) {
      isProgrammaticZoom.current = true
      svg.call(zoomBehaviorRef.current)
      svg.call(
        zoomBehaviorRef.current.transform,
        computeHorizontalZoomTransform(baseScale, effectiveViewStart, effectiveViewEnd, chartWidth),
      )
      isProgrammaticZoom.current = false
    }
  }, [
    activityItems,
    chartItems,
    effectiveViewEnd,
    effectiveViewStart,
    horizontalMetricBuckets,
    isItemHidden,
    hiddenCategories,
    scrobbles,
    showMusicTooltip,
    showTooltip,
    hideTooltip,
    trainingLoadQuery.data,
  ])

  // Re-render on data/size change
  useEffect(() => {
    if (orientation === 'vertical') {
      renderVerticalChart()
    } else {
      renderHorizontalChart()
    }
    let resizeRaf = 0
    let lastW = 0
    let lastH = 0
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const w = Math.round(entry.contentRect.width)
      const h = Math.round(entry.contentRect.height)
      // Skip if size hasn't actually changed (avoids render loop from SVG attr changes)
      if (w === lastW && h === lastH) return
      lastW = w
      lastH = h
      cancelAnimationFrame(resizeRaf)
      resizeRaf = requestAnimationFrame(() => {
        if (orientationRef.current === 'vertical') {
          renderVerticalChart()
        } else {
          renderHorizontalChart()
        }
      })
    })
    if (containerRef.current) resizeObserver.observe(containerRef.current)
    return () => {
      cancelAnimationFrame(resizeRaf)
      resizeObserver.disconnect()
    }
  }, [orientation, renderVerticalChart, renderHorizontalChart])

  // ── Zoom behavior — set up once per orientation ────────────────────────────

  useEffect(() => {
    if (!svgRef.current || !baseScaleRef.current) return
    const svg = d3.select(svgRef.current)

    if (orientation === 'vertical') {
      const zoom = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 20])
        .clickDistance(5)
        .filter((event: Event) => event.type !== 'dblclick')
        .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
          if (isProgrammaticZoom.current) return
          const baseScale = baseScaleRef.current
          if (!baseScale) return
          const newY = event.transform.rescaleY(baseScale)
          const newDomain = newY.domain() as [Date, Date]
          const h =
            containerRef.current ?
              Math.max(200, containerRef.current.clientHeight - VERTICAL_MARGIN.top - VERTICAL_MARGIN.bottom)
            : 800
          cancelAnimationFrame(zoomRafRef.current)
          zoomRafRef.current = requestAnimationFrame(() => {
            drawRef.current?.(d3.scaleTime().domain(newDomain).range([0, h]))
          })
        })
        .on('end', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
          if (isProgrammaticZoom.current) return
          const baseScale = baseScaleRef.current
          if (!baseScale) return
          const newY = event.transform.rescaleY(baseScale)
          const newDomain = newY.domain() as [Date, Date]
          handleZoom(newDomain[0], newDomain[1])
        })

      svg.call(zoom)
      zoomBehaviorRef.current = zoom

      const baseScale = baseScaleRef.current
      if (baseScale) {
        const hForZoom =
          containerRef.current ?
            Math.max(200, containerRef.current.clientHeight - VERTICAL_MARGIN.top - VERTICAL_MARGIN.bottom)
          : 800
        const t = computeVerticalZoomTransform(baseScale, effectiveViewStart, effectiveViewEnd, hForZoom)
        isProgrammaticZoom.current = true
        svg.call(zoom.transform, t)
        isProgrammaticZoom.current = false
      }
    } else {
      const containerWidth = containerRef.current?.clientWidth ?? 800
      const chartWidth = containerWidth - HORIZONTAL_MARGIN.left - HORIZONTAL_MARGIN.right

      const zoom = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 50])
        .clickDistance(5)
        .filter((event: Event) => event.type !== 'dblclick')
        .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
          if (isProgrammaticZoom.current) return
          const baseScale = baseScaleRef.current
          if (!baseScale) return
          const newX = event.transform.rescaleX(baseScale)
          const newDomain = newX.domain() as [Date, Date]
          cancelAnimationFrame(zoomRafRef.current)
          zoomRafRef.current = requestAnimationFrame(() => {
            drawRef.current?.(d3.scaleTime().domain(newDomain).range([0, chartWidth]))
          })
        })
        .on('end', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
          if (isProgrammaticZoom.current) return
          const baseScale = baseScaleRef.current
          if (!baseScale) return
          const newX = event.transform.rescaleX(baseScale)
          const newDomain = newX.domain() as [Date, Date]
          handleZoom(newDomain[0], newDomain[1])
        })

      svg.call(zoom)
      zoomBehaviorRef.current = zoom

      const baseScale = baseScaleRef.current
      if (baseScale) {
        const t = computeHorizontalZoomTransform(baseScale, effectiveViewStart, effectiveViewEnd, chartWidth)
        isProgrammaticZoom.current = true
        svg.call(zoom.transform, t)
        isProgrammaticZoom.current = false
      }
    }

    svg.on('dblclick.zoom', () => handleResetToToday())

    return () => {
      cancelAnimationFrame(zoomRafRef.current)
    }
    // Intentionally omitting effectiveViewStart/End — zoom behavior re-setup only on orientation
    // change; view position is handled by render functions
  }, [orientation, handleZoom, handleResetToToday])

  // ── UI state ───────────────────────────────────────────────────────────────

  const isInitialLoad =
    activitiesQuery.isLoading && placesQuery.isLoading && tagsQuery.isLoading && productivityQuery.isLoading

  const errorSources = [
    activitiesQuery.isError && 'activities',
    placesQuery.isError && 'places',
    tagsQuery.isError && 'tags',
    productivityQuery.isError && 'screen time',
  ].filter(Boolean) as string[]

  const viewLabel =
    format(effectiveViewStart, 'MMM d') === format(effectiveViewEnd, 'MMM d') ?
      format(effectiveViewStart, 'MMM d, yyyy')
    : `${format(effectiveViewStart, 'MMM d')} – ${format(effectiveViewEnd, 'MMM d, yyyy')}`

  // ── Render ─────────────────────────────────────────────────────────────────

  const hiddenCount = hiddenCategories.size

  return (
    <div class={`timeline-view${isFullscreen ? ' timeline-fullscreen' : ''}`}>
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
        <span class="timeline-date-label">{viewLabel}</span>
        <button
          class={`nav-btn timeline-refresh-btn${isFetching ? ' timeline-refresh-spinning' : ''}`}
          disabled={isFetching}
          onClick={() =>
            queryClient.invalidateQueries({
              predicate: (query) =>
                typeof query.queryKey[0] === 'string' &&
                (query.queryKey[0] as string).startsWith('timeline-'),
            })
          }
          title={isFetching ? 'Loading…' : 'Refresh data'}
          type="button"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
            <path d="M21 21v-5h-5" />
          </svg>
        </button>

        <div class="timeline-orientation-toggle">
          <button
            class="nav-btn"
            onClick={() => setOrientation(orientation === 'vertical' ? 'horizontal' : 'vertical')}
            title={orientation === 'vertical' ? 'Switch to horizontal layout' : 'Switch to vertical layout'}
            type="button"
          >
            {
              orientation === 'vertical' ?
                // Portrait screen → rotate to landscape
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  {/* Portrait screen */}
                  <rect x="7" y="2" width="10" height="14" rx="2" />
                  {/* Rotation arrow (clockwise, bottom-right) */}
                  <path d="M19 17a7 7 0 0 1-7 5" />
                  <polyline points="16 21 19 17 23 19" />
                </svg>
                // Landscape screen → rotate to portrait
              : <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  {/* Landscape screen */}
                  <rect x="2" y="7" width="14" height="10" rx="2" />
                  {/* Rotation arrow (counter-clockwise, bottom-right) */}
                  <path d="M17 19a7 7 0 0 1-5 -7" />
                  <polyline points="21 16 17 19 19 23" />
                </svg>

            }
          </button>
          <button
            class="nav-btn timeline-fullscreen-btn"
            onClick={() => setIsFullscreen((v) => !v)}
            title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
            type="button"
          >
            {isFullscreen ? '⤡' : '⛶'}
          </button>
        </div>
      </div>

      <div class={`timeline-legend-wrapper${legendCollapsed ? ' collapsed' : ''}`}>
        <button
          class="timeline-legend-toggle"
          onClick={() => setLegendCollapsed((v) => !v)}
          type="button"
          title={legendCollapsed ? 'Show legend' : 'Hide legend'}
        >
          Legend{hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ''}{' '}
          <span class="dropdown-arrow">{legendCollapsed ? '▾' : '▴'}</span>
        </button>
        {!legendCollapsed && (
          <div class="timeline-legend" ref={legendRef}>
            {/* ── Music (top-level) ── */}
            {showMusicColumn && (
              <>
                <button
                  key="music"
                  class={`legend-item${hiddenCategories.has('music') ? ' legend-item-hidden' : ''}`}
                  onClick={() => toggleCategory('music')}
                  type="button"
                >
                  <span class="legend-dot" style={{ background: MUSIC_COLOR }} />
                  Music
                </button>
                <span class="legend-separator" />
              </>
            )}

            {/* ── Activity group ── */}
            <div class="legend-group">
              <button
                key="activity"
                class={`legend-item legend-group-header${hiddenCategories.has('activity') ? ' legend-item-hidden' : ''}`}
                onClick={() => toggleCategory('activity')}
                type="button"
              >
                <span class="legend-dot" style={{ background: activityColors.sleep! }} />
                Activity
              </button>
              {[
                {
                  cat: 'sleep_rest' as LegendCategory,
                  color: activityColors.sleep!,
                  label: 'Sleep/Nap/Rest',
                },
                {
                  cat: 'meditation' as LegendCategory,
                  color: activityColors.meditation!,
                  label: 'Meditation',
                },
                { cat: 'exercise' as LegendCategory, color: hrZoneColors[2]!, label: 'Exercise' },
                { cat: 'tags' as LegendCategory, color: TAG_COLOR, label: 'Tags' },
                { cat: 'calendar' as LegendCategory, color: tagSourceColors.calendar!, label: 'Calendar' },
                ...(orientation === 'vertical' ?
                  [
                    {
                      cat: 'screentime' as LegendCategory,
                      color: productivityColors[1]!,
                      label: 'Screen Time',
                    },
                  ]
                : []),
              ].map(({ cat, color, label }) => (
                <button
                  key={cat}
                  class={`legend-item legend-sub-item${hiddenCategories.has('activity') ? ' legend-sub-item--disabled' : ''}${hiddenCategories.has(cat) ? ' legend-item-hidden' : ''}`}
                  onClick={() => toggleCategory(cat)}
                  type="button"
                >
                  <span class="legend-dot legend-dot-small" style={{ background: color }} />
                  {label}
                </button>
              ))}
            </div>

            <span class="legend-separator" />

            {/* ── Metrics group ── */}
            <div class="legend-group">
              <button
                key="metrics"
                class={`legend-item legend-group-header${hiddenCategories.has('metrics') ? ' legend-item-hidden' : ''}`}
                onClick={() => toggleCategory('metrics')}
                type="button"
              >
                <span class="legend-dot" style={{ background: HR_COLOR }} />
                Metrics
              </button>
              {[
                { cat: 'hr' as LegendCategory, color: HR_COLOR, label: 'HR' },
                { cat: 'hrv' as LegendCategory, color: HRV_COLOR, label: 'HRV' },
                ...(orientation === 'horizontal' ?
                  [
                    { cat: 'steps' as LegendCategory, color: STEPS_COLOR, label: 'Steps' },
                    { cat: 'calories' as LegendCategory, color: CALORIES_COLOR, label: 'Calories' },
                    { cat: 'training_load' as LegendCategory, color: CTL_COLOR, label: 'Training Load' },
                  ]
                : []),
              ].map(({ cat, color, label }) => (
                <button
                  key={cat}
                  class={`legend-item legend-sub-item${hiddenCategories.has('metrics') ? ' legend-sub-item--disabled' : ''}${hiddenCategories.has(cat) ? ' legend-item-hidden' : ''}`}
                  onClick={() => toggleCategory(cat)}
                  type="button"
                >
                  <span class="legend-dot legend-dot-small" style={{ background: color }} />
                  {label}
                </button>
              ))}
            </div>

            <span class="legend-separator" />

            {/* ── Location (top-level) ── */}
            <button
              key="location"
              class={`legend-item${hiddenCategories.has('location') ? ' legend-item-hidden' : ''}`}
              onClick={() => toggleCategory('location')}
              type="button"
            >
              <span class="legend-dot" style={{ background: placeColorPalette[0]! }} />
              Location
            </button>
          </div>
        )}
      </div>

      {/* Overlap warnings UI temporarily disabled — will be redesigned
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
          </details>
        </div>
      )}
      */}

      {errorSources.length > 0 && (
        <div class="error">Failed to load {errorSources.join(', ')} — showing available data</div>
      )}

      {orientation === 'vertical' && !isInitialLoad && (
        <div class="timeline-column-headers" style={{ paddingLeft: `${VERTICAL_MARGIN.left}px` }}>
          {columns.map((col, i) => (
            <div key={col} style={{ flex: 1, paddingLeft: i === 0 ? '0' : '4px', textAlign: 'center' }}>
              {col}
            </div>
          ))}
        </div>
      )}

      <div class="timeline-chart-container" ref={containerRef} onPointerDown={hideTooltip}>
        <svg ref={svgRef} />
        {isInitialLoad && <div class="timeline-chart-loading">Loading…</div>}
        <div class="timeline-tooltip" ref={tooltipRef} style={{ display: 'none' }} />
      </div>

      <p class="timeline-help">Scroll to zoom · Drag to pan · Double-click to reset</p>
    </div>
  )
}

// ── D3 drawing helpers (vertical mode) ───────────────────────────────────────

type ColumnDataEntry = {
  column: Column
  items: { item: ChartItem; lane: number }[]
  laneCount: number
}

const MIN_ITEM_HEIGHT = 4

const mergeSmallItems = (
  packedItems: { item: ChartItem; lane: number }[],
  yScale: d3.ScaleTime<number, number>,
): { item: ChartItem; lane: number }[] => {
  if (packedItems.length === 0) return packedItems

  const sorted = [...packedItems].sort((a, b) => a.item.start.getTime() - b.item.start.getTime())
  const anyTiny = sorted.some(({ item }) => {
    const h = Math.abs(yScale(item.end) - yScale(item.start))
    return h < MIN_ITEM_HEIGHT
  })
  if (!anyTiny) return packedItems

  const result: { item: ChartItem; lane: number }[] = []
  let cluster: { item: ChartItem; lane: number }[] = []

  const flushCluster = () => {
    if (cluster.length === 0) return
    if (cluster.length === 1) {
      result.push(cluster[0]!)
    } else {
      const items = cluster.map((c) => c.item)
      const mergedStart = items.reduce((min, i) => (i.start < min ? i.start : min), items[0]!.start)
      const mergedEnd = items.reduce((max, i) => (i.end > max ? i.end : max), items[0]!.end)
      const first = items[0]!
      const merged: ChartItem = {
        color: first.color,
        column: first.column,
        end: mergedEnd,
        isPoint: false,
        label: `${items.length} items`,
        start: mergedStart,
        tooltip: {
          details: items.map((i) => `${formatTime(i.start)} ${i.label}`),
          time: `${formatTime(mergedStart)} – ${formatTime(mergedEnd)}`,
          title: `${items.length} ${first.column}`,
        },
      }
      result.push({ item: merged, lane: 0 })
    }
    cluster = []
  }

  for (const packed of sorted) {
    const h = Math.abs(yScale(packed.item.end) - yScale(packed.item.start))
    // Keep items that are tall enough, or any item (block or point) that has an icon —
    // icons are always shown regardless of height, so never merge them into a cluster.
    if (h >= MIN_ITEM_HEIGHT || packed.item.icon) {
      flushCluster()
      result.push(packed)
      continue
    }

    if (cluster.length === 0) {
      cluster.push(packed)
    } else {
      const clusterEnd = cluster.reduce(
        (max, c) => (c.item.end > max ? c.item.end : max),
        cluster[0]!.item.end,
      )
      const gapPx = yScale(packed.item.start) - yScale(clusterEnd)
      if (gapPx <= MIN_ITEM_HEIGHT * 2) {
        cluster.push(packed)
      } else {
        flushCluster()
        cluster.push(packed)
      }
    }
  }
  flushCluster()

  return result
}

const stackIconPoints = (
  items: { item: ChartItem; lane: number }[],
  usableWidth: number,
): { item: ChartItem; lane: number; xOffset: number }[] => {
  const pointItems = items.filter((p) => p.item.isPoint)
  if (pointItems.length <= 1) return items.map((p) => ({ ...p, xOffset: 0 }))

  const byTime = new Map<number, { item: ChartItem; lane: number }[]>()
  for (const p of pointItems) {
    const t = p.item.start.getTime()
    const group = byTime.get(t) ?? []
    group.push(p)
    byTime.set(t, group)
  }

  const stackedSet = new Set<ChartItem>()
  const offsetMap = new Map<ChartItem, number>()

  for (const group of byTime.values()) {
    if (group.length <= 1) continue
    group.sort((a, b) => a.item.label.localeCompare(b.item.label))
    // Adapt step size so all icons fit within the available column width
    const maxStep = 18
    const step = Math.min(maxStep, Math.max(8, Math.floor((usableWidth - 20) / group.length)))
    for (let i = 0; i < group.length; i++) {
      stackedSet.add(group[i]!.item)
      offsetMap.set(group[i]!.item, i * step)
    }
  }

  return items.map((p) => {
    if (stackedSet.has(p.item)) {
      return { item: p.item, lane: 0, xOffset: offsetMap.get(p.item) ?? 0 }
    }
    return { ...p, xOffset: 0 }
  })
}

const drawColumnItems = (
  chartGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
  columnData: ColumnDataEntry[],
  colWidth: number,
  colGap: number,
  colPadding: number,
  yScale: d3.ScaleTime<number, number>,
  showTooltip: (event: MouseEvent, item: ChartItem) => void,
  hideTooltip: () => void,
) => {
  for (let colIdx = 0; colIdx < columnData.length; colIdx++) {
    const { items: packedItems, laneCount } = columnData[colIdx]!

    const mergedItems = mergeSmallItems(packedItems, yScale)
    const hasMerged = mergedItems.some((m) => m.item.label.endsWith(' items'))

    const colX = colIdx * colWidth + colGap
    const usableWidth = colWidth - colGap * 2

    const stackedItems = stackIconPoints(mergedItems, usableWidth)

    const hasStacked = stackedItems.some((s) => s.xOffset > 0)
    const nonStackedLanes =
      hasStacked ?
        Math.max(1, ...stackedItems.filter((s) => s.xOffset === 0 && !s.item.isPoint).map((s) => s.lane + 1))
      : laneCount
    const effectiveLanes = hasMerged ? 1 : Math.max(nonStackedLanes, 1)
    const laneWidth = (usableWidth - (effectiveLanes - 1) * colPadding) / effectiveLanes

    for (const { item, lane, xOffset } of stackedItems) {
      const effectiveLane = hasMerged ? 0 : lane
      drawItem(
        chartGroup,
        item,
        effectiveLane,
        colX,
        laneWidth,
        colPadding,
        yScale,
        showTooltip,
        hideTooltip,
        xOffset,
      )
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SvgParent = d3.Selection<any, unknown, null, undefined>

const drawPointMarker = (
  parent: SvgParent,
  item: ChartItem,
  cx: number,
  cy: number,
  size: number,
  laneWidth: number,
  x: number,
  detailUrl: string | undefined,
  showTooltip: (event: MouseEvent, item: ChartItem) => void,
  hideTooltip: () => void,
) => {
  const cursor = detailUrl ? 'pointer' : 'default'

  if (item.icon && isEmoji(item.icon)) {
    parent
      .append('text')
      .attr('x', cx)
      .attr('y', cy)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'middle')
      .attr('font-size', '18px')
      .attr('pointer-events', 'all')
      .attr('cursor', cursor)
      .text(item.icon)
      .on('mouseenter', (event: MouseEvent) => showTooltip(event, item))
      .on('mouseleave', hideTooltip)
    return
  }

  if (item.icon && isUrl(item.icon)) {
    const imgSize = 18
    parent
      .append('image')
      .attr('href', item.icon)
      .attr('x', cx - imgSize / 2)
      .attr('y', cy - imgSize / 2)
      .attr('width', imgSize)
      .attr('height', imgSize)
      .attr('pointer-events', 'all')
      .attr('cursor', cursor)
      .on('mouseenter', (event: MouseEvent) => showTooltip(event, item))
      .on('mouseleave', hideTooltip)
    return
  }

  parent
    .append('polygon')
    .attr('points', `${cx},${cy - size} ${cx + size},${cy} ${cx},${cy + size} ${cx - size},${cy}`)
    .attr('fill', item.color)
    .attr('opacity', 0.85)
    .on('mouseenter', (event: MouseEvent) => showTooltip(event, item))
    .on('mouseleave', hideTooltip)

  const labelX = x + 2 * size + 6
  const availableWidth = laneWidth - 2 * size - 8
  if (availableWidth > 20) {
    const charWidth = 5.5
    const maxChars = Math.floor(availableWidth / charWidth)
    const text = item.label.length > maxChars ? item.label.slice(0, maxChars) + '…' : item.label
    parent
      .append('text')
      .attr('x', labelX)
      .attr('y', cy)
      .attr('dy', '0.35em')
      .attr('fill', item.color)
      .attr('font-size', '0.6rem')
      .attr('opacity', 0.8)
      .attr('pointer-events', 'none')
      .text(text)
  }
}

const drawBlockOverlay = (
  parent: SvgParent,
  item: ChartItem,
  x: number,
  y1: number,
  laneWidth: number,
  blockHeight: number,
) => {
  if (item.icon && isEmoji(item.icon)) {
    parent
      .append('text')
      .attr('x', x + laneWidth / 2)
      .attr('y', y1 + blockHeight / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'middle')
      .attr('font-size', '18px')
      .attr('pointer-events', 'none')
      .text(item.icon)
    return
  }

  if (item.icon && isUrl(item.icon)) {
    const imgSize = 18
    parent
      .append('image')
      .attr('href', item.icon)
      .attr('x', x + laneWidth / 2 - imgSize / 2)
      .attr('y', y1 + blockHeight / 2 - imgSize / 2)
      .attr('width', imgSize)
      .attr('height', imgSize)
      .attr('pointer-events', 'none')
    return
  }

  if (blockHeight > 30) {
    const fontSize = laneWidth > 100 ? '0.8rem' : '0.65rem'
    const charWidth = laneWidth > 100 ? 7.5 : 6
    const maxChars = Math.floor(laneWidth / charWidth)
    const text = item.label.length > maxChars ? item.label.slice(0, maxChars) + '…' : item.label
    parent
      .append('text')
      .attr('x', x + 4)
      .attr('y', y1 + 14)
      .attr('fill', 'white')
      .attr('font-size', fontSize)
      .attr('font-weight', '500')
      .attr('pointer-events', 'none')
      .text(text)
  }
}

const drawItem = (
  chartGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
  item: ChartItem,
  lane: number,
  colX: number,
  laneWidth: number,
  colPadding: number,
  yScale: d3.ScaleTime<number, number>,
  showTooltip: (event: MouseEvent, item: ChartItem) => void,
  hideTooltip: () => void,
  xOffset = 0,
) => {
  const y1 = yScale(item.start)
  const y2 = yScale(item.end)
  const x = colX + lane * (laneWidth + colPadding) + xOffset
  const blockHeight = Math.max(y2 - y1, 2)

  const detailUrl =
    item.entity_id && item.entity_type ?
      `/detail/${item.entity_type}/${encodeURIComponent(item.entity_id)}`
    : (item.href ?? undefined)

  const parent: SvgParent =
    detailUrl ? chartGroup.append('a').attr('href', detailUrl).attr('data-clickable', 'true') : chartGroup

  if (item.isPoint) {
    const size = Math.min(laneWidth / 2, 6)
    drawPointMarker(parent, item, x + size + 2, y1, size, laneWidth, x, detailUrl, showTooltip, hideTooltip)
    return
  }

  parent
    .append('rect')
    .attr('x', x)
    .attr('y', y1)
    .attr('width', laneWidth)
    .attr('height', blockHeight)
    .attr('rx', 3)
    .attr('ry', 3)
    .attr('fill', item.color)
    .attr('opacity', 0.75)
    .on('mouseenter', function (event: MouseEvent) {
      d3.select(this).attr('opacity', 0.95)
      showTooltip(event, item)
    })
    .on('mouseleave', function () {
      d3.select(this).attr('opacity', 0.75)
      hideTooltip()
    })

  drawBlockOverlay(parent, item, x, y1, laneWidth, blockHeight)
}

const drawNowLine = (
  chartGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
  chartWidth: number,
  yScale: d3.ScaleTime<number, number>,
) => {
  const now = new Date()
  const domain = yScale.domain()
  if (now < domain[0]! || now > domain[1]!) return

  const nowY = yScale(now)
  chartGroup
    .append('line')
    .attr('x1', 0)
    .attr('x2', chartWidth)
    .attr('y1', nowY)
    .attr('y2', nowY)
    .attr('stroke', NOW_COLOR)
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '6,3')
  chartGroup
    .append('text')
    .attr('x', chartWidth + 4)
    .attr('y', nowY)
    .attr('dy', '0.35em')
    .attr('fill', NOW_COLOR)
    .attr('font-size', '0.65rem')
    .attr('font-weight', '600')
    .text('Now')
}

const drawHorizontalNowLine = (
  chartGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
  chartHeight: number,
  xScale: d3.ScaleTime<number, number>,
) => {
  const now = new Date()
  const domain = xScale.domain()
  if (now < domain[0]! || now > domain[1]!) return

  const nowX = xScale(now)
  chartGroup
    .append('line')
    .attr('x1', nowX)
    .attr('x2', nowX)
    .attr('y1', 0)
    .attr('y2', chartHeight)
    .attr('stroke', NOW_COLOR)
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '6,3')
  chartGroup
    .append('text')
    .attr('x', nowX)
    .attr('y', -4)
    .attr('text-anchor', 'middle')
    .attr('fill', NOW_COLOR)
    .attr('font-size', '0.65rem')
    .attr('font-weight', '600')
    .text('Now')
}
