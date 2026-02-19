/* eslint-disable max-lines -- large visualization component */
import { signal } from '@preact/signals'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import * as d3 from 'd3'
import { addDays, endOfDay, format, formatISO, startOfDay, subDays } from 'date-fns'
import { useCallback, useEffect, useRef } from 'preact/hooks'
import {
  Activity,
  fetchActivities,
  fetchPlaces,
  fetchProductivity,
  fetchTags,
  Place,
  ProductivityRecord,
  Tag,
} from '../../state/api'
import { packLanes } from '../../utils/lanePacking'

import './style.css'

// State: fetch range and view range
const fromDate = signal(formatISO(subDays(new Date(), 1), { representation: 'date' }))
const toDate = signal(formatISO(new Date(), { representation: 'date' }))
const viewStart = signal<Date | null>(null)
const viewEnd = signal<Date | null>(null)

// Default view: start of today to end of today
const getDefaultViewStart = () => startOfDay(new Date())
const getDefaultViewEnd = () => endOfDay(new Date())

// Column definitions
const COLUMNS = ['Sleep / Rest', 'Exercise', 'Location', 'Tags / Events', 'Productivity'] as const
type Column = (typeof COLUMNS)[number]

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

// Categorized item for the chart
interface ChartItem {
  column: Column
  start: Date
  end: Date
  label: string
  color: string
  tooltip: TooltipContent
  isPoint: boolean
}

interface TooltipContent {
  title: string
  time: string
  details: string[]
}

// Categorization per column
const categorizeSleepRest = (activities: Activity[], tags: Tag[]): ChartItem[] =>
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
      const details: string[] = [formatDuration(a.start_time, end)]
      if (a.avg_hrv) details.push(`Avg HRV: ${a.avg_hrv} ms`)
      if (a.notes) details.push(a.notes)

      // For meditation, show overlapping last.fm tags
      if (a.activity_type === 'meditation') {
        const music = tags
          .filter((t) => t.source === 'lastfm' || t.source === 'lastfm-auto')
          .filter((t) => {
            const tagEnd = t.end_time ?? new Date(t.start_time.getTime() + 4 * 60000)
            return t.start_time < end && tagEnd > a.start_time
          })
          .map((t) => t.tag)
        if (music.length > 0) details.push(`♪ ${music.slice(0, 3).join(', ')}`)
      }

      return {
        color: activityColors[a.activity_type] ?? '#3b82f6',
        column: 'Sleep / Rest' as Column,
        end,
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
        color: getExerciseColor(a),
        column: 'Exercise' as Column,
        end,
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
    isPoint: false,
    label: p.region || 'Unknown',
    start: p.start_time,
    tooltip: {
      details: [formatDuration(p.start_time, p.end_time)],
      time: `${formatTime(p.start_time)} – ${formatTime(p.end_time)}`,
      title: p.region || 'Unknown',
    },
  }))

