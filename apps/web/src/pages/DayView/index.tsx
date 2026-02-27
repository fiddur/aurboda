/* eslint-disable max-lines -- large visualization component */
import { metricUnits as builtinMetricUnits } from '@aurboda/api-spec'
import { signal, useSignalEffect } from '@preact/signals'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import * as d3 from 'd3'
import { addDays, endOfDay, format, formatISO, startOfDay, subDays } from 'date-fns'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  Activity,
  fetchActivities,
  fetchBucketedMetrics,
  fetchCustomMetrics,
  fetchMetricTimeSeriesWithSource,
  fetchPlaces,
  fetchProductivity,
  fetchScrobbles,
  fetchTagMappings,
  fetchTags,
  fetchUserSettings,
  Place,
  ProductivityRecord,
  Scrobble,
  Tag,
  type MetricDataPointWithSource,
} from '../../state/api'
import { isEmoji, isUrl } from '../../utils/emojiLookup'
import { packLanes } from '../../utils/lanePacking'
import { categorizeMusic } from './categorizeMusic'
import { drawActivitySparklines, parseBucketedData } from './drawActivitySparklines'
import { findOverlappingScrobbles } from './findOverlappingScrobbles'
import type { ChartItem, Column } from './types'

import './style.css'

// State: fetch range and view range
const fromDate = signal(formatISO(subDays(new Date(), 1), { representation: 'date' }))
const toDate = signal(formatISO(new Date(), { representation: 'date' }))
const viewStart = signal<Date | null>(null)
const viewEnd = signal<Date | null>(null)

// Default view: start of today to end of today
const getDefaultViewStart = () => startOfDay(new Date())
const getDefaultViewEnd = () => endOfDay(new Date())

// ── URL hash helpers ──────────────────────────────────────────────────────────
// Hash format: #from=2026-02-27T06:00&to=2026-02-27T18:00&hide=sleep,music
// The router (preact-iso) completely ignores hash fragments, so replaceState
// with a hash update never triggers a re-render or route change.

/** Parse window.location.hash into view state. */
const parseViewHash = (): { from: Date | null; to: Date | null; hide: LegendCategory[] } => {
  const hash = window.location.hash.slice(1) // remove leading '#'
  if (!hash) return { from: null, hide: [], to: null }
  const params = new URLSearchParams(hash)
  const fromStr = params.get('from')
  const toStr = params.get('to')
  const hideStr = params.get('hide')
  const from = fromStr ? new Date(fromStr) : null
  const to = toStr ? new Date(toStr) : null
  const hide = hideStr ? (hideStr.split(',').filter(Boolean) as LegendCategory[]) : []
  return {
    from: from && !isNaN(from.getTime()) ? from : null,
    hide,
    to: to && !isNaN(to.getTime()) ? to : null,
  }
}

/** Build hash string from current view state. Returns '' if everything is default (today). */
const buildViewHash = (start: Date | null, end: Date | null, hidden: ReadonlySet<string>): string => {
  const params = new URLSearchParams()
  if (start) params.set('from', start.toISOString())
  if (end) params.set('to', end.toISOString())
  if (hidden.size > 0) params.set('hide', [...hidden].join(','))
  const str = params.toString()
  return str ? `#${str}` : ''
}

// Initialise signals from hash on page load (runs once when module is first loaded).
// Because these are module-level signals they persist across SPA navigations.
const _initialHash = parseViewHash()
if (_initialHash.from) {
  viewStart.value = _initialHash.from
  viewEnd.value = _initialHash.to
  // Expand fetch range to cover the hashed viewport
  const fetchFrom = _initialHash.from
  const fetchTo = _initialHash.to ?? _initialHash.from
  fromDate.value = formatISO(subDays(fetchFrom, 1), { representation: 'date' })
  const todayStr = formatISO(new Date(), { representation: 'date' })
  const expandedTo = formatISO(addDays(fetchTo, 1), { representation: 'date' })
  toDate.value = expandedTo > todayStr ? todayStr : expandedTo
}

// Column definitions
const BASE_COLUMNS: Column[] = ['Sleep / Rest', 'Exercise', 'Location', 'Tags / Events', 'Screen Time']
const MUSIC_COLOR = '#ec4899'

