import { signal } from '@preact/signals'
import { useQuery } from '@tanstack/react-query'
import * as d3 from 'd3'
import { addDays, endOfDay, formatISO, startOfDay, subDays } from 'date-fns'
import { useCallback, useEffect, useRef } from 'preact/hooks'
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

// Signals to handle user-selected dates (data fetch range)
const fromDate = signal(formatISO(subDays(new Date(), 1), { representation: 'date' }))
const toDate = signal(formatISO(new Date(), { representation: 'date' }))

// Signals for zoom view (visible range, can be subset of fetched data)
const viewStart = signal<Date | null>(null)
const viewEnd = signal<Date | null>(null)

// Signals for toggling data layers
const showHeartRate = signal(true)
const showHrv = signal(true)
const showSleep = signal(true)
const showExercise = signal(true)
const showMeditation = signal(true)
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
  exercise: 'rgba(34, 197, 94, 0.4)', // Green that works in both modes

  // Line charts
  heartRate: '#ef4444', // Red
  hrv: '#22c55e', // Green
  meditation: 'rgba(168, 85, 247, 0.5)', // Purple
  mobile: '#06b6d4', // Cyan
  sleep: 'rgba(59, 130, 246, 0.25)', // Blue

  // Tags - use semi-transparent to work in both modes
  tags: 'rgba(156, 163, 175, 0.5)', // Gray
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

// Generate consistent color for a place name
const getPlaceColor = (placeName: string, allPlaces: string[]): string => {
  const index = allPlaces.indexOf(placeName)
  return placeColorPalette[index % placeColorPalette.length]
}

// Static legend items (places are added dynamically)
const staticLegendItems = [
  { color: colors.heartRate, label: 'Heart Rate', signal: showHeartRate },
  { color: colors.hrv, label: 'HRV', signal: showHrv },
  { color: colors.sleep, label: 'Sleep', signal: showSleep },
  { color: colors.exercise, label: 'Exercise', signal: showExercise },
  { color: colors.meditation, label: 'Meditation', signal: showMeditation },
  { color: colors.computer, label: 'Computer', signal: showProductivity },
  { color: colors.mobile, label: 'Mobile', signal: showProductivity },
  { color: colors.tags, label: 'Tags', signal: showTags },
]

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
    enabled: showSleep.value || showExercise.value || showMeditation.value,
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
  const uniquePlaceNames = [...new Set(places.map((p) => p.region))].sort()

  // Calculate effective view range
  const effectiveViewStart = viewStart.value || start
  const effectiveViewEnd = viewEnd.value || end

  // Handle zoom - update view range
  const handleZoom = useCallback(
    (zoomStart: Date, zoomEnd: Date) => {
      viewStart.value = zoomStart
      viewEnd.value = zoomEnd
    },
    [start, end],
  )

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

  // Reset view when date range changes
  useEffect(() => {
    viewStart.value = null
    viewEnd.value = null
  }, [fromDate.value, toDate.value])

  return (
    <>
      <div class="timeline">
        <h1>Timeline</h1>
        <div style={{ display: 'flex', gap: '2rem', marginBottom: '1rem' }}>
          <div>
            <label>
              From: <input type="date" name="from" value={fromDate.value} onChange={handleDateChange} />
            </label>
            <label style={{ marginLeft: '1rem' }}>
              To: <input type="date" name="to" value={toDate.value} onChange={handleDateChange} />
            </label>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
          <label>
            <input
              type="checkbox"
              checked={showHeartRate.value}
              onChange={(e) => (showHeartRate.value = (e.target as HTMLInputElement).checked)}
            />
            Heart Rate
          </label>
          <label>
            <input
              type="checkbox"
              checked={showHrv.value}
              onChange={(e) => (showHrv.value = (e.target as HTMLInputElement).checked)}
            />
            HRV
          </label>
          <label>
            <input
              type="checkbox"
              checked={showSleep.value}
              onChange={(e) => (showSleep.value = (e.target as HTMLInputElement).checked)}
            />
            Sleep
          </label>
          <label>
            <input
              type="checkbox"
              checked={showExercise.value}
              onChange={(e) => (showExercise.value = (e.target as HTMLInputElement).checked)}
            />
            Exercise
          </label>
          <label>
            <input
              type="checkbox"
              checked={showMeditation.value}
              onChange={(e) => (showMeditation.value = (e.target as HTMLInputElement).checked)}
            />
            Meditation
          </label>
          <label>
            <input
              type="checkbox"
              checked={showProductivity.value}
              onChange={(e) => (showProductivity.value = (e.target as HTMLInputElement).checked)}
            />
            Productivity
          </label>
          <label>
            <input
              type="checkbox"
              checked={showPlaces.value}
              onChange={(e) => (showPlaces.value = (e.target as HTMLInputElement).checked)}
            />
            Places
          </label>
          <label>
            <input
              type="checkbox"
              checked={showTags.value}
              onChange={(e) => (showTags.value = (e.target as HTMLInputElement).checked)}
            />
            Tags
          </label>
        </div>

        <Legend placeNames={showPlaces.value ? uniquePlaceNames : []} />

        {isLoading && <div>Loading...</div>}
        {hasError && <div>Error loading data</div>}

        <TimelineChart
          heartRates={showHeartRate.value ? heartRateQuery.data || [] : []}
          hrvData={showHrv.value ? hrvQuery.data || [] : []}
          activities={activitiesQuery.data || []}
          productivity={showProductivity.value ? productivityQuery.data || [] : []}
          places={showPlaces.value ? places : []}
          tags={showTags.value ? tagsQuery.data || [] : []}
          sleepVisible={showSleep.value}
          exerciseVisible={showExercise.value}
          meditationVisible={showMeditation.value}
          dataStart={start}
          dataEnd={end}
          visibleStart={effectiveViewStart}
          visibleEnd={effectiveViewEnd}
          onZoom={handleZoom}
          onZoomOut={handleZoomOut}
        />
      </div>
    </>
  )
}

