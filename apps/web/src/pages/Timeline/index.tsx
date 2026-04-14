/* eslint-disable max-lines -- large visualization component, being decomposed */
import type { ScreentimeCategory } from '@aurboda/api-spec'

import { signal, useSignalEffect } from '@preact/signals'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import * as d3 from 'd3'
import { addDays, differenceInCalendarDays, endOfDay, format, formatISO, startOfDay, subDays } from 'date-fns'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'

import type { ChartItem, Column, Orientation } from './types'

import {
  fetchActivities,
  fetchActivityTypeDefinitions,
  fetchBucketedMetrics,
  fetchMeals,
  fetchPlaces,
  fetchProductivity,
  fetchScreentimeCategories,
  fetchScreentimeBucketed,
  fetchScrobbles,
  fetchItemIcons,
  fetchTrainingLoad,
  fetchUserSettings,
} from '../../state/api'
import { aggregateBucketsAligned, parseBucketedResponse } from '../../utils/chart'
import { isEmoji, isIconPath, isUrl } from '../../utils/emojiLookup'
import { packLanes } from '../../utils/lanePacking'
import {
  buildActivityColumnItems,
  EXCLUDED_ACTIVITY_PREFIXES,
  EXCLUDED_ACTIVITY_SOURCES,
} from './activityMerge'
import { computeBarLayout, type BarSlot } from './barLayout'
import {
  categorizeLocations,
  categorizeMeals,
  categorizeOtherActivities,
  categorizeProductivity,
} from './categorize'
import { categorizeMusic } from './categorizeMusic'
import {
  activityColors,
  getExerciseColor,
  hrZoneColors,
  MUSIC_COLOR,
  placeColorPalette,
  productivityColors,
  TAG_COLOR,
  tagSourceColors,
} from './colors'
import { drawActivitySparklines, parseBucketedData } from './drawActivitySparklines'
import {
  CALORIES_COLOR,
  computeYScales,
  drawMetricsTrack,
  HR_COLOR,
  HRV_COLOR,
  STEPS_COLOR,
  STRESS_COLOR,
} from './drawMetricsTrack'
import {
  buildMusicTooltipHtml,
  drawMusicSessions,
  getMergeGapMs,
  mergeScrobblesIntoSessions,
  MUSIC_STAFF_HEIGHT,
} from './drawMusicStaff'
import { drawScreentimeBars, SCREENTIME_COLOR } from './drawScreentimeTrack'
import { CTL_COLOR, drawTrainingLoadTrack } from './drawTrainingLoadTrack'
import { drawColumnItems, drawHorizontalNowLine, drawNowLine } from './drawVerticalHelpers'
import { findOverlappingScrobbles } from './findOverlappingScrobbles'
import { getExerciseTypeName } from './formatting'
import { BASE_COLUMNS, CATEGORY_MATCHERS, type LegendCategory } from './legendCategories'
import { buildSleepDetails, buildTooltipHtml, type SleepMetricsByDate } from './tooltipBuilder'
import {
  buildViewHash,
  getDefaultOrientation,
  getDefaultViewEnd,
  getDefaultViewStart,
  parseViewHash,
} from './viewHash'
import { computeHorizontalZoomTransform, computeVerticalZoomTransform } from './zoomTransform'
import './style.css'

// ── Signals (module-level, persist across SPA navigations) ────────────────────

const fromDate = signal(formatISO(subDays(new Date(), 1), { representation: 'date' }))
const toDate = signal(formatISO(new Date(), { representation: 'date' }))
const viewStart = signal<Date | null>(null)
const viewEnd = signal<Date | null>(null)

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

// ── Constants ─────────────────────────────────────────────────────────────────

/** Metrics to exclude from the unified bucketed query (fetched via separate endpoints). */
const TIMELINE_EXCLUDED_METRICS = ['training_impulse', 'activity_impulse']

// ── Chart layout constants ────────────────────────────────────────────────────