// Colors
const activityColors: Record<string, string> = {
  meditation: '#a855f7',
  nap: '#60a5fa',
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
const METRIC_COLOR = '#14b8a6' // teal for metrics

/** Built-in metrics that are measured occasionally (not continuously streamed from a wearable). */
const OCCASIONAL_BUILTIN_METRICS = [
  'weight',
  'body_fat',
  'bone_mass',
  'lean_body_mass',
  'body_water_mass',
  'height',
  'blood_glucose',
  'blood_pressure_systolic',
  'blood_pressure_diastolic',
  'body_temperature',
  'basal_body_temperature',
  'spo2',
  'vo2_max',
]

/** Maximum data points per metric per day to still show in the day view. */
const OCCASIONAL_METRIC_MAX_COUNT = 10

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

const NOW_COLOR = '#ef4444'

type LegendCategory =
  | 'sleep'
  | 'nap'
  | 'meditation'
  | 'exercise'
  | 'calendar'
  | 'tags'
  | 'metrics'
  | 'music'
  | 'location'
  | 'screentime'

const CATEGORY_MATCHERS: Record<LegendCategory, (item: ChartItem) => boolean> = {
  calendar: (item) => item.column === 'Tags / Events' && item.color === tagSourceColors.calendar,
  exercise: (item) => item.column === 'Exercise',
  location: (item) => item.column === 'Location',
  meditation: (item) => item.column === 'Sleep / Rest' && item.label === 'Meditation',
  metrics: (item) => item.column === 'Tags / Events' && item.color === METRIC_COLOR,
  music: (item) => item.column === 'Music',
  nap: (item) => item.column === 'Sleep / Rest' && item.label === 'Nap',
  screentime: (item) => item.column === 'Screen Time',
  sleep: (item) => item.column === 'Sleep / Rest' && item.label === 'Sleep',
  tags: (item) =>
    item.column === 'Tags / Events' && item.color !== tagSourceColors.calendar && item.color !== METRIC_COLOR,
}

// Helpers
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

/** Oura sleep metrics keyed by date string (YYYY-MM-DD). */
type OuraSleepMetrics = Record<string, number>
type OuraSleepByDate = Map<string, OuraSleepMetrics>

const buildSleepDetails = (a: Activity, end: Date, ouraByDate: OuraSleepByDate): string[] => {
  const details: string[] = []
  details.push(`Bed: ${formatDuration(a.start_time, end)}`)

  if (a.total_sleep !== undefined) {
    const h = Math.floor(a.total_sleep / 60)
    const m = a.total_sleep % 60
    details.push(`Sleep: ${m > 0 ? `${h}h ${m}m` : `${h}h`}`)
  }

  const oura = ouraByDate.get(format(end, 'yyyy-MM-dd'))
  if (oura) {
    if (oura.sleep_score !== undefined) details.push(`ō score: ${Math.round(oura.sleep_score)}`)
    if (oura.sleep_efficiency !== undefined)
      details.push(`ō efficiency: ${Math.round(oura.sleep_efficiency)}%`)
    if (oura.sleep_restfulness !== undefined)
      details.push(`ō restfulness: ${Math.round(oura.sleep_restfulness)}`)
    if (oura.sleep_deep_score !== undefined) details.push(`ō deep: ${Math.round(oura.sleep_deep_score)}`)
    if (oura.sleep_rem_score !== undefined) details.push(`ō REM: ${Math.round(oura.sleep_rem_score)}`)
  }

  if (a.avg_hrv) details.push(`Avg HRV: ${a.avg_hrv} ms`)
  return details
}

// Categorization per column
const categorizeSleepRest = (
  activities: Activity[],
  scrobbles: Scrobble[],
  ouraByDate: OuraSleepByDate,
): ChartItem[] =>
  activities
    .filter(
      (a) => a.activity_type === 'sleep' || a.activity_type === 'nap' || a.activity_type === 'meditation',
    )
    .map((a) => {
      const end = a.end_time ?? new Date(a.start_time.getTime() + 60 * 60000)
      const label =
        a.activity_type === 'sleep' ? 'Sleep'
        : a.activity_type === 'nap' ? 'Nap'
        : 'Meditation'

      const details =
        a.activity_type === 'sleep' ?
          buildSleepDetails(a, end, ouraByDate)
        : [formatDuration(a.start_time, end), ...(a.avg_hrv ? [`Avg HRV: ${a.avg_hrv} ms`] : [])]

      if (a.notes) details.push(a.notes)

      // For meditation, show overlapping scrobbles (artist – track)
      if (a.activity_type === 'meditation') {
        const music = findOverlappingScrobbles(scrobbles, a.start_time, end)
        if (music.length > 0) details.push(`♪ ${music.slice(0, 3).join(', ')}`)
      }

      return {
        activity_type: a.activity_type as 'sleep' | 'nap' | 'meditation',
        color: activityColors[a.activity_type] ?? '#3b82f6',
        column: 'Sleep / Rest' as Column,
        end,
        entity_id: a.id,
        entity_type: 'activity' as const,
        isPoint: false,
        label,
        start: a.start_time,
        tooltip: {
          details,
          time: `${formatTime(a.start_time)} – ${formatTime(end)}`,
          title: label,
        },
      }
    })

const formatHrZones = (zones: Record<number, number>): string | undefined => {
  const total = Object.values(zones).reduce((s, v) => s + v, 0)
  if (total <= 0) return undefined
  const zoneLabels = ['Rest', 'Z1', 'Z2', 'Z3', 'Z4', 'Z5']
  return Object.entries(zones)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${zoneLabels[Number(k)]}: ${Math.round(v / 60)}m`)
    .join(', ')
}

const categorizeExercise = (activities: Activity[]): ChartItem[] =>
  activities
    .filter((a) => a.activity_type === 'exercise')
    .map((a) => {
      const end = a.end_time ?? new Date(a.start_time.getTime() + 60 * 60000)
      const typeName = getExerciseTypeName(a)
      const details: string[] = [formatDuration(a.start_time, end)]
      if (a.notes) details.push(a.notes)
      const zones = a.hr_zone_secs as Record<number, number> | undefined
      if (zones) {
        const zoneStr = formatHrZones(zones)
        if (zoneStr) details.push(zoneStr)
      }
      return {
        activity_type: 'exercise' as const,
        color: getExerciseColor(a),
        column: 'Exercise' as Column,
        end,
        entity_id: a.id,
        entity_type: 'activity' as const,
        isPoint: false,
        label: typeName,
        start: a.start_time,
        tooltip: {
          details,
          time: `${formatTime(a.start_time)} – ${formatTime(end)}`,
          title: typeName,
        },
      }
    })

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

const categorizeTags = (tags: Tag[], tagIcons: Record<string, string>): ChartItem[] =>
  tags
    .filter((t) => t.source !== 'lastfm')
    .map((t) => {
      const isPoint = !t.end_time
      const end = t.end_time ?? new Date(t.start_time.getTime() + 15 * 60000)
      const sourceLabel = t.source ? ` (${t.source})` : ''
      // Look up icon by tag name (case-insensitive) or by tag_key
      const icon =
        tagIcons[t.tag] ?? tagIcons[t.tag.toLowerCase()] ?? (t.tag_key ? tagIcons[t.tag_key] : undefined)
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

/** Map metric name to human-readable display label. */
const formatMetricLabel = (metric: string): string =>
  metric.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

/**
 * Categorize metric data points into chart items for the Tags / Events lane.
 * Only includes metrics with <= OCCASIONAL_METRIC_MAX_COUNT data points per day.
 */
const categorizeOccasionalMetrics = (
  dataPoints: MetricDataPointWithSource[],
  metricUnits: Record<string, string>,
): ChartItem[] => {
  if (!dataPoints || dataPoints.length === 0) return []

  // Count total data points per metric
  const metricCounts: Record<string, number> = {}
  for (const dp of dataPoints) {
    metricCounts[dp.metric] = (metricCounts[dp.metric] ?? 0) + 1
  }

  // Only include metrics that are truly "occasional"
  const occasionalMetrics = new Set(
    Object.entries(metricCounts)
      .filter(([, count]) => count <= OCCASIONAL_METRIC_MAX_COUNT)
      .map(([metric]) => metric),
  )

  if (occasionalMetrics.size === 0) return []

  return dataPoints
    .filter((dp) => occasionalMetrics.has(dp.metric))
    .map((dp) => {
      const unit = metricUnits[dp.metric] ?? ''
      const displayValue = Number(dp.value.toFixed(2))
      const valueStr = `${displayValue}${unit ? ` ${unit}` : ''}`
      const metricLabel = formatMetricLabel(dp.metric)
      const end = new Date(dp.time.getTime() + 15 * 60000)
      const entityId = `${dp.time.toISOString()}|${dp.metric}|${dp.source}`

      return {
        color: METRIC_COLOR,
        column: 'Tags / Events' as Column,
        end,
        entity_id: entityId,
        entity_type: 'metric' as const,
        isPoint: true,
        label: `${metricLabel}: ${valueStr}`,
        start: dp.time,
        tooltip: {
          details: [`Value: ${valueStr}`, `Source: ${dp.source}`, 'Metric measurement'],
          time: formatTime(dp.time),
          title: metricLabel,
        },
      }
    })
}

const categorizeProductivity = (productivity: ProductivityRecord[]): ChartItem[] =>
  productivity.map((p) => ({
    color: getProductivityColor(p.productivity),
    column: 'Screen Time' as Column,
    end: p.end_time,
    entity_id: p.id,
    entity_type: 'productivity' as const,
    isPoint: false,
    label: p.activity,
    start: p.start_time,
    tooltip: {
      details: [
        p.category ?? '',
        formatDuration(p.start_time, p.end_time),
        `Score: ${p.productivity ?? 0}`,
      ].filter(Boolean),
      time: `${formatTime(p.start_time)} – ${formatTime(p.end_time)}`,
      title: p.activity,
    },
  }))

// Build HR zone bar HTML for exercise tooltips
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

const buildTooltipHtml = (item: ChartItem, music: string[], activities: Activity[]): string => {
  let html = `<div class="tooltip-title">${escapeHtml(item.tooltip.title)}</div>`
  html += `<div class="tooltip-time">${escapeHtml(item.tooltip.time)}</div>`
  for (const d of item.tooltip.details) {
    html += `<div class="tooltip-detail">${escapeHtml(d)}</div>`
  }

  if (item.column === 'Exercise') {
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

const margin = { bottom: 10, left: 60, right: 10, top: 30 }
const CHART_HEIGHT = 800

/** Convert a view date range into the D3 zoom transform that maps baseScale onto that window. */
const computeZoomTransform = (
  baseScale: d3.ScaleTime<number, number>,
  vStart: Date,
  vEnd: Date,
): d3.ZoomTransform => {
  const by0 = baseScale(vStart)
  const by1 = baseScale(vEnd)
  const k = CHART_HEIGHT / (by1 - by0)
  return d3.zoomIdentity.translate(0, -k * by0).scale(k)
}

// eslint-disable-next-line complexity -- D3 visualization component
export const DayView = () => {
  const effectiveViewStart = viewStart.value ?? getDefaultViewStart()
  const effectiveViewEnd = viewEnd.value ?? getDefaultViewEnd()

  // Fetch range: includes a buffer around the view
  const fetchStart = startOfDay(new Date(fromDate.value))
  const fetchEnd = endOfDay(new Date(toDate.value))

  const activitiesQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () =>
      fetchActivities(subDays(fetchStart, 0.5), addDays(fetchEnd, 0.5), [
        'sleep',
        'exercise',
        'meditation',
        'nap',
      ]),
    queryKey: ['dayview-activities', fromDate.value, toDate.value],
    staleTime: 5 * 60 * 1000,
  })

  const placesQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => fetchPlaces(subDays(fetchStart, 0.5), addDays(fetchEnd, 0.5)),
    queryKey: ['dayview-places', fromDate.value, toDate.value],
    staleTime: 5 * 60 * 1000,
  })

  const tagsQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => fetchTags(subDays(fetchStart, 0.5), addDays(fetchEnd, 0.5)),
    queryKey: ['dayview-tags', fromDate.value, toDate.value],
    staleTime: 5 * 60 * 1000,
  })

  const productivityQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => fetchProductivity(fetchStart, fetchEnd),
    queryKey: ['dayview-productivity', fromDate.value, toDate.value],
    staleTime: 5 * 60 * 1000,
  })

  const settingsQuery = useQuery({
    queryFn: fetchUserSettings,
    queryKey: ['user-settings'],
    staleTime: 30 * 60 * 1000,
  })

  const ouraMetricsQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () =>
      fetchBucketedMetrics(
        subDays(fetchStart, 0.5),
        addDays(fetchEnd, 0.5),
        ['sleep_score', 'sleep_efficiency', 'sleep_restfulness', 'sleep_deep_score', 'sleep_rem_score'],
        '1d',
      ),
    queryKey: ['dayview-oura-sleep', fromDate.value, toDate.value],
    staleTime: 5 * 60 * 1000,
  })

  const hasLastFm = Boolean(settingsQuery.data?.lastfm_username)

  const scrobblesQuery = useQuery({
    enabled: hasLastFm,
    placeholderData: keepPreviousData,
    queryFn: () => fetchScrobbles(subDays(fetchStart, 0.5), addDays(fetchEnd, 0.5)),
    queryKey: ['dayview-scrobbles', fromDate.value, toDate.value],
    staleTime: 5 * 60 * 1000,
  })

  // Fetch HR/HRV bucketed data for sparkline overlays on activities
  const sparklineMetricsQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () =>
      fetchBucketedMetrics(
        subDays(fetchStart, 0.5),
        addDays(fetchEnd, 0.5),
        ['heart_rate', 'hrv_rmssd'],
        '5m',
      ),
    queryKey: ['dayview-sparkline-metrics', fromDate.value, toDate.value],
    staleTime: 5 * 60 * 1000,
  })

  // Fetch tag mappings with icons
  const tagMappingsQuery = useQuery({
    queryFn: fetchTagMappings,
    queryKey: ['tag-mappings'],
    staleTime: 30 * 60 * 1000,
  })

  // Fetch custom metric definitions to know which custom metrics to show
  const customMetricsQuery = useQuery({
    queryFn: fetchCustomMetrics,
    queryKey: ['custom-metrics'],
    staleTime: 30 * 60 * 1000,
  })

  // Build list of all occasional metric names (built-in + custom)
  const occasionalMetricNames = useMemo(() => {
    const customNames = (customMetricsQuery.data ?? []).map((m) => m.name)
    return [...OCCASIONAL_BUILTIN_METRICS, ...customNames]
  }, [customMetricsQuery.data])

  // Build metric units map (built-in + custom)
  const allMetricUnits = useMemo(() => {
    const units: Record<string, string> = { ...builtinMetricUnits }
    for (const m of customMetricsQuery.data ?? []) {
      units[m.name] = m.unit
    }
    return units
  }, [customMetricsQuery.data])

  // Fetch occasional metric data with source info for entity linking
  const occasionalMetricsQuery = useQuery({
    enabled: occasionalMetricNames.length > 0,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const start = subDays(fetchStart, 0.5)
      const end = addDays(fetchEnd, 0.5)
      const results = await Promise.all(
        occasionalMetricNames.map((metric) => fetchMetricTimeSeriesWithSource(metric, start, end)),
      )
      return results.flat()
    },
    queryKey: ['dayview-occasional-metrics', fromDate.value, toDate.value, occasionalMetricNames],
    staleTime: 5 * 60 * 1000,
  })

  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown>>()
  const isProgrammaticZoom = useRef(false)
  const baseScaleRef = useRef<d3.ScaleTime<number, number>>()
  const zoomRafRef = useRef<number>(0)
  // Holds the latest `draw` function so the zoom effect can call it without re-binding
  const drawRef = useRef<((scale: d3.ScaleTime<number, number>) => void) | null>(null)

  // Pin the base scale domain to today's calendar date (not new Date() each call).
  // This prevents sub-millisecond drift causing visible jumps when the transform is
  // re-applied after a Preact re-render.
  const todayKey = format(new Date(), 'yyyy-MM-dd')
  const baseScaleDomain = useMemo(
    () => [startOfDay(new Date(todayKey)), endOfDay(new Date(todayKey))] as [Date, Date],
    [todayKey],
  )

  // Handle zoom - update view range and expand data fetch if needed
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

  // Navigation: jump by days
  const handleJumpDays = useCallback(
    (days: number) => {
      const currentStart = viewStart.value ?? getDefaultViewStart()
      const currentEnd = viewEnd.value ?? getDefaultViewEnd()
      const newStart = addDays(currentStart, days)
      const newEnd = addDays(currentEnd, days)

      // Don't allow panning into the future
      const todayEnd = endOfDay(new Date())
      if (newEnd > todayEnd) return

      handleZoom(newStart, newEnd)
    },
    [handleZoom],
  )

  // Reset to today
  const handleResetToToday = useCallback(() => {
    viewStart.value = null
    viewEnd.value = null
    fromDate.value = formatISO(subDays(new Date(), 1), { representation: 'date' })
    toDate.value = formatISO(new Date(), { representation: 'date' })
  }, [])

  const [hiddenCategories, setHiddenCategories] = useState<Set<LegendCategory>>(
    () => new Set(_initialHash.hide),
  )

  // Keep a ref so useSignalEffect can read the latest hiddenCategories without re-subscribing
  const hiddenCategoriesRef = useRef<Set<LegendCategory>>(hiddenCategories)
  hiddenCategoriesRef.current = hiddenCategories

  // Sync view state → URL hash whenever viewStart or viewEnd signals change
  useSignalEffect(() => {
    const hash = buildViewHash(viewStart.value, viewEnd.value, hiddenCategoriesRef.current)
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`)
  })

  // Also sync when hiddenCategories changes (toggling legend items)
  useEffect(() => {
    const hash = buildViewHash(viewStart.value, viewEnd.value, hiddenCategories)
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`)
  }, [hiddenCategories])

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
      for (const cat of hiddenCategories) {
        if (CATEGORY_MATCHERS[cat](item)) return true
      }
      return false
    },
    [hiddenCategories],
  )

  const activities = activitiesQuery.data ?? []
  const places = placesQuery.data ?? []
  const tags = tagsQuery.data ?? []
  const productivity = productivityQuery.data ?? []
  const scrobbles = scrobblesQuery.data ?? []

  // Memoize the Oura sleep metrics map so its identity is stable across re-renders
  const ouraByDate = useMemo<OuraSleepByDate>(() => {
    const map: OuraSleepByDate = new Map()
    for (const bucket of ouraMetricsQuery.data?.buckets ?? []) {
      const key = format(new Date(bucket.start), 'yyyy-MM-dd')
      const metrics: OuraSleepMetrics = {}
      for (const [metric, stats] of Object.entries(bucket.metrics)) {
        metrics[metric] = stats.avg
      }
      map.set(key, metrics)
    }
    return map
  }, [ouraMetricsQuery.data])

  const musicItems = useMemo(() => (hasLastFm ? categorizeMusic(scrobbles) : []), [hasLastFm, scrobbles])
  const showMusicColumn = musicItems.length > 0

  const occasionalMetricItems = useMemo(
    () => categorizeOccasionalMetrics(occasionalMetricsQuery.data ?? [], allMetricUnits),
    [occasionalMetricsQuery.data, allMetricUnits],
  )

  // Build tag icon lookup from tag mappings
  const tagIcons = useMemo<Record<string, string>>(() => {
    const icons = tagMappingsQuery.data?.icons ?? {}
    return icons
  }, [tagMappingsQuery.data])

  // Parse sparkline bucketed data
  const sparklineBuckets = useMemo(
    () => parseBucketedData(sparklineMetricsQuery.data),
    [sparklineMetricsQuery.data],
  )

  // Sparkline overlay toggles
  const [showSparklineHR, setShowSparklineHR] = useState(true)
  const [showSparklineHRV, setShowSparklineHRV] = useState(true)

  const allColumns: Column[] = useMemo(
    () => (showMusicColumn ? [...BASE_COLUMNS, 'Music'] : BASE_COLUMNS),
    [showMusicColumn],
  )

  const uniquePlaceNames = useMemo(
    () => [...new Set(places.map((p) => p.region))].filter(Boolean).sort(),
    [places],
  )

  // All chart items before visibility filtering — stable across re-renders when data is unchanged
  const allChartItems = useMemo(
    () => [
      ...categorizeSleepRest(activities, scrobbles, ouraByDate),
      ...categorizeExercise(activities),
      ...categorizeLocations(places, uniquePlaceNames),
      ...categorizeTags(tags, tagIcons),
      ...categorizeProductivity(productivity),
      ...occasionalMetricItems,
      ...musicItems,
    ],
    [
      activities,
      scrobbles,
      ouraByDate,
      places,
      uniquePlaceNames,
      tags,
      tagIcons,
      productivity,
      occasionalMetricItems,
      musicItems,
    ],
  )

  const chartItems = useMemo(
    () => allChartItems.filter((item) => !isItemHidden(item)),
    [allChartItems, isItemHidden],
  )

  // Only show columns that have visible items
  const columns = useMemo(
    () => allColumns.filter((col) => chartItems.some((item) => item.column === col)),
    [allColumns, chartItems],
  )

  // Group by column and pack lanes
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
    occasionalMetricsQuery.isFetching ||
    sparklineMetricsQuery.isFetching

  // Render SVG chart (data/structure only — zoom behavior is set up separately)
  const renderChart = useCallback(() => {
    if (!svgRef.current || !containerRef.current) return

    const containerWidth = containerRef.current.clientWidth
    const chartWidth = containerWidth - margin.left - margin.right

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', containerWidth).attr('height', CHART_HEIGHT + margin.top + margin.bottom)

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    // Base scale maps today's full day to the chart height.
    // Domain is pinned via useMemo to avoid sub-millisecond drift on each render.
    const baseScale = d3.scaleTime().domain(baseScaleDomain).range([0, CHART_HEIGHT])
    baseScaleRef.current = baseScale

    // Current view scale
    const yScale = d3.scaleTime().domain([effectiveViewStart, effectiveViewEnd]).range([0, CHART_HEIGHT])

    // Column layout
    const colWidth = chartWidth / columns.length
    const colGap = 4
    const colPadding = 2

    // Clip path
    const defs = svg.append('defs')
    defs
      .append('clipPath')
      .attr('id', 'chart-clip')
      .append('rect')
      .attr('width', chartWidth)
      .attr('height', CHART_HEIGHT)

    const chartGroup = g.append('g').attr('clip-path', 'url(#chart-clip)')

    const showTooltip = (event: MouseEvent, item: ChartItem) => {
      if (!tooltipRef.current || !containerRef.current) return
      const music = findOverlappingScrobbles(scrobbles, item.start, item.end)
      const tip = tooltipRef.current
      const containerRect = containerRef.current.getBoundingClientRect()

      tip.innerHTML = buildTooltipHtml(item, music, activities)
      tip.style.display = 'block'

      const x = event.clientX - containerRect.left + 12
      const y = event.clientY - containerRect.top - 10
      tip.style.left = `${Math.min(x, containerRect.width - 320)}px`
      tip.style.top = `${y}px`
    }

    const hideTooltip = () => {
      if (tooltipRef.current) tooltipRef.current.style.display = 'none'
    }

    // Draw function — also stored in a ref so the zoom effect can call the latest
    // version without needing to re-bind the zoom behavior on every data change.
    const draw = (currentYScale: d3.ScaleTime<number, number>) => {
      chartGroup.selectAll('*').remove()
      g.selectAll('.hour-label').remove()
      g.selectAll('.day-label').remove()

      const domain = currentYScale.domain()
      const domainStart = domain[0]!
      const domainEnd = domain[1]!

      // Determine adaptive hour interval based on pixels-per-hour
      const oneHourLater = new Date(domainStart.getTime() + 3600000)
      const pixelsPerHour = Math.abs(currentYScale(oneHourLater) - currentYScale(domainStart))
      let hourIntervalHours: number
      if (pixelsPerHour >= 30) hourIntervalHours = 1
      else if (pixelsPerHour >= 15) hourIntervalHours = 2
      else if (pixelsPerHour >= 8) hourIntervalHours = 4
      else if (pixelsPerHour >= 4) hourIntervalHours = 6
      else if (pixelsPerHour >= 2) hourIntervalHours = 12
      else hourIntervalHours = 24

      // Hourly grid lines (always every hour for fine grid, but subtle)
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

      // Hour labels on left — only at the adaptive interval to avoid overlap
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

      // Midnight / day boundary markers
      const midnights = d3.timeDay.range(domainStart, domainEnd)
      for (const midnight of midnights) {
        const my = currentYScale(midnight)
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

        // Day label
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
          .text(format(midnight, 'MMM d'))
      }

      // Column separators
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

      // Draw items per column
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

      // Draw sparkline overlays on activity blocks
      if (sparklineBuckets.length > 0 && (showSparklineHR || showSparklineHRV)) {
        // Build a lookup for item layout positions based on column data
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
          showSparklineHR,
          showSparklineHRV,
          getItemRect,
        )
      }

      // Now line
      drawNowLine(chartGroup, chartWidth, currentYScale)
    }

    // Keep the ref up-to-date so the zoom handler always calls the latest draw
    drawRef.current = draw

    // Initial draw with current view
    draw(yScale)

    // Re-attach the zoom behavior (it was unbound by svg.selectAll('*').remove() above)
    // and restore the current transform without firing the zoom handler.
    if (zoomBehaviorRef.current) {
      isProgrammaticZoom.current = true
      svg.call(zoomBehaviorRef.current)
      svg.call(
        zoomBehaviorRef.current.transform,
        computeZoomTransform(baseScale, effectiveViewStart, effectiveViewEnd),
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
    scrobbles,
    activities,
    sparklineBuckets,
    showSparklineHR,
    showSparklineHRV,
  ])

  // Re-render on data change and resize
  useEffect(() => {
    renderChart()
    const resizeObserver = new ResizeObserver(() => renderChart())
    if (containerRef.current) resizeObserver.observe(containerRef.current)
    return () => resizeObserver.disconnect()
  }, [renderChart])

  // Set up the D3 zoom behavior once (or when the draw function / reset handler changes).
  // Keeping zoom setup separate from renderChart means the zoom behavior survives data
  // re-renders without being torn down and re-created on every frame.
  useEffect(() => {
    if (!svgRef.current || !baseScaleRef.current) return
    const svg = d3.select(svgRef.current)

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 20])
      .clickDistance(5)
      .filter((event: Event) => event.type !== 'dblclick')
      .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        if (isProgrammaticZoom.current) return
        cancelAnimationFrame(zoomRafRef.current)
        zoomRafRef.current = requestAnimationFrame(() => {
          // Only redraw — do NOT update Preact signals here. That would trigger a
          // component re-render → renderChart → SVG teardown on every drag frame.
          const baseScale = baseScaleRef.current
          if (!baseScale) return
          const newY = event.transform.rescaleY(baseScale)
          const newDomain = newY.domain() as [Date, Date]
          drawRef.current?.(d3.scaleTime().domain(newDomain).range([0, CHART_HEIGHT]))
        })
      })
      .on('end', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        if (isProgrammaticZoom.current) return
        // Commit the final position to Preact state once the user lifts their finger/mouse.
        const baseScale = baseScaleRef.current
        if (!baseScale) return
        const newY = event.transform.rescaleY(baseScale)
        const newDomain = newY.domain() as [Date, Date]
        handleZoom(newDomain[0], newDomain[1])
      })

    svg.call(zoom)
    zoomBehaviorRef.current = zoom

    // Apply the current view as the initial transform
    const baseScale = baseScaleRef.current
    if (baseScale) {
      const t = computeZoomTransform(baseScale, effectiveViewStart, effectiveViewEnd)
      isProgrammaticZoom.current = true
      svg.call(zoom.transform, t)
      isProgrammaticZoom.current = false
    }

    // Double-click resets to today
    svg.on('dblclick.zoom', () => handleResetToToday())

    return () => {
      cancelAnimationFrame(zoomRafRef.current)
    }
  }, [handleZoom, handleResetToToday, effectiveViewStart, effectiveViewEnd])

  const isLoading =
    activitiesQuery.isLoading || placesQuery.isLoading || tagsQuery.isLoading || productivityQuery.isLoading
  const isError =
    activitiesQuery.isError || placesQuery.isError || tagsQuery.isError || productivityQuery.isError

  // Build sorted list of all items for mobile view
  const mobileItems = [...chartItems].sort((a, b) => a.start.getTime() - b.start.getTime())

  // Date range label for navigation
  const viewLabel =
    format(effectiveViewStart, 'MMM d') === format(effectiveViewEnd, 'MMM d') ?
      format(effectiveViewStart, 'MMM d, yyyy')
    : `${format(effectiveViewStart, 'MMM d')} – ${format(effectiveViewEnd, 'MMM d, yyyy')}`

  return (
    <div class="day-view">
      <h1>Day View</h1>

      <div class="day-view-controls">
        <div class="day-view-nav">
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
        <span class="day-view-date-label">{viewLabel}</span>
        {isFetching && !isLoading && <span class="day-view-fetching">Loading...</span>}
      </div>

      <div class="day-view-legend">
        {(
          [
            { cat: 'sleep' as LegendCategory, color: activityColors.sleep!, label: 'Sleep' },
            { cat: 'nap' as LegendCategory, color: activityColors.nap!, label: 'Nap' },
            { cat: 'meditation' as LegendCategory, color: activityColors.meditation!, label: 'Meditation' },
            { cat: 'exercise' as LegendCategory, color: hrZoneColors[2]!, label: 'Exercise' },
            { cat: 'location' as LegendCategory, color: placeColorPalette[0]!, label: 'Location' },
            { cat: 'calendar' as LegendCategory, color: tagSourceColors.calendar!, label: 'Calendar' },
            { cat: 'tags' as LegendCategory, color: TAG_COLOR, label: 'Tags' },
            ...(occasionalMetricItems.length > 0 ?
              [{ cat: 'metrics' as LegendCategory, color: METRIC_COLOR, label: 'Metrics' }]
            : []),
            { cat: 'screentime' as LegendCategory, color: productivityColors[1]!, label: 'Screen Time' },
            ...(showMusicColumn ?
              [{ cat: 'music' as LegendCategory, color: MUSIC_COLOR, label: 'Music' }]
            : []),
          ] as { cat: LegendCategory; color: string; label: string }[]
        ).map(({ cat, color, label }) => (
          <button
            key={cat}
            class={`legend-item${hiddenCategories.has(cat) ? ' legend-item-hidden' : ''}`}
            onClick={() => toggleCategory(cat)}
            type="button"
          >
            <span class="legend-dot" style={{ background: color }} />
            {label}
          </button>
        ))}
        <span class="legend-separator" />
        <button
          class={`legend-item${!showSparklineHR ? ' legend-item-hidden' : ''}`}
          onClick={() => setShowSparklineHR((v) => !v)}
          type="button"
          title="Toggle HR sparklines on activities"
        >
          <span class="legend-dot" style={{ background: '#ef4444' }} />
          HR
        </button>
        <button
          class={`legend-item${!showSparklineHRV ? ' legend-item-hidden' : ''}`}
          onClick={() => setShowSparklineHRV((v) => !v)}
          type="button"
          title="Toggle HRV sparklines on activities"
        >
          <span class="legend-dot" style={{ background: '#14b8a6' }} />
          HRV
        </button>
      </div>

      {isLoading && <div class="loading">Loading…</div>}
      {isError && <div class="error">Error loading data</div>}

      {!isLoading && !isError && (
        <>
          <div class="day-view-column-headers" style={{ paddingLeft: `${margin.left}px` }}>
            {columns.map((col, i) => (
              <div
                key={col}
                style={{
                  flex: 1,
                  paddingLeft: i === 0 ? '0' : '4px',
                  textAlign: 'center',
                }}
              >
                {col}
              </div>
            ))}
          </div>

          <div class="day-view-chart-container" ref={containerRef}>
            <svg ref={svgRef} />
            <div class="day-view-tooltip" ref={tooltipRef} style={{ display: 'none' }} />
          </div>

          <p class="day-view-help">Scroll to zoom · Drag to pan · Double-click to reset</p>

          <div class="day-view-list">
            {mobileItems.length === 0 && <p class="loading">No data for this day</p>}
            {mobileItems.map((item, idx) => {
              const href =
                item.entity_id && item.entity_type ?
                  `/detail/${item.entity_type}/${encodeURIComponent(item.entity_id)}`
                : (item.href ?? undefined)
              const Wrapper = href ? 'a' : 'div'
              return (
                <Wrapper
                  class={`day-view-list-item${href ? ' clickable' : ''}`}
                  key={idx}
                  {...(href ? { href } : {})}
                >
                  <span class="list-dot" style={{ background: item.color }} />
                  <span class="list-time">{item.tooltip.time}</span>
                  <div class="list-content">
                    <div class="list-title">{item.label}</div>
                    {item.tooltip.details.map((d, i) => (
                      <div class="list-detail" key={i}>
                        {d}
                      </div>
                    ))}
                  </div>
                </Wrapper>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// D3 drawing helpers extracted to reduce component complexity

type ColumnDataEntry = {
  column: Column
  items: { item: ChartItem; lane: number }[]
  laneCount: number
}

/** Minimum rendered height (px) before items get merged into a cluster. */
const MIN_ITEM_HEIGHT = 4

/**
 * Merge items that would render too small to see individually.
 * Items whose height < MIN_ITEM_HEIGHT and that are close together (gap < MIN_ITEM_HEIGHT px)
 * are grouped into a single merged block with a combined tooltip.
 */
const mergeSmallItems = (
  packedItems: { item: ChartItem; lane: number }[],
  yScale: d3.ScaleTime<number, number>,
): { item: ChartItem; lane: number }[] => {
  if (packedItems.length === 0) return packedItems

  // Sort by start time for grouping
  const sorted = [...packedItems].sort((a, b) => a.item.start.getTime() - b.item.start.getTime())

  // Check if any items are tiny
  const anyTiny = sorted.some(({ item }) => {
    const h = Math.abs(yScale(item.end) - yScale(item.start))
    return h < MIN_ITEM_HEIGHT
  })
  if (!anyTiny) return packedItems

  // Group nearby tiny items; large items stay as-is
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
    if (h >= MIN_ITEM_HEIGHT) {
      // Large item: flush pending cluster then add as-is
      flushCluster()
      result.push(packed)
      continue
    }

    // Small item: check if it's close to the current cluster's end
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

    // Merge tiny items adaptively based on current zoom level
    const mergedItems = mergeSmallItems(packedItems, yScale)
    const hasMerged = mergedItems.some((m) => m.item.label.endsWith(' items'))

    const colX = colIdx * colWidth + colGap
    const usableWidth = colWidth - colGap * 2
    // If merging happened, use full column width for merged blocks
    const effectiveLanes = hasMerged ? 1 : Math.max(laneCount, 1)
    const lanes = effectiveLanes
    const laneWidth = (usableWidth - (lanes - 1) * colPadding) / lanes

    for (const { item, lane } of mergedItems) {
      const effectiveLane = hasMerged ? 0 : lane
      drawItem(chartGroup, item, effectiveLane, colX, laneWidth, colPadding, yScale, showTooltip, hideTooltip)
    }
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
) => {
  const y1 = yScale(item.start)
  const y2 = yScale(item.end)
  const x = colX + lane * (laneWidth + colPadding)
  const blockHeight = Math.max(y2 - y1, 2)

  const detailUrl =
    item.entity_id && item.entity_type ?
      `/detail/${item.entity_type}/${encodeURIComponent(item.entity_id)}`
    : (item.href ?? undefined)

  // Wrap clickable items in an SVG <a> so the browser handles middle-click,
  // right-click context menu, ctrl+click etc. natively.
  const parent =
    detailUrl ? chartGroup.append('a').attr('href', detailUrl).attr('data-clickable', 'true') : chartGroup

  if (item.isPoint) {
    const cy = y1
    const size = Math.min(laneWidth / 2, 6)
    const cx = x + size + 2

    if (item.icon && isEmoji(item.icon)) {
      // Render emoji instead of diamond marker
      const emojiSize = Math.min(laneWidth * 0.4, 16)
      parent
        .append('text')
        .attr('x', cx)
        .attr('y', cy)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'middle')
        .attr('font-size', `${emojiSize}px`)
        .attr('pointer-events', 'all')
        .attr('cursor', detailUrl ? 'pointer' : 'default')
        .text(item.icon)
        .on('mouseenter', (event: MouseEvent) => showTooltip(event, item))
        .on('mouseleave', hideTooltip)
    } else if (item.icon && isUrl(item.icon)) {
      // Render custom image icon
      const imgSize = Math.min(laneWidth * 0.4, 16)
      parent
        .append('image')
        .attr('href', item.icon)
        .attr('x', cx - imgSize / 2)
        .attr('y', cy - imgSize / 2)
        .attr('width', imgSize)
        .attr('height', imgSize)
        .attr('pointer-events', 'all')
        .on('mouseenter', (event: MouseEvent) => showTooltip(event, item))
        .on('mouseleave', hideTooltip)
    } else {
      // Default diamond marker
      parent
        .append('polygon')
        .attr('points', `${cx},${cy - size} ${cx + size},${cy} ${cx},${cy + size} ${cx - size},${cy}`)
        .attr('fill', item.color)
        .attr('opacity', 0.85)
        .on('mouseenter', (event: MouseEvent) => showTooltip(event, item))
        .on('mouseleave', hideTooltip)
    }

    // Text label next to point marker (offset further for emoji/image icons)
    const markerWidth = item.icon ? Math.min(laneWidth * 0.4, 16) : 2 * size
    const labelX = x + markerWidth + 6
    const availableWidth = laneWidth - markerWidth - 8
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
    return
  }

  // Rectangle block
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

  // Text label inside if tall enough
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