function Legend({ placeNames }: { placeNames: string[] }) {
  // Build dynamic legend items for places
  const placeLegendItems = placeNames.map((name) => ({
    color: getPlaceColor(name, placeNames),
    label: name,
  }))

  return (
    <div
      style={{
        border: '1px solid currentColor',
        borderRadius: '4px',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '1rem',
        marginBottom: '1rem',
        opacity: 0.7,
        padding: '0.5rem 1rem',
      }}
    >
      <strong>Legend:</strong>
      {staticLegendItems.map((item) => (
        <div key={item.label} style={{ alignItems: 'center', display: 'flex', gap: '0.25rem' }}>
          <div
            style={{
              backgroundColor: item.color,
              border: item.label === 'Tags' ? '1px dashed currentColor' : 'none',
              height: '12px',
              width: '20px',
            }}
          />
          <span>{item.label}</span>
        </div>
      ))}
      {placeLegendItems.length > 0 && (
        <>
          <span style={{ opacity: 0.5 }}>|</span>
          <span style={{ fontStyle: 'italic' }}>Places:</span>
          {placeLegendItems.map((item) => (
            <div key={item.label} style={{ alignItems: 'center', display: 'flex', gap: '0.25rem' }}>
              <div
                style={{
                  backgroundColor: item.color,
                  height: '12px',
                  width: '20px',
                }}
              />
              <span>{item.label}</span>
            </div>
          ))}
        </>
      )}
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
  sleepVisible: boolean
  exerciseVisible: boolean
  meditationVisible: boolean
  dataStart: Date
  dataEnd: Date
  visibleStart: Date
  visibleEnd: Date
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
  sleepVisible,
  exerciseVisible,
  meditationVisible,
  dataStart,
  dataEnd,
  visibleStart,
  visibleEnd,
  onZoom,
  onZoomOut,
}: TimelineChartProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const brushRef = useRef<SVGGElement>(null)

  const margin = { bottom: 30, left: 40, right: 50, top: 10 }
  const width = 1000
  const height = 500

  const chartWidth = width - margin.left - margin.right
  const chartHeight = height - margin.top - margin.bottom

  // Track heights for different data layers
  const trackHeight = chartHeight / 8
  const trackComputer = 0
  const trackMobile = trackHeight
  const trackExercise = 2 * trackHeight
  const trackPlaces = 3 * trackHeight

  // Time scale based on view range
  const x = d3.scaleTime().domain([visibleStart, visibleEnd]).range([0, chartWidth])

  // Heart rate y scale (left axis)
  const yHr = d3.scaleLinear().domain([40, 200]).range([chartHeight, 0])

  // HRV y scale (right axis) - typical RMSSD values range from 10-100ms
  const yHrv = d3.scaleLinear().domain([0, 150]).range([chartHeight, 0])

  // Get unique place names for consistent coloring
  const uniquePlaceNames = [...new Set(places.map((p) => p.region))].sort()

  // Filter activities by type
  const sleepSessions = sleepVisible ? activities.filter((a) => a.activityType === 'sleep') : []
  const exerciseSessions = exerciseVisible ? activities.filter((a) => a.activityType === 'exercise') : []
  const meditationSessions =
    meditationVisible ? activities.filter((a) => a.activityType === 'meditation') : []

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

  // Setup wheel zoom
  useEffect(() => {
    if (!svgRef.current) return

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()

      const rect = svgRef.current!.getBoundingClientRect()
      const mouseX = event.clientX - rect.left - margin.left

      // Get current view range
      const currentStart = visibleStart.getTime()
      const currentEnd = visibleEnd.getTime()
      const currentRange = currentEnd - currentStart

      // Calculate zoom factor (positive delta = zoom out, negative = zoom in)
      const zoomFactor = event.deltaY > 0 ? 1.2 : 0.8

      // Calculate new range
      const newRange = currentRange * zoomFactor

      // Calculate where in the view the mouse is (0-1)
      const mouseRatio = Math.max(0, Math.min(1, mouseX / chartWidth))

      // Calculate new start/end centered on mouse position
      const mouseTime = currentStart + mouseRatio * currentRange
      const newStart = new Date(mouseTime - mouseRatio * newRange)
      const newEnd = new Date(mouseTime + (1 - mouseRatio) * newRange)

      // Check if we're zooming out beyond the data range
      if (newStart.getTime() < dataStart.getTime() || newEnd.getTime() > dataEnd.getTime()) {
        onZoomOut()
      } else {
        onZoom(newStart, newEnd)
      }
    }

    svgRef.current.addEventListener('wheel', handleWheel, { passive: false })
    return () => svgRef.current?.removeEventListener('wheel', handleWheel)
  }, [visibleStart, visibleEnd, dataStart, dataEnd, chartWidth, margin.left, onZoom, onZoomOut])

  // Double-click to reset zoom
  const handleDoubleClick = useCallback(() => {
    onZoom(dataStart, dataEnd)
  }, [dataStart, dataEnd, onZoom])

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      style={{ color: 'currentColor', cursor: 'crosshair' }}
      onDblClick={handleDoubleClick}
    >
      <g transform={`translate(${margin.left},${margin.top})`}>
        {/* Sleep sessions - full height blue background */}
        {sleepSessions.map((session, i) =>
          session.endTime ?
            <rect
              key={`sleep-${i}`}
              x={x(session.startTime)}
              y={0}
              width={Math.max(0, x(session.endTime) - x(session.startTime))}
              height={chartHeight}
              fill={colors.sleep}
            />
          : null,
        )}

        {/* Meditation sessions - full height purple background */}
        {meditationSessions.map((session, i) =>
          session.endTime ?
            <rect
              key={`meditation-${i}`}
              x={x(session.startTime)}
              y={0}
              width={Math.max(0, x(session.endTime) - x(session.startTime))}
              height={chartHeight}
              fill={colors.meditation}
            />
          : null,
        )}

        {/* Productivity (Computer) - track 0 */}
        {productivity
          .filter((p) => !p.isMobile)
          .map((p, i) => (
            <rect
              key={`computer-${i}`}
              x={x(p.startTime)}
              y={trackComputer}
              width={Math.max(0, x(p.endTime) - x(p.startTime))}
              height={trackHeight}
              fill={colors.computer}
              opacity={0.8}
            />
          ))}

        {/* Productivity (Mobile) - track 1 */}
        {productivity
          .filter((p) => p.isMobile)
          .map((p, i) => (
            <rect
              key={`mobile-${i}`}
              x={x(p.startTime)}
              y={trackMobile}
              width={Math.max(0, x(p.endTime) - x(p.startTime))}
              height={trackHeight}
              fill={colors.mobile}
              opacity={0.8}
            />
          ))}

        {/* Exercise sessions - track 2 */}
        {exerciseSessions.map((session, i) =>
          session.endTime ?
            <rect
              key={`exercise-${i}`}
              x={x(session.startTime)}
              y={trackExercise}
              width={Math.max(0, x(session.endTime) - x(session.startTime))}
              height={trackHeight}
              fill={colors.exercise}
            />
          : null,
        )}

        {/* Places - track 3 */}
        {places.map((place, i) => (
          <rect
            key={`place-${i}`}
            x={x(place.startTime)}
            y={trackPlaces}
            width={Math.max(0, x(place.endTime) - x(place.startTime))}
            height={trackHeight}
            fill={getPlaceColor(place.region, uniquePlaceNames)}
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
            />
          : <line
              key={`tag-${i}`}
              x1={x(tag.startTime)}
              y1={0}
              x2={x(tag.startTime)}
              y2={chartHeight}
              stroke={colors.tags}
              strokeDasharray="4"
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
        <g
          transform={`translate(0,${chartHeight})`}
          ref={(g) => {
            if (g)
              d3.select(g).call(
                d3
                  .axisBottom(x)
                  .ticks(d3.timeHour.every(6))
                  .tickFormat((d) => d3.timeFormat('%a %H')(d as Date)),
              )
          }}
        />

        {/* Brush for selection zoom */}
        <g ref={brushRef} class="brush" />
      </g>
    </svg>
  )
}