const HORIZONTAL_MARGIN = { bottom: 30, left: 60, right: 60, top: 10 }
const VERTICAL_MARGIN = { bottom: 10, left: 60, right: 10, top: 30 }

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

  // ── Toggle state (before queries so they can gate fetching) ─────────────
  const [hiddenCategories, setHiddenCategories] = useState<Set<LegendCategory>>(
    () => new Set(_initialHash.hide),
  )
  const hiddenCategoriesRef = useRef<Set<LegendCategory>>(hiddenCategories)
  hiddenCategoriesRef.current = hiddenCategories

  // Zoom-adaptive merge gap for backend category merging — larger gap when zoomed out.
  // Computed early (before queries) so it can be included in the query key.
  const screentimeMergeGapMs = useMemo(() => {
    const days = differenceInCalendarDays(new Date(toDate.value), new Date(fromDate.value))
    if (days > 50) return 4 * 60 * 60 * 1000 // 4h gap at week+ view
    if (days > 2) return 60 * 60 * 1000 // 1h gap at multi-day view
    return 10 * 60 * 1000 // 10min gap at day view
  }, [fromDate.value, toDate.value])

  // ── Data queries ───────────────────────────────────────────────────────────

  // Load activity type definitions early for display_category-based rendering
  const { data: activityTypeDefs = [] } = useQuery({
    queryFn: fetchActivityTypeDefinitions,
    queryKey: ['activityTypeDefinitions'],
    staleTime: 5 * 60_000,
  })

  // Single query for all activities
  const activitiesQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => fetchActivities(subDays(fetchStart, 0.5), addDays(fetchEnd, 0.5)),
    queryKey: ['timeline-activities', fromDate.value, toDate.value],
    staleTime: 5 * 60 * 1000,
  })

  const placesQuery = useQuery({
    enabled: !hiddenCategories.has('location'),
    placeholderData: keepPreviousData,
    queryFn: () => fetchPlaces(subDays(fetchStart, 0.5), addDays(fetchEnd, 0.5)),
    queryKey: ['timeline-places', fromDate.value, toDate.value],
    staleTime: 5 * 60 * 1000,
  })

  const mealsQuery = useQuery({
    enabled: !hiddenCategories.has('meal'),
    placeholderData: keepPreviousData,
    queryFn: () => fetchMeals({ start: fetchStart.toISOString(), end: fetchEnd.toISOString() }),
    queryKey: ['timeline-meals', fromDate.value, toDate.value],
    staleTime: 5 * 60 * 1000,
  })

  const productivityQuery = useQuery({
    enabled: !hiddenCategories.has('activity') && !hiddenCategories.has('screentime'),
    placeholderData: keepPreviousData,
    queryFn: () => fetchProductivity(fetchStart, fetchEnd, 'category', screentimeMergeGapMs),
    queryKey: ['timeline-productivity', fromDate.value, toDate.value, screentimeMergeGapMs],
    staleTime: 5 * 60 * 1000,
  })

  const screentimeCategoriesQuery = useQuery<ScreentimeCategory[]>({
    enabled: !hiddenCategories.has('activity') && !hiddenCategories.has('screentime'),
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
    enabled: hasLastFm && !hiddenCategories.has('music'),
    placeholderData: keepPreviousData,
    queryFn: () => fetchScrobbles(subDays(fetchStart, 0.5), addDays(fetchEnd, 0.5)),
    queryKey: ['timeline-scrobbles', fromDate.value, toDate.value],
    staleTime: 5 * 60 * 1000,
  })

  // Unified bucket size for line-chart metrics, derived from the visible view range
  // (not the fetch range). Thresholds chosen to keep under ~500 data points.
  const bucketSize = useMemo(() => {
    const days = differenceInCalendarDays(effectiveViewEnd, effectiveViewStart)
    if (days > 500) return '1w'
    if (days > 21) return '1d'
    if (days > 5) return '1h'
    if (days > 1) return '15m'
    return '5m'
  }, [effectiveViewStart, effectiveViewEnd])

  const bucketedMetricsQuery = useQuery({
    enabled: !hiddenCategories.has('metrics'),
    placeholderData: keepPreviousData,
    queryFn: () =>
      fetchBucketedMetrics(
        subDays(fetchStart, 0.5),
        addDays(fetchEnd, 0.5),
        undefined,
        bucketSize,
        TIMELINE_EXCLUDED_METRICS,
      ),
    queryKey: ['timeline-bucketed-metrics', fromDate.value, toDate.value, bucketSize],
    staleTime: 5 * 60 * 1000,
  })

  const itemIconsQuery = useQuery({
    queryFn: fetchItemIcons,
    queryKey: ['item-icons'],
    staleTime: 30 * 60 * 1000,
  })

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

  const typeDefsMap = useMemo(
    () =>
      new Map(
        activityTypeDefs.map((t) => [t.name, { color: t.color, display_name: t.display_name, icon: t.icon }]),
      ),
    [activityTypeDefs],
  )
  const hiddenTypes = useMemo(
    () => new Set(activityTypeDefs.filter((t) => !t.show_on_timeline).map((t) => t.name)),
    [activityTypeDefs],
  )

  // Split all activities by display_category into main activities vs secondary
  const ACTIVITY_CATEGORIES = new Set(['sleep_rest', 'exercise', 'meditation', 'wellness'])
  const categoryByType = useMemo(
    () => new Map(activityTypeDefs.map((t) => [t.name, t.display_category])),
    [activityTypeDefs],
  )
  const allActivities = useMemo(
    () => (activitiesQuery.data ?? []).filter((a) => !hiddenTypes.has(a.activity_type ?? '')),
    [activitiesQuery.data, hiddenTypes],
  )
  const activities = useMemo(
    () =>
      allActivities.filter((a) => ACTIVITY_CATEGORIES.has(categoryByType.get(a.activity_type) ?? 'other')),
    [allActivities, categoryByType],
  )
  const secondaryActivities = useMemo(
    () =>
      allActivities.filter((a) => !ACTIVITY_CATEGORIES.has(categoryByType.get(a.activity_type) ?? 'other')),
    [allActivities, categoryByType],
  )
  const places = placesQuery.data ?? []
  const productivity = productivityQuery.data?.records ?? []
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
    return itemIconsQuery.data ?? {}
  }, [itemIconsQuery.data])

  const musicItems = useMemo(() => (hasLastFm ? categorizeMusic(scrobbles) : []), [hasLastFm, scrobbles])
  const showMusicColumn = musicItems.length > 0

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
        secondaryActivities,
        itemIcons,
        activityColors,
        getExerciseColor,
        getExerciseTypeName,
        sleepMetricsByDate,
        (a, end) => buildSleepDetails(a, end, sleepMetricsByDate),
        scrobbles,
        typeDefsMap,
      ),
    [activities, secondaryActivities, itemIcons, sleepMetricsByDate, scrobbles, typeDefsMap],
  )

  // Non-main activities not already in activityItems (point activities, excluded sources, etc.)
  const otherActivities = useMemo(
    () =>
      secondaryActivities.filter((a) => {
        if (!a.end_time) return true // point activities are separate items
        if (a.source && EXCLUDED_ACTIVITY_SOURCES.has(a.source)) return true
        for (const prefix of EXCLUDED_ACTIVITY_PREFIXES) {
          if (a.activity_type.startsWith(prefix)) return true
        }
        // Check if this activity was placed in the Activity column
        return !activityItems.some((i) => i.entity_id === a.id)
      }),
    [secondaryActivities, activityItems],
  )

  // ── Legend / filtering ─────────────────────────────────────────────────────

  // Unified bar bucket size — all bar-shaped data (training load, steps, calories, screentime)
  // uses the same bucket size so they align visually side by side.
  // Training load backend only supports '1h', '1d', '1w', which constrains the minimum.
  // Line charts (HR/HRV) still use the finer `bucketSize` for smooth rendering.
  // Target max ~50 bars visible: '1h' up to 2 days, '1d' up to 50 days, '1w' beyond.
  const barBucketSize = useMemo((): '1h' | '1d' | '1w' => {
    const days = differenceInCalendarDays(effectiveViewEnd, effectiveViewStart)
    if (days > 50) return '1w'
    if (days > 2) return '1d'
    return '1h'
  }, [effectiveViewStart, effectiveViewEnd])

  // Training load data (fetched when toggle is on)
  const trainingLoadQuery = useQuery({
    enabled: !hiddenCategories.has('training_load'),
    placeholderData: keepPreviousData,
    queryFn: () => fetchTrainingLoad(subDays(fetchStart, 0.5), addDays(fetchEnd, 0.5), barBucketSize),
    queryKey: ['timeline-training-load', fromDate.value, toDate.value, barBucketSize],
    staleTime: 5 * 60 * 1000,
  })

  // Screentime bucketed data (for horizontal stacked bar chart)
  // Uses the same barBucketSize so it aligns with steps/calories/training load
  const screentimeBucketedQuery = useQuery({
    enabled: !hiddenCategories.has('screen_time_h') && !hiddenCategories.has('metrics'),
    placeholderData: keepPreviousData,
    queryFn: () => fetchScreentimeBucketed(subDays(fetchStart, 0.5), addDays(fetchEnd, 0.5), barBucketSize),
    queryKey: ['timeline-screentime-bucketed', fromDate.value, toDate.value, barBucketSize],
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

  const mealItems = useMemo(
    () => categorizeMeals(mealsQuery.data?.meals ?? [], itemIcons),
    [mealsQuery.data, itemIcons],
  )

  const allChartItems = useMemo(
    () => [
      ...activityItems,
      ...categorizeLocations(places, uniquePlaceNames),
      ...categorizeOtherActivities(otherActivities, itemIcons, typeDefsMap),
      ...categorizeProductivity(productivity, screentimeCategoriesQuery.data ?? [], itemIcons),
      ...musicItems,
      ...mealItems,
    ],
    [
      activityItems,
      places,
      uniquePlaceNames,
      otherActivities,
      itemIcons,
      typeDefsMap,
      productivity,
      screentimeCategoriesQuery.data,
      musicItems,
      mealItems,
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
    mealsQuery.isFetching ||
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
        pixelsPerHour >= 2
          ? d3.timeDay.range(domainStart, domainEnd)
          : pixelsPerHour >= 0.3
            ? d3.timeMonday.range(domainStart, domainEnd)
            : d3.timeMonth.range(domainStart, domainEnd)

      const separatorLabelFormat =
        pixelsPerHour >= 2 ? 'MMM d' : pixelsPerHour >= 0.3 ? "'w'w MMM d" : 'MMM yyyy'

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
      const showSparkStress = !hiddenCategories.has('stress')
      if (sparklineBuckets.length > 0 && (showSparkHR || showSparkHRV || showSparkStress)) {
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
          showSparkStress,
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
    // Pre-compute bar-aggregated buckets for Y-scale computation (so calorie/steps scales
    // match the actual bar values, not the finer line-chart bucket peaks)
    const barBucketMs = barBucketSize === '1w' ? 7 * 86400000 : barBucketSize === '1d' ? 86400000 : 3600000
    const barAggBuckets =
      metricBuckets.length >= 2 &&
      metricBuckets[1]!.start.getTime() - metricBuckets[0]!.start.getTime() < barBucketMs
        ? aggregateBucketsAligned(metricBuckets, barBucketMs)
        : metricBuckets
    const metricsYScales =
      metricBuckets.length > 0
        ? computeYScales(metricBuckets, trackMetrics, metricsTrackBottom, barAggBuckets)
        : null

    // All Activity-column items for the activity lane
    const allActivityLaneItems = chartItems.filter(
      (i) => i.column === 'Activity' || i.column === 'Screen Time',
    )
    const packedActivityItems = packLanes(
      allActivityLaneItems,
      (i) => i.start,
      (i) => (i.isPoint ? undefined : i.end),
    )

    const activitySubLaneHeight =
      packedActivityItems.laneCount > 1
        ? activityTrackHeight / packedActivityItems.laneCount
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
        pixelsPerHour >= 2
          ? d3.timeDay.range(domainStart, domainEnd)
          : pixelsPerHour >= 0.3
            ? d3.timeMonday.range(domainStart, domainEnd)
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
        item.href ??
        (item.entity_id && item.entity_type
          ? `/detail/${item.entity_type}/${encodeURIComponent(item.entity_id)}`
          : undefined)

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
          const boxWidth = Math.max(0, currentXScale(item.end) - rx)
          const iconSize = Math.max(ICON_SIZE, Math.min(laneH, boxWidth))

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const parent: d3.Selection<any, unknown, null, undefined> = detailUrl
            ? chartGroup.append('a').attr('href', detailUrl).attr('data-clickable', 'true')
            : chartGroup

          if (icon && isEmoji(icon)) {
            parent
              .append('text')
              .attr('x', tagCx)
              .attr('y', tagCy)
              .attr('dy', '0.35em')
              .attr('font-size', iconSize)
              .attr('text-anchor', 'middle')
              .attr('cursor', detailUrl ? 'pointer' : 'default')
              .text(icon)
              .on('mouseenter', (event: MouseEvent) => showTooltip(event, item))
              .on('mouseleave', hideTooltip)
          } else if (icon && (isUrl(icon) || isIconPath(icon))) {
            parent
              .append('image')
              .attr('href', icon)
              .attr('x', tagCx - iconSize / 2)
              .attr('y', tagCy - iconSize / 2)
              .attr('width', iconSize)
              .attr('height', iconSize)
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
        const parent: d3.Selection<any, unknown, null, undefined> = detailUrl
          ? chartGroup.append('a').attr('href', detailUrl).attr('data-clickable', 'true')
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

        const blockIconSize = Math.max(ICON_SIZE, Math.min(laneH, rw))
        if (item.icon && isEmoji(item.icon)) {
          parent
            .append('text')
            .attr('x', rx + rw / 2)
            .attr('y', laneY + laneH / 2)
            .attr('dy', '0.35em')
            .attr('text-anchor', 'middle')
            .attr('font-size', `${blockIconSize}px`)
            .attr('pointer-events', 'none')
            .text(item.icon)
        } else if (item.icon && (isUrl(item.icon) || isIconPath(item.icon))) {
          parent
            .append('image')
            .attr('href', item.icon)
            .attr('x', rx + rw / 2 - blockIconSize / 2)
            .attr('y', laneY + laneH / 2 - blockIconSize / 2)
            .attr('width', blockIconSize)
            .attr('height', blockIconSize)
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
        const parent: d3.Selection<any, unknown, null, undefined> = placeUrl
          ? chartGroup.append('a').attr('href', placeUrl).attr('data-clickable', 'true')
          : chartGroup

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
      const showStress = !hiddenCategories.has('stress') && showMetricsTrack
      const showSteps = !hiddenCategories.has('steps') && showMetricsTrack
      const showCalories = !hiddenCategories.has('calories') && showMetricsTrack
      const showTL = !hiddenCategories.has('training_load') && showMetricsTrack
      const showScreentimeH = !hiddenCategories.has('screen_time_h') && showMetricsTrack
      const screentimeBuckets = screentimeBucketedQuery.data ?? []
      const screentimeHasData = screentimeBuckets.length > 0

      // Compute the bar layout for side-by-side bars
      const barSlots: BarSlot[] = [
        { id: 'fatigue', visible: showTL && !!trainingLoadData },
        { id: 'impulse', visible: showTL && !!trainingLoadData },
        { id: 'screentime', visible: showScreentimeH && screentimeHasData },
        { id: 'steps', visible: showSteps },
        { id: 'calories', visible: showCalories },
      ]
      const barLayout = computeBarLayout(barSlots)

      if (showMetricsTrack && (metricsYScales || (showTL && trainingLoadData) || screentimeHasData)) {
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
          showStress,
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
          ...(metricsYScales
            ? { yScales: metricsYScales }
            : { yScales: computeYScales([], trackMetrics, trackMetrics + metricsTrackHeight) }),
          xScale: currentXScale,
          barBucketMs,
          barLayout,
          caloriesSlotId: 'calories',
          stepsSlotId: 'steps',
          ...(showScreentimeH && screentimeHasData
            ? {
                screentimeBuckets,
                screentimeCategories: screentimeCategoriesQuery.data ?? [],
              }
            : {}),
          ...(showTL && trainingLoadData
            ? {
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
          barLayout,
          bootstrapping: trainingLoadData.bootstrapping,
          chartGroup,
          fatigueSlotId: 'fatigue',
          impulseSlotId: 'impulse',
          points: trainingLoadData.points,
          trackHeight: metricsTrackHeight,
          trackY: trackMetrics,
          workouts: trainingLoadData.workouts,
          xScale: currentXScale,
          zones: trainingLoadData.zones ?? undefined,
        })
      }

      // ── Screentime stacked bar chart ──
      if (showMetricsTrack && showScreentimeH && screentimeHasData) {
        drawScreentimeBars({
          barLayout,
          buckets: screentimeBuckets,
          categories: screentimeCategoriesQuery.data ?? [],
          chartGroup,
          slotId: 'screentime',
          trackHeight: metricsTrackHeight,
          trackY: trackMetrics,
          xScale: currentXScale,
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
          const h = containerRef.current
            ? Math.max(200, containerRef.current.clientHeight - VERTICAL_MARGIN.top - VERTICAL_MARGIN.bottom)
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
        const hForZoom = containerRef.current
          ? Math.max(200, containerRef.current.clientHeight - VERTICAL_MARGIN.top - VERTICAL_MARGIN.bottom)
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

  const isInitialLoad = activitiesQuery.isLoading && placesQuery.isLoading && productivityQuery.isLoading

  const errorSources = [
    activitiesQuery.isError && 'activities',
    placesQuery.isError && 'places',
    productivityQuery.isError && 'screen time',
  ].filter(Boolean) as string[]

  const viewLabel =
    format(effectiveViewStart, 'MMM d') === format(effectiveViewEnd, 'MMM d')
      ? format(effectiveViewStart, 'MMM d, yyyy')
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
            {orientation === 'vertical' ? (
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
            ) : (
              // Landscape screen → rotate to portrait
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
                {/* Landscape screen */}
                <rect x="2" y="7" width="14" height="10" rx="2" />
                {/* Rotation arrow (counter-clockwise, bottom-right) */}
                <path d="M17 19a7 7 0 0 1-5 -7" />
                <polyline points="21 16 17 19 19 23" />
              </svg>
            )}
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
            {hasLastFm && (
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
                { cat: 'other' as LegendCategory, color: TAG_COLOR, label: 'Other' },
                { cat: 'calendar' as LegendCategory, color: tagSourceColors.calendar!, label: 'Calendar' },
                {
                  cat: 'screentime' as LegendCategory,
                  color: productivityColors[1]!,
                  label: 'Screen Time',
                },
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
                { cat: 'stress' as LegendCategory, color: STRESS_COLOR, label: 'Stress' },
                ...(orientation === 'horizontal'
                  ? [
                      { cat: 'steps' as LegendCategory, color: STEPS_COLOR, label: 'Steps' },
                      { cat: 'calories' as LegendCategory, color: CALORIES_COLOR, label: 'Calories' },
                      { cat: 'training_load' as LegendCategory, color: CTL_COLOR, label: 'Training Load' },
                      {
                        cat: 'screen_time_h' as LegendCategory,
                        color: SCREENTIME_COLOR,
                        label: 'Screen Time',
                      },
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

/* D3 drawing helpers extracted to drawVerticalHelpers.ts */
