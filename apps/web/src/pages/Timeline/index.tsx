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
  fetchTags,
  Place,
  ProductivityRecord,
  Tag,
} from '../../state/api'
import { preprocessData } from '../../utils/chart'

import './style.css'

// Tooltip state type
interface TooltipState {
  visible: boolean
  x: number
  y: number
  content: {
    title: string
    time: string
    value?: string
  }
}

// Signals to handle user-selected dates (data fetch range)
const fromDate = signal(formatISO(subDays(new Date(), 1), { representation: 'date' }))
const toDate = signal(formatISO(new Date(), { representation: 'date' }))

// Signals for zoom view (visible range, can be subset of fetched data)
const viewStart = signal<Date | null>(null)
const viewEnd = signal<Date | null>(null)

// Signals for toggling data layers
const showHeartRate = signal(true)
const showHrv = signal(true)
const showSleepMeditation = signal(true)
const showExercise = signal(true)
const showProductivity = signal(true)
const showPlaces = signal(true)
const showTags = signal(true)

// Dark mode aware colors
const colors = {
  // Text colors for dark mode compatibility
  axis: 'currentColor',

  // Productivity
  computer: '#3b82f6', // Blue

  // Activity backgrounds
  exercise: '#22c55e', // Green

  // Line charts
  heartRate: '#ef4444', // Red
  hrv: '#10b981', // Emerald
  meditation: '#a855f7', // Purple
  mobile: '#06b6d4', // Cyan
  sleep: '#3b82f6', // Blue

  // Tags - use semi-transparent to work in both modes
  tags: 'rgba(156, 163, 175, 0.5)', // Gray

  // Travel indicator
  travel: '#9ca3af', // Gray for unknown/travel
}

// Place colors - using colors that work well in both light and dark modes
const placeColorPalette = [
  '#f59e0b', // Amber
  '#10b981', // Emerald
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#06b6d4', // Cyan
  '#f97316', // Orange
  '#84cc16', // Lime
  '#6366f1', // Indigo
]

// Exercise type colors
const exerciseColorPalette = [
  '#22c55e', // Green - default/first
  '#f97316', // Orange
  '#3b82f6', // Blue
  '#ec4899', // Pink
  '#8b5cf6', // Violet
  '#14b8a6', // Teal
  '#eab308', // Yellow
  '#ef4444', // Red
]

// HealthConnect exercise type mapping (subset of common types)
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

// Get exercise type name from activity data
const getExerciseTypeName = (activity: Activity): string => {
  // HealthConnect exercises have exerciseType in data
  const exerciseType = (activity.data as Record<string, unknown> | undefined)?.exerciseType as
    | number
    | undefined
  if (exerciseType !== undefined && exerciseTypeNames[exerciseType]) {
    return exerciseTypeNames[exerciseType]
  }
  // Fall back to title for Oura or other sources
  return activity.title || 'Workout'
}

// Generate consistent color for a place name
const getPlaceColor = (placeName: string, allPlaces: string[]): string => {
  if (!placeName || placeName === 'Travel' || placeName === 'Unknown') {
    return colors.travel
  }
  const index = allPlaces.indexOf(placeName)
  return placeColorPalette[index % placeColorPalette.length]
}

// Generate consistent color for exercise type
const getExerciseColor = (exerciseTypeName: string, allTypes: string[]): string => {
  const index = allTypes.indexOf(exerciseTypeName)
  if (index === -1) return exerciseColorPalette[0]
  return exerciseColorPalette[index % exerciseColorPalette.length]
}

// Chart dimensions
const margin = { bottom: 30, left: 140, right: 50, top: 10 }
const width = 1000
const height = 500
const chartWidth = width - margin.left - margin.right
const chartHeight = height - margin.top - margin.bottom

// Track layout
const trackHeight = chartHeight / 4
const trackSleepMeditation = 0
const trackExercise = trackHeight
const trackPlaces = 2 * trackHeight

// Default view: yesterday + today
const getDefaultStart = () => startOfDay(subDays(new Date(), 1))
const getDefaultEnd = () => endOfDay(new Date())