const categorizeTags = (tags: Tag[]): ChartItem[] =>
  tags
    .filter((t) => t.source !== 'lastfm' && t.source !== 'lastfm-auto')
    .map((t) => {
      const isPoint = !t.end_time
      const end = t.end_time ?? new Date(t.start_time.getTime() + 15 * 60000)
      const sourceLabel = t.source ? ` (${t.source})` : ''
      return {
        color: getTagColor(t),
        column: 'Tags / Events' as Column,
        end,
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

const categorizeProductivity = (productivity: ProductivityRecord[]): ChartItem[] =>
  productivity.map((p) => ({
    color: getProductivityColor(p.productivity),
    column: 'Productivity' as Column,
    end: p.end_time,
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

// Find overlapping lastfm tags for a given time range
const findOverlappingMusic = (tags: Tag[], start: Date, end: Date): string[] => {
  const music: string[] = []
  for (const t of tags) {
    if (t.source !== 'lastfm' && t.source !== 'lastfm-auto') continue
    const tagEnd = t.end_time ?? new Date(t.start_time.getTime() + 4 * 60000)
    if (t.start_time < end && tagEnd > start) {
      music.push(t.tag)
    }
  }
  return music
}

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

// eslint-disable-next-line complexity -- D3 visualization component
export const DayView = () => {
  const effectiveViewStart = viewStart.value ?? getDefaultViewStart()
  const effectiveViewEnd = viewEnd.value ?? getDefaultViewEnd()

  // Fetch range: includes a buffer around the view
  const fetchStart = startOfDay(new Date(fromDate.value))
  const fetchEnd = endOfDay(new Date(toDate.value))

  const activitiesQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => fetchActivities(subDays(fetchStart, 0.5), addDays(fetchEnd, 0.5)),
    queryKey: ['dayview-activities', fromDate.value, toDate.value],
    staleTime: 10 * 60 * 1000,
  })

  const placesQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => fetchPlaces(subDays(fetchStart, 0.5), addDays(fetchEnd, 0.5)),
    queryKey: ['dayview-places', fromDate.value, toDate.value],
    staleTime: 10 * 60 * 1000,
  })

  const tagsQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => fetchTags(subDays(fetchStart, 0.5), addDays(fetchEnd, 0.5)),
    queryKey: ['dayview-tags', fromDate.value, toDate.value],
    staleTime: 10 * 60 * 1000,
  })

  const productivityQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => fetchProductivity(fetchStart, fetchEnd),
    queryKey: ['dayview-productivity', fromDate.value, toDate.value],
    staleTime: 10 * 60 * 1000,
  })

  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown>>()
  const isProgrammaticZoom = useRef(false)
  const baseScaleRef = useRef<d3.ScaleTime<number, number>>()
  const zoomRafRef = useRef<number>(0)

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

  const activities = activitiesQuery.data ?? []
  const places = placesQuery.data ?? []
  const tags = tagsQuery.data ?? []
  const productivity = productivityQuery.data ?? []

  const uniquePlaceNames = [...new Set(places.map((p) => p.region))].filter(Boolean).sort()
  const chartItems = [
    ...categorizeSleepRest(activities, tags),
    ...categorizeExercise(activities),
    ...categorizeLocations(places, uniquePlaceNames),
    ...categorizeTags(tags),
    ...categorizeProductivity(productivity),
  ]

  // Group by column and pack lanes
  const columnData = COLUMNS.map((col) => {
    const colItems = chartItems.filter((i) => i.column === col)
    const packed = packLanes(
      colItems,
      (i) => i.start,
      (i) => (i.isPoint ? undefined : i.end),
    )
    return { column: col, ...packed }
  })

  const isFetching =
    activitiesQuery.isFetching ||
    placesQuery.isFetching ||
    tagsQuery.isFetching ||
    productivityQuery.isFetching

  // Render SVG chart
  const renderChart = useCallback(() => {
    if (!svgRef.current || !containerRef.current) return

    const containerWidth = containerRef.current.clientWidth
    const chartWidth = containerWidth - margin.left - margin.right

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', containerWidth).attr('height', CHART_HEIGHT + margin.top + margin.bottom)

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    // Base scale maps the default 1-day view to the chart height
    const baseScale = d3
      .scaleTime()
      .domain([getDefaultViewStart(), getDefaultViewEnd()])
      .range([0, CHART_HEIGHT])
    baseScaleRef.current = baseScale

    // Current view scale
    const yScale = d3.scaleTime().domain([effectiveViewStart, effectiveViewEnd]).range([0, CHART_HEIGHT])

    // Column layout
    const colWidth = chartWidth / COLUMNS.length
    const colGap = 4
    const colPadding = 2

    // Clip path
    svg
      .append('defs')
      .append('clipPath')
      .attr('id', 'chart-clip')
      .append('rect')
      .attr('width', chartWidth)
      .attr('height', CHART_HEIGHT)

    const chartGroup = g.append('g').attr('clip-path', 'url(#chart-clip)')

    const showTooltip = (event: MouseEvent, item: ChartItem) => {
      if (!tooltipRef.current || !containerRef.current) return
      const music = findOverlappingMusic(tags, item.start, item.end)
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

    // Draw function (called on zoom)
    const draw = (currentYScale: d3.ScaleTime<number, number>) => {
      chartGroup.selectAll('*').remove()
      g.selectAll('.hour-label').remove()
      g.selectAll('.day-label').remove()

      const domain = currentYScale.domain()
      const domainStart = domain[0]!
      const domainEnd = domain[1]!

      // Hourly grid lines
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

      // Hour labels on left
      g.selectAll('.hour-label')
        .data(hours)
        .enter()
        .append('text')
        .attr('class', 'hour-label')
        .attr('x', -8)
        .attr('y', (d) => currentYScale(d))
        .attr('dy', '0.35em')
        .attr('text-anchor', 'end')
        .attr('fill', 'currentColor')
        .attr('font-size', '0.7rem')
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
      for (let i = 1; i < COLUMNS.length; i++) {
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

      // Now line
      drawNowLine(chartGroup, chartWidth, currentYScale)
    }

    // Initial draw with current view
    draw(yScale)

    // Compute D3 zoom transform from the current view
    const computeTransform = (vStart: Date, vEnd: Date): d3.ZoomTransform => {
      const by0 = baseScale(vStart)
      const by1 = baseScale(vEnd)
      const k = CHART_HEIGHT / (by1 - by0)
      const ty = -k * by0
      return d3.zoomIdentity.translate(0, ty).scale(k)
    }

    // D3 zoom
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 20])
      .filter((event) => event.type !== 'dblclick')
      .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        if (isProgrammaticZoom.current) return
        cancelAnimationFrame(zoomRafRef.current)
        zoomRafRef.current = requestAnimationFrame(() => {
          const newY = event.transform.rescaleY(baseScale)
          const newDomain = newY.domain()
          draw(d3.scaleTime().domain(newDomain).range([0, CHART_HEIGHT]))
          handleZoom(newDomain[0], newDomain[1])
        })
      })

    svg.call(zoom)
    zoomBehaviorRef.current = zoom

    // Set initial transform to match current view
    const initialTransform = computeTransform(effectiveViewStart, effectiveViewEnd)
    isProgrammaticZoom.current = true
    svg.call(zoom.transform, initialTransform)
    isProgrammaticZoom.current = false

    // Double-click resets to today
    svg.on('dblclick.zoom', () => {
      handleResetToToday()
    })
  }, [
    activities,
    chartItems,
    columnData,
    effectiveViewEnd,
    effectiveViewStart,
    handleResetToToday,
    handleZoom,
    tags,
  ])

  // Re-render on data change and resize
  useEffect(() => {
    renderChart()
    const resizeObserver = new ResizeObserver(() => renderChart())
    if (containerRef.current) resizeObserver.observe(containerRef.current)
    return () => resizeObserver.disconnect()
  }, [renderChart])

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
        <span class="legend-item">
          <span class="legend-dot" style={{ background: activityColors.sleep }} />
          Sleep
        </span>
        <span class="legend-item">
          <span class="legend-dot" style={{ background: activityColors.nap }} />
          Nap
        </span>
        <span class="legend-item">
          <span class="legend-dot" style={{ background: activityColors.meditation }} />
          Meditation
        </span>
        <span class="legend-item">
          <span class="legend-dot" style={{ background: hrZoneColors[2] }} />
          Exercise
        </span>
        <span class="legend-item">
          <span class="legend-dot" style={{ background: tagSourceColors.calendar }} />
          Calendar
        </span>
        <span class="legend-item">
          <span class="legend-dot" style={{ background: TAG_COLOR }} />
          Tags
        </span>
      </div>

      {isLoading && <div class="loading">Loading…</div>}
      {isError && <div class="error">Error loading data</div>}

      {!isLoading && !isError && (
        <>
          <div class="day-view-column-headers" style={{ paddingLeft: `${margin.left}px` }}>
            {COLUMNS.map((col, i) => (
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
            {mobileItems.map((item, idx) => (
              <div class="day-view-list-item" key={idx}>
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
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// D3 drawing helpers extracted to reduce component complexity

type ColumnDataEntry = {
  column: (typeof COLUMNS)[number]
  items: { item: ChartItem; lane: number }[]
  laneCount: number
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
    const colX = colIdx * colWidth + colGap
    const usableWidth = colWidth - colGap * 2
    const lanes = Math.max(laneCount, 1)
    const laneWidth = (usableWidth - (lanes - 1) * colPadding) / lanes

    for (const { item, lane } of packedItems) {
      drawItem(chartGroup, item, lane, colX, laneWidth, colPadding, yScale, showTooltip, hideTooltip)
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

  if (item.isPoint) {
    const cy = y1
    const size = Math.min(laneWidth / 2, 6)
    chartGroup
      .append('polygon')
      .attr(
        'points',
        `${x + laneWidth / 2},${cy - size} ${x + laneWidth / 2 + size},${cy} ${x + laneWidth / 2},${cy + size} ${x + laneWidth / 2 - size},${cy}`,
      )
      .attr('fill', item.color)
      .attr('opacity', 0.85)
      .on('mouseenter', (event: MouseEvent) => showTooltip(event, item))
      .on('mouseleave', hideTooltip)
    return
  }

  // Rectangle block
  chartGroup
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
    const maxChars = Math.floor(laneWidth / 6)
    const text = item.label.length > maxChars ? item.label.slice(0, maxChars) + '…' : item.label
    chartGroup
      .append('text')
      .attr('x', x + 4)
      .attr('y', y1 + 14)
      .attr('fill', 'white')
      .attr('font-size', '0.65rem')
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
