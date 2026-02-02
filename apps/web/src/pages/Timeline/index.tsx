import { Signal, signal } from '@preact/signals'
import { useQuery } from '@tanstack/react-query'
import * as d3 from 'd3'
import { addDays, endOfDay, format, formatISO, startOfDay, subDays } from 'date-fns'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
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

export const Timeline = () => {
  const start = startOfDay(new Date(fromDate.value))
  const end = endOfDay(new Date(toDate.value))

  const heartRateQuery = useQuery({
    enabled: showHeartRate.value,
    queryFn: () => fetchHeartRate(start, end),
    queryKey: ['heartRate', fromDate.value, toDate.value],
    staleTime: 10 * 60 * 1000,
  })

  const hrvQuery = useQuery({
    enabled: showHrv.value,
    queryFn: () => fetchHrv(start, end),
    queryKey: ['hrv', fromDate.value, toDate.value],
    staleTime: 10 * 60 * 1000,
  })

  const activitiesQuery = useQuery({
    enabled: showSleepMeditation.value || showExercise.value,
    queryFn: () => fetchActivities(start, end),
    queryKey: ['activities', fromDate.value, toDate.value],
    staleTime: 10 * 60 * 1000,
  })

  const productivityQuery = useQuery({
    enabled: showProductivity.value,
    queryFn: () => fetchProductivity(start, end),
    queryKey: ['productivity', fromDate.value, toDate.value],
    staleTime: 10 * 60 * 1000,
  })

  const placesQuery = useQuery({
    enabled: showPlaces.value,
    queryFn: () => fetchPlaces(start, end),
    queryKey: ['places', fromDate.value, toDate.value],
    staleTime: 10 * 60 * 1000,
  })

  const tagsQuery = useQuery({
    enabled: showTags.value,
    queryFn: () => fetchTags(start, end),
    queryKey: ['tags', fromDate.value, toDate.value],
    staleTime: 10 * 60 * 1000,
  })

  const handleDateChange = (e: Event) => {
    const target = e.target as HTMLInputElement
    if (target.name === 'from') fromDate.value = target.value
    else if (target.name === 'to') toDate.value = target.value
  }

  const isLoading =
    heartRateQuery.isLoading ||
    hrvQuery.isLoading ||
    activitiesQuery.isLoading ||
    productivityQuery.isLoading ||
    placesQuery.isLoading ||
    tagsQuery.isLoading

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
  const exerciseSessions = activities.filter((a) => a.activityType === 'exercise')
  const uniqueExerciseTypes = [...new Set(exerciseSessions.map((a) => getExerciseTypeName(a)))]
    .filter(Boolean)
    .sort()

  // Calculate effective view range
  const effectiveViewStart = viewStart.value || start
  const effectiveViewEnd = viewEnd.value || end

  // Check if zoomed
  const isZoomed = viewStart.value !== null || viewEnd.value !== null

  // Handle zoom - update view range
  const handleZoom = useCallback((zoomStart: Date, zoomEnd: Date) => {
    viewStart.value = zoomStart
    viewEnd.value = zoomEnd
  }, [])

  // Handle zoom out - expand date range and fetch more data
  const handleZoomOut = useCallback(() => {
    // Expand the data fetch range by 1 day in each direction
    const newFrom = formatISO(subDays(new Date(fromDate.value), 1), { representation: 'date' })
    const newTo = formatISO(addDays(new Date(toDate.value), 1), { representation: 'date' })

    // Don't fetch future data
    const today = formatISO(new Date(), { representation: 'date' })
    const cappedTo = newTo > today ? today : newTo

    fromDate.value = newFrom
    toDate.value = cappedTo

    // Reset view to show full range
    viewStart.value = null
    viewEnd.value = null
  }, [])

  // Reset zoom to full data range
  const handleResetZoom = useCallback(() => {
    viewStart.value = null
    viewEnd.value = null
  }, [])

  // Reset view when date range changes
  useEffect(() => {
    viewStart.value = null
    viewEnd.value = null
  }, [fromDate.value, toDate.value])

  return (
    <div class="timeline">
      <h1>Timeline</h1>

      {/* Date range and controls */}
      <div class="timeline-controls">
        <div class="date-range">
          <label>
            From: <input type="date" name="from" value={fromDate.value} onChange={handleDateChange} />
          </label>
          <label>
            To: <input type="date" name="to" value={toDate.value} onChange={handleDateChange} />
          </label>
        </div>
        {isZoomed && (
          <button onClick={handleResetZoom} class="reset-btn">
            Reset Zoom
          </button>
        )}
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
        dataStart={start}
        dataEnd={end}
        visibleStart={effectiveViewStart}
        visibleEnd={effectiveViewEnd}
        uniquePlaceNames={uniquePlaceNames}
        uniqueExerciseTypes={uniqueExerciseTypes}
        onZoom={handleZoom}
        onZoomOut={handleZoomOut}
      />

      <p class="timeline-help">Drag to select a region to zoom. Double-click to reset.</p>
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
  dataStart: Date
  dataEnd: Date
  visibleStart: Date
  visibleEnd: Date
  uniquePlaceNames: string[]
  uniqueExerciseTypes: string[]
  onZoom: (start: Date, end: Date) => void
  onZoomOut: () => void
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
  dataStart,
  dataEnd,
  visibleStart,
  visibleEnd,
  uniquePlaceNames,
  uniqueExerciseTypes,
  onZoom,
}: TimelineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const brushRef = useRef<SVGGElement>(null)
  const xAxisRef = useRef<SVGGElement>(null)

  const [tooltip, setTooltip] = useState<TooltipState>({
    content: { time: '', title: '' },
    visible: false,
    x: 0,
    y: 0,
  })

  // Format duration in hours and minutes
  const formatDuration = (startTime: Date, endTime: Date): string => {
    const ms = endTime.getTime() - startTime.getTime()
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
    showSleepMeditationSignal.value ? activities.filter((a) => a.activityType === 'sleep') : []
  const meditationSessions =
    showSleepMeditationSignal.value ? activities.filter((a) => a.activityType === 'meditation') : []
  const exerciseSessions =
    showExerciseSignal.value ? activities.filter((a) => a.activityType === 'exercise') : []

  // Setup brush for selection zoom
  useEffect(() => {
    if (!brushRef.current) return

    const brush = d3
      .brushX<unknown>()
      .extent([
        [0, 0],
        [chartWidth, chartHeight],
      ])
      .on('end', (event: d3.D3BrushEvent<unknown>) => {
        if (!event.selection) return
        const [x0, x1] = event.selection as [number, number]
        const newStart = x.invert(x0)
        const newEnd = x.invert(x1)

        // Clear brush selection
        d3.select(brushRef.current).call(brush.move, null)

        // Only zoom if selection is meaningful (at least 1 minute)
        if (newEnd.getTime() - newStart.getTime() > 60000) {
          onZoom(newStart, newEnd)
        }
      })

    d3.select(brushRef.current).call(brush)
  }, [chartWidth, chartHeight, visibleStart, visibleEnd, onZoom])

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
      // Less than 1 hour: show every 5 minutes
      tickInterval = d3.timeMinute.every(5)!
      tickFormat = '%H:%M'
    } else if (rangeHours <= 3) {
      // 1-3 hours: show every 15 minutes
      tickInterval = d3.timeMinute.every(15)!
      tickFormat = '%H:%M'
    } else if (rangeHours <= 6) {
      // 3-6 hours: show every 30 minutes
      tickInterval = d3.timeMinute.every(30)!
      tickFormat = '%H:%M'
    } else if (rangeHours <= 12) {
      // 6-12 hours: show every hour
      tickInterval = d3.timeHour.every(1)!
      tickFormat = '%H:%M'
    } else if (rangeHours <= 24) {
      // 12-24 hours: show every 2 hours
      tickInterval = d3.timeHour.every(2)!
      tickFormat = '%H:%M'
    } else if (rangeHours <= 48) {
      // 1-2 days: show every 4 hours
      tickInterval = d3.timeHour.every(4)!
      tickFormat = '%a %H'
    } else if (rangeDays <= 7) {
      // 2-7 days: show every 12 hours
      tickInterval = d3.timeHour.every(12)!
      tickFormat = '%a %H'
    } else if (rangeDays <= 14) {
      // 1-2 weeks: show every day
      tickInterval = d3.timeDay.every(1)!
      tickFormat = '%b %d'
    } else if (rangeDays <= 31) {
      // 2 weeks - 1 month: show every 2 days
      tickInterval = d3.timeDay.every(2)!
      tickFormat = '%b %d'
    } else if (rangeDays <= 90) {
      // 1-3 months: show every week
      tickInterval = d3.timeWeek.every(1)!
      tickFormat = '%b %d'
    } else {
      // More than 3 months: show every 2 weeks
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

  // Double-click to reset zoom
  const handleDoubleClick = useCallback(() => {
    onZoom(dataStart, dataEnd)
  }, [dataStart, dataEnd, onZoom])

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
        style={{ color: 'currentColor', cursor: 'crosshair' }}
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

          {/* Sleep sessions - in sleep/meditation lane */}
          {sleepSessions.map((session, i) =>
            session.endTime ?
              <rect
                key={`sleep-${i}`}
                x={x(session.startTime)}
                y={trackSleepMeditation}
                width={Math.max(0, x(session.endTime) - x(session.startTime))}
                height={trackHeight}
                fill={colors.sleep}
                opacity={0.4}
                style={{ cursor: 'pointer' }}
                onMouseEnter={(e) =>
                  showTooltip(
                    e as unknown as MouseEvent,
                    'Sleep',
                    `${format(session.startTime, 'HH:mm')} - ${format(session.endTime!, 'HH:mm')}`,
                    formatDuration(session.startTime, session.endTime!),
                  )
                }
                onMouseLeave={hideTooltip}
              />
            : null,
          )}

          {/* Meditation sessions - in sleep/meditation lane */}
          {meditationSessions.map((session, i) =>
            session.endTime ?
              <rect
                key={`meditation-${i}`}
                x={x(session.startTime)}
                y={trackSleepMeditation}
                width={Math.max(0, x(session.endTime) - x(session.startTime))}
                height={trackHeight}
                fill={colors.meditation}
                opacity={0.6}
                style={{ cursor: 'pointer' }}
                onMouseEnter={(e) =>
                  showTooltip(
                    e as unknown as MouseEvent,
                    session.title || 'Meditation',
                    `${format(session.startTime, 'HH:mm')} - ${format(session.endTime!, 'HH:mm')}`,
                    formatDuration(session.startTime, session.endTime!),
                  )
                }
                onMouseLeave={hideTooltip}
              />
            : null,
          )}

          {/* Productivity (Computer) - overlaid on top */}
          {productivity
            .filter((p) => !p.isMobile)
            .map((p, i) => (
              <rect
                key={`computer-${i}`}
                x={x(p.startTime)}
                y={0}
                width={Math.max(0, x(p.endTime) - x(p.startTime))}
                height={4}
                fill={colors.computer}
              />
            ))}

          {/* Productivity (Mobile) - overlaid on top */}
          {productivity
            .filter((p) => p.isMobile)
            .map((p, i) => (
              <rect
                key={`mobile-${i}`}
                x={x(p.startTime)}
                y={4}
                width={Math.max(0, x(p.endTime) - x(p.startTime))}
                height={4}
                fill={colors.mobile}
              />
            ))}

          {/* Exercise sessions - in exercise lane */}
          {exerciseSessions.map((session, i) =>
            session.endTime ?
              <rect
                key={`exercise-${i}`}
                x={x(session.startTime)}
                y={trackExercise}
                width={Math.max(0, x(session.endTime) - x(session.startTime))}
                height={trackHeight}
                fill={getExerciseColor(getExerciseTypeName(session), uniqueExerciseTypes)}
                opacity={0.6}
                style={{ cursor: 'pointer' }}
                onMouseEnter={(e) =>
                  showTooltip(
                    e as unknown as MouseEvent,
                    getExerciseTypeName(session),
                    `${format(session.startTime, 'HH:mm')} - ${format(session.endTime!, 'HH:mm')}`,
                    formatDuration(session.startTime, session.endTime!),
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
                x={x(place.startTime)}
                y={trackPlaces}
                width={Math.max(0, x(place.endTime) - x(place.startTime))}
                height={trackHeight}
                fill={getPlaceColor(place.region, uniquePlaceNames)}
                opacity={0.7}
                style={{ cursor: 'pointer' }}
                onMouseEnter={(e) =>
                  showTooltip(
                    e as unknown as MouseEvent,
                    place.region || 'Unknown Location',
                    `${format(place.startTime, 'HH:mm')} - ${format(place.endTime, 'HH:mm')}`,
                    formatDuration(place.startTime, place.endTime),
                  )
                }
                onMouseLeave={hideTooltip}
              />
            ))}

          {/* Tags - dashed lines or rectangles */}
          {tags.map((tag, i) =>
            tag.endTime ?
              <rect
                key={`tag-${i}`}
                x={x(tag.startTime)}
                y={0}
                width={Math.max(0, x(tag.endTime) - x(tag.startTime))}
                height={chartHeight}
                fill="none"
                stroke={colors.tags}
                strokeDasharray="4"
                style={{ cursor: 'pointer' }}
                onMouseEnter={(e) =>
                  showTooltip(
                    e as unknown as MouseEvent,
                    tag.tag,
                    `${format(tag.startTime, 'HH:mm')} - ${format(tag.endTime!, 'HH:mm')}`,
                    formatDuration(tag.startTime, tag.endTime!),
                  )
                }
                onMouseLeave={hideTooltip}
              />
            : <line
                key={`tag-${i}`}
                x1={x(tag.startTime)}
                y1={0}
                x2={x(tag.startTime)}
                y2={chartHeight}
                stroke={colors.tags}
                strokeDasharray="4"
                style={{ cursor: 'pointer' }}
                onMouseEnter={(e) =>
                  showTooltip(e as unknown as MouseEvent, tag.tag, format(tag.startTime, 'HH:mm'))
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

          {/* Brush for selection zoom */}
          <g ref={brushRef} class="brush" />
        </g>
      </svg>
    </div>
  )
}