// eslint-disable-next-line complexity -- TODO: refactor
export const Timeline = () => {
  const start = startOfDay(new Date(fromDate.value))
  const end = endOfDay(new Date(toDate.value))

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
    enabled: showSleepMeditation.value || showExercise.value,
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
    enabled: showTags.value,
    placeholderData: keepPreviousData,
    queryFn: () => fetchTags(start, end),
    queryKey: ['tags', fromDate.value, toDate.value],
    staleTime: 10 * 60 * 1000,
  })

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

  // Get unique place names for legend
  const places = placesQuery.data || []
  const uniquePlaceNames = [...new Set(places.map((p) => p.region))].filter(Boolean).sort()

  const activities = activitiesQuery.data || []

  // Get unique exercise types for legend (by activity type, not title)
  const exerciseSessions = activities.filter((a) => a.activity_type === 'exercise')
  const uniqueExerciseTypes = [...new Set(exerciseSessions.map((a) => getExerciseTypeName(a)))]
    .filter(Boolean)
    .sort()

  // Calculate effective view range
  const effectiveViewStart = viewStart.value || getDefaultStart()
  const effectiveViewEnd = viewEnd.value || getDefaultEnd()

  // Handle zoom - update view range and expand data fetch if needed
  const handleZoom = useCallback((zoomStart: Date, zoomEnd: Date) => {
    viewStart.value = zoomStart
    viewEnd.value = zoomEnd

    // Check if we need more data
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

  // Navigation: jump by days
  const handleJumpDays = useCallback(
    (days: number) => {
      const currentStart = viewStart.value || getDefaultStart()
      const currentEnd = viewEnd.value || getDefaultEnd()
      const newStart = addDays(currentStart, days)
      const newEnd = addDays(currentEnd, days)

      // Don't allow panning into the future
      const todayEnd = endOfDay(new Date())
      if (newEnd > todayEnd) return

      handleZoom(newStart, newEnd)
    },
    [handleZoom],
  )

  // Reset to default 2-day view
  const handleResetToToday = useCallback(() => {
    viewStart.value = null
    viewEnd.value = null

    // Reset fetch range to default
    fromDate.value = formatISO(subDays(new Date(), 1), { representation: 'date' })
    toDate.value = formatISO(new Date(), { representation: 'date' })
  }, [])

  return (
    <div class="timeline">
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

      {/* Exercise types legend */}
      {showExercise.value && uniqueExerciseTypes.length > 0 && (
        <div class="timeline-legend">
          <strong>Exercise:</strong>
          {uniqueExerciseTypes.map((name) => (
            <span key={name} class="legend-item">
              <span
                class="legend-dot"
                style={{ backgroundColor: getExerciseColor(name, uniqueExerciseTypes) }}
              />
              {name}
            </span>
          ))}
        </div>
      )}

      {isLoading && <div class="loading">Loading...</div>}
      {hasError && <div class="error">Error loading data</div>}

      <TimelineChart
        heartRates={showHeartRate.value ? heartRateQuery.data || [] : []}
        hrvData={showHrv.value ? hrvQuery.data || [] : []}
        activities={activities}
        productivity={showProductivity.value ? productivityQuery.data || [] : []}
        places={showPlaces.value ? places : []}
        tags={showTags.value ? tagsQuery.data || [] : []}
        showSleepMeditationSignal={showSleepMeditation}
        showExerciseSignal={showExercise}
        showPlacesSignal={showPlaces}
        visibleStart={effectiveViewStart}
        visibleEnd={effectiveViewEnd}
        uniquePlaceNames={uniquePlaceNames}
        uniqueExerciseTypes={uniqueExerciseTypes}
        onZoom={handleZoom}
      />

      <p class="timeline-help">Scroll to zoom · Drag to pan · Double-click to reset</p>
    </div>
  )
}

interface TimelineChartProps {
  heartRates: [Date, number][]
  hrvData: [Date, number][]
  activities: Activity[]
  productivity: ProductivityRecord[]
  places: Place[]
  tags: Tag[]
  showSleepMeditationSignal: Signal<boolean>
  showExerciseSignal: Signal<boolean>
  showPlacesSignal: Signal<boolean>
  visibleStart: Date
  visibleEnd: Date
  uniquePlaceNames: string[]
  uniqueExerciseTypes: string[]
  onZoom: (start: Date, end: Date) => void
}

// Compute D3 zoom transform from a desired visible domain and base scale
const computeTransform = (
  start: Date,
  end: Date,
  baseScale: d3.ScaleTime<number, number>,
): d3.ZoomTransform => {
  const bx0 = baseScale(start)
  const bx1 = baseScale(end)
  const k = chartWidth / (bx1 - bx0)
  const tx = -k * bx0
  return d3.zoomIdentity.translate(tx, 0).scale(k)
}

function TimelineChart({
  heartRates,
  hrvData,
  activities,
  productivity,
  places,
  tags,
  showSleepMeditationSignal,
  showExerciseSignal,
  showPlacesSignal,
  visibleStart,
  visibleEnd,
  uniquePlaceNames,
  uniqueExerciseTypes,
  onZoom,
}: TimelineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const xAxisRef = useRef<SVGGElement>(null)
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown>>()
  const isProgrammaticZoom = useRef(false)

  const [tooltip, setTooltip] = useState<TooltipState>({
    content: { time: '', title: '' },
    visible: false,
    x: 0,
    y: 0,
  })

  // Stable base scale: maps the default 2-day view to pixel range
  const baseScale = useMemo(
    () => d3.scaleTime().domain([getDefaultStart(), getDefaultEnd()]).range([0, chartWidth]),
    [],
  )

  // Format duration in hours and minutes
  const formatDuration = (start_time: Date, end_time: Date): string => {
    const ms = end_time.getTime() - start_time.getTime()
    const hours = Math.floor(ms / 3600000)
    const minutes = Math.floor((ms % 3600000) / 60000)
    if (hours > 0) {
      return `${hours}h ${minutes}m`
    }
    return `${minutes}m`
  }

  // Show tooltip
  const showTooltip = (event: MouseEvent, title: string, time: string, value?: string) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    setTooltip({
      content: { time, title, value },
      visible: true,
      x: event.clientX - rect.left + 10,
      y: event.clientY - rect.top - 10,
    })
  }

  // Hide tooltip
  const hideTooltip = () => {
    setTooltip((prev) => ({ ...prev, visible: false }))
  }

  // Time scale based on view range
  const x = d3.scaleTime().domain([visibleStart, visibleEnd]).range([0, chartWidth])

  // Heart rate y scale (left axis)
  const yHr = d3.scaleLinear().domain([40, 200]).range([chartHeight, 0])

  // HRV y scale (right axis) - typical RMSSD values range from 10-100ms
  const yHrv = d3.scaleLinear().domain([0, 150]).range([chartHeight, 0])

  // Filter activities by type
  const sleepSessions =
    showSleepMeditationSignal.value ? activities.filter((a) => a.activity_type === 'sleep') : []
  const meditationSessions =
    showSleepMeditationSignal.value ? activities.filter((a) => a.activity_type === 'meditation') : []
  const exerciseSessions =
    showExerciseSignal.value ? activities.filter((a) => a.activity_type === 'exercise') : []

  // Calculate average HRV during a time window from the already-fetched HRV data
  const getAvgHrvInRange = (start: Date, end: Date): number | undefined => {
    const points = hrvData.filter(([t]) => t >= start && t <= end)
    if (points.length === 0) return undefined
    return Math.round(points.reduce((sum, [, v]) => sum + v, 0) / points.length)
  }

  // Get meditation HRV from activity's embedded Oura data
  const getMeditationHrv = (session: Activity): number | undefined => {
    const data = session.data as Record<string, unknown> | undefined
    const hrv = data?.hrv as { items?: (number | null)[] } | undefined
    const items = hrv?.items?.filter((v): v is number => v !== null && v > 0)
    if (!items || items.length === 0) return undefined
    return Math.round(items.reduce((sum, v) => sum + v, 0) / items.length)
  }

  // Find tags overlapping a time range (for last.fm tracks during meditation)
  const getOverlappingTags = (start: Date, end: Date): Tag[] =>
    tags.filter((t) => t.start_time < end && (t.end_time ? t.end_time > start : t.start_time >= start))

  // Compute midnight markers within visible range
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

  // Setup D3 zoom behavior
  useEffect(() => {
    if (!svgRef.current) return

    const svg = d3.select(svgRef.current)

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 50])
      .filter((event) => {
        // Allow wheel events and mouse drag, block double-click (handled separately)
        if (event.type === 'dblclick') return false
        return true
      })
      .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        if (isProgrammaticZoom.current) return
        const newX = event.transform.rescaleX(baseScale)
        const domain = newX.domain()
        onZoom(domain[0], domain[1])
      })

    svg.call(zoom)

    // Prevent default scroll behavior on the SVG so zoom works
    svg.on('wheel.zoom', function (event: WheelEvent) {
      event.preventDefault()
      // Let D3 zoom handle it via the zoom behavior
    })

    // Re-apply zoom with proper wheel handling
    svg.call(zoom)

    zoomBehaviorRef.current = zoom

    return () => {
      svg.on('.zoom', null)
    }
  }, [baseScale, onZoom])

  // Sync D3 zoom transform when visibleStart/visibleEnd change (from navigation)
  useEffect(() => {
    if (!svgRef.current || !zoomBehaviorRef.current) return

    const transform = computeTransform(visibleStart, visibleEnd, baseScale)
    isProgrammaticZoom.current = true
    d3.select(svgRef.current).call(zoomBehaviorRef.current.transform, transform)
    isProgrammaticZoom.current = false
  }, [visibleStart, visibleEnd, baseScale])

  // Update x-axis with appropriate ticks based on zoom level
  useEffect(() => {
    if (!xAxisRef.current) return

    const rangeMs = visibleEnd.getTime() - visibleStart.getTime()
    const rangeHours = rangeMs / (1000 * 60 * 60)

    // Choose appropriate tick interval based on visible range
    let tickInterval: d3.TimeInterval
    let tickFormat: string

    const rangeDays = rangeHours / 24

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
  }, [visibleStart, visibleEnd])

  // Double-click to reset zoom to default 2-day view
  const handleDoubleClick = useCallback(() => {
    onZoom(getDefaultStart(), getDefaultEnd())
  }, [onZoom])

  return (
    <div ref={containerRef} class="timeline-chart-container">
      {/* Tooltip */}
      {tooltip.visible && (
        <div class="timeline-tooltip" style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }}>
          <div class="tooltip-title">{tooltip.content.title}</div>
          <div class="tooltip-time">{tooltip.content.time}</div>
          {tooltip.content.value && <div class="tooltip-value">{tooltip.content.value}</div>}
        </div>
      )}

      <svg
        ref={svgRef}
        width={width}
        height={height}
        style={{ color: 'currentColor', cursor: 'grab' }}
        onDblClick={handleDoubleClick}
      >
        {/* Lane labels on the left */}
        <g transform={`translate(0,${margin.top})`}>
          {/* Sleep/Meditation lane label */}
          <foreignObject x={5} y={trackSleepMeditation} width={margin.left - 10} height={trackHeight}>
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
                checked={showSleepMeditationSignal.value}
                onChange={(e) => (showSleepMeditationSignal.value = (e.target as HTMLInputElement).checked)}
              />
              <span>
                Sleep <span style={{ color: colors.sleep }}>●</span> / Meditation{' '}
                <span style={{ color: colors.meditation }}>●</span>
              </span>
            </label>
          </foreignObject>

          {/* Exercise lane label */}
          <foreignObject x={5} y={trackExercise} width={margin.left - 10} height={trackHeight}>
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
                checked={showExerciseSignal.value}
                onChange={(e) => (showExerciseSignal.value = (e.target as HTMLInputElement).checked)}
              />
              <span>
                Exercise <span style={{ color: colors.exercise }}>●</span>
              </span>
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
        </g>

        <g transform={`translate(${margin.left},${margin.top})`}>
          {/* Clip path to constrain chart content */}
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
            {/* Sleep sessions - in sleep/meditation lane */}
            {sleepSessions.map((session, i) =>
              session.end_time ?
                <rect
                  key={`sleep-${i}`}
                  x={x(session.start_time)}
                  y={trackSleepMeditation}
                  width={Math.max(0, x(session.end_time) - x(session.start_time))}
                  height={trackHeight}
                  fill={colors.sleep}
                  opacity={0.4}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) => {
                    const avgHrv = getAvgHrvInRange(session.start_time, session.end_time!)
                    const details = [formatDuration(session.start_time, session.end_time!)]
                    if (avgHrv) details.push(`Avg HRV: ${avgHrv} ms`)
                    showTooltip(
                      e as unknown as MouseEvent,
                      'Sleep',
                      `${format(session.start_time, 'HH:mm')} - ${format(session.end_time!, 'HH:mm')}`,
                      details.join(' | '),
                    )
                  }}
                  onMouseLeave={hideTooltip}
                />
              : null,
            )}

            {/* Meditation sessions - in sleep/meditation lane */}
            {meditationSessions.map((session, i) =>
              session.end_time ?
                <rect
                  key={`meditation-${i}`}
                  x={x(session.start_time)}
                  y={trackSleepMeditation}
                  width={Math.max(0, x(session.end_time) - x(session.start_time))}
                  height={trackHeight}
                  fill={colors.meditation}
                  opacity={0.6}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) => {
                    const avgHrv =
                      getMeditationHrv(session) ?? getAvgHrvInRange(session.start_time, session.end_time!)
                    const overlapping = getOverlappingTags(session.start_time, session.end_time!)
                    const details = [formatDuration(session.start_time, session.end_time!)]
                    if (avgHrv) details.push(`Avg HRV: ${avgHrv} ms`)
                    if (overlapping.length > 0) details.push(overlapping.map((t) => t.tag).join(', '))
                    showTooltip(
                      e as unknown as MouseEvent,
                      session.title || 'Meditation',
                      `${format(session.start_time, 'HH:mm')} - ${format(session.end_time!, 'HH:mm')}`,
                      details.join(' | '),
                    )
                  }}
                  onMouseLeave={hideTooltip}
                />
              : null,
            )}

            {/* Productivity (Computer) - overlaid on top */}
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

            {/* Productivity (Mobile) - overlaid on top */}
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

            {/* Exercise sessions - in exercise lane */}
            {exerciseSessions.map((session, i) =>
              session.end_time ?
                <rect
                  key={`exercise-${i}`}
                  x={x(session.start_time)}
                  y={trackExercise}
                  width={Math.max(0, x(session.end_time) - x(session.start_time))}
                  height={trackHeight}
                  fill={getExerciseColor(getExerciseTypeName(session), uniqueExerciseTypes)}
                  opacity={0.6}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) =>
                    showTooltip(
                      e as unknown as MouseEvent,
                      getExerciseTypeName(session),
                      `${format(session.start_time, 'HH:mm')} - ${format(session.end_time!, 'HH:mm')}`,
                      formatDuration(session.start_time, session.end_time!),
                    )
                  }
                  onMouseLeave={hideTooltip}
                />
              : null,
            )}

            {/* Places - in places lane */}
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

            {/* Tags - dashed lines or rectangles */}
            {tags.map((tag, i) =>
              tag.end_time ?
                <rect
                  key={`tag-${i}`}
                  x={x(tag.start_time)}
                  y={0}
                  width={Math.max(0, x(tag.end_time) - x(tag.start_time))}
                  height={chartHeight}
                  fill="none"
                  stroke={colors.tags}
                  strokeDasharray="4"
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) =>
                    showTooltip(
                      e as unknown as MouseEvent,
                      tag.tag,
                      `${format(tag.start_time, 'HH:mm')} - ${format(tag.end_time!, 'HH:mm')}`,
                      formatDuration(tag.start_time, tag.end_time!),
                    )
                  }
                  onMouseLeave={hideTooltip}
                />
              : <line
                  key={`tag-${i}`}
                  x1={x(tag.start_time)}
                  y1={0}
                  x2={x(tag.start_time)}
                  y2={chartHeight}
                  stroke={colors.tags}
                  strokeDasharray="4"
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) =>
                    showTooltip(e as unknown as MouseEvent, tag.tag, format(tag.start_time, 'HH:mm'))
                  }
                  onMouseLeave={hideTooltip}
                />,
            )}

            {/* HRV Line */}
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

            {/* Heart Rate Line */}
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
              if (g) d3.select(g).call(d3.axisRight(yHrv)).selectAll('text').style('fill', colors.hrv)
            }}
          />

          {/* X-axis */}
          <g ref={xAxisRef} transform={`translate(0,${chartHeight})`} />
        </g>
      </svg>
    </div>
  )
}
