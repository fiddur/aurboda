import { useSignalEffect } from '@preact/signals'
import * as d3 from 'd3'
import { endOfDay, format, startOfDay } from 'date-fns'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'

import type { LegendCategory } from './legendCategories'
import type { ChartItem, Orientation } from './types'

import { aggregateBucketsAligned } from '../../utils/chart'
import { packLanes } from '../../utils/lanePacking'
import { computeBarLayout, type BarSlot } from './barLayout'
import { drawActivitySparklines } from './drawActivitySparklines'
import { attachHoverHandlers, drawItemIcon, getDetailUrl, truncateLabel } from './drawItems'
import { computeYScales, drawMetricsTrack, HR_COLOR, HRV_COLOR } from './drawMetricsTrack'
import {
  buildMusicTooltipHtml,
  drawMusicSessions,
  getMergeGapMs,
  mergeScrobblesIntoSessions,
  MUSIC_STAFF_HEIGHT,
} from './drawMusicStaff'
import { drawScreentimeBars } from './drawScreentimeTrack'
import { drawTrainingLoadTrack } from './drawTrainingLoadTrack'
import { drawColumnItems, drawHorizontalNowLine, drawNowLine } from './drawVerticalHelpers'
import { findOverlappingScrobbles } from './findOverlappingScrobbles'
import { TimelineControls } from './TimelineControls'
import { TimelineLegend } from './TimelineLegend'
import { buildTooltipHtml } from './tooltipBuilder'
import { useTimelineData } from './useTimelineData'
import { _initialHash, useTimelineNavigation } from './useTimelineNavigation'
import { HORIZONTAL_MARGIN, useTimelineZoom, VERTICAL_MARGIN } from './useTimelineZoom'
import { buildViewHash, getDefaultOrientation } from './viewHash'
import './style.css'

// ── Main Timeline component ───────────────────────────────────────────────────

// eslint-disable-next-line complexity -- D3 visualization component
export const Timeline = () => {
  // ── Navigation hook ──────────────────────────────────────────────────────
  const nav = useTimelineNavigation()
  const {
    effectiveViewStart,
    effectiveViewEnd,
    fetchStart,
    fetchEnd,
    fromDate,
    toDate,
    viewStart,
    viewEnd,
    handleZoom,
    handleJumpDays,
    handleResetToToday,
    viewLabel,
    bucketSize,
    barBucketSize,
    mergeGapMs,
    shouldCollapseHierarchy,
  } = nav

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
    const firstChild = el.firstElementChild as HTMLElement | null
    if (!firstChild) return
    const oneRowHeight = firstChild.getBoundingClientRect().height || 36
    if (el.scrollHeight > oneRowHeight + 8) {
      setLegendCollapsed(true)
    }
  }, [])

  // Escape key exits fullscreen
  useEffect(() => {
    if (!isFullscreen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isFullscreen])

  // ── Toggle state ──────────────────────────────────────────────────────────
  const [hiddenCategories, setHiddenCategories] = useState<Set<LegendCategory>>(
    () => new Set(_initialHash.hide),
  )
  const hiddenCategoriesRef = useRef<Set<LegendCategory>>(hiddenCategories)
  hiddenCategoriesRef.current = hiddenCategories

  // ── Data hook ─────────────────────────────────────────────────────────────
  const data = useTimelineData({
    barBucketSize,
    bucketSize,
    fetchEnd,
    fetchStart,
    fromDateKey: fromDate.value,
    hiddenCategories,
    mergeGapMs,
    shouldCollapseHierarchy,
    toDateKey: toDate.value,
  })
  const {
    activities,
    activityItems,
    chartItems,
    columnData,
    columns,
    sparklineBuckets,
    horizontalMetricBuckets,
    scrobbles,
    trainingLoadQuery,
    screentimeBucketedQuery,
    screentimeCategoriesQuery,
    isFetching,
    isInitialLoad,
    errorSources,
    hasLastFm,
  } = data

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

  // ── Refs ───────────────────────────────────────────────────────────────────

  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const drawRef = useRef<((scale: d3.ScaleTime<number, number>) => void) | null>(null)
  const hAxisGroupRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null)

  const scaffoldOrientationRef = useRef<Orientation | null>(null)
  const scaffoldDimsRef = useRef<{ w: number; h: number } | null>(null)
  const scaffoldLayoutKeyRef = useRef<string>('')
  /** Tracks the fetch range the base scale was built for. */
  const scaffoldFetchKeyRef = useRef<string>('')

  // ── Derived layout data ───────────────────────────────────────────────────

  const todayKey = format(new Date(), 'yyyy-MM-dd')
  const baseScaleDomain = useMemo(
    () => [startOfDay(new Date(todayKey)), endOfDay(new Date(todayKey))] as [Date, Date],
    [todayKey],
  )

  // ── Zoom hook ──────────────────────────────────────────────────────────────

  const { currentScaleRef, attachZoom } = useTimelineZoom({
    containerRef,
    drawRef,
    onResetToToday: handleResetToToday,
    onZoomEnd: handleZoom,
    orientation,
    svgRef,
  })

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

  // ── Chart rendering ─────────────────────────────────────────────────────────
  // Scaffold refs: SVG groups that persist across data changes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type SvgGroup = d3.Selection<any, unknown, null, undefined>
  const scaffoldGroupRef = useRef<SvgGroup | null>(null)
  const scaffoldChartGroupRef = useRef<SvgGroup | null>(null)
  const scaffoldDefsRef = useRef<SvgGroup | null>(null)

  // Resize counter — incremented by ResizeObserver to trigger the render effect.
  const [resizeKey, setResizeKey] = useState(0)

  // ── Resize observer ─────────────────────────────────────────────────────────
  useEffect(() => {
    let resizeRaf = 0
    let lastW = 0
    let lastH = 0
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const w = Math.round(entry.contentRect.width)
      const h = Math.round(entry.contentRect.height)
      if (w === lastW && h === lastH) return
      lastW = w
      lastH = h
      cancelAnimationFrame(resizeRaf)
      resizeRaf = requestAnimationFrame(() => {
        setResizeKey((k) => k + 1)
      })
    })
    if (containerRef.current) resizeObserver.observe(containerRef.current)
    return () => {
      cancelAnimationFrame(resizeRaf)
      resizeObserver.disconnect()
    }
  }, [])

  // ── Unified render effect ─────────────────────────────────────────────────
  // Separated into scaffold setup (rare) and draw (every data/zoom change).

  // eslint-disable-next-line complexity -- D3 visualization with scaffold + draw separation
  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return

    const containerWidth = containerRef.current.clientWidth
    const containerHeight = containerRef.current.clientHeight
    const dims = scaffoldDimsRef.current

    // In horizontal mode, scaffold layout depends on which tracks are visible (legend toggles
    // affect lane positions, labels, and Y-axes). Track this so we rebuild when they change.
    const layoutKey =
      orientation === 'horizontal'
        ? `${scrobbles.length > 0 && !hiddenCategories.has('music')}_${!hiddenCategories.has('activity')}_${!hiddenCategories.has('metrics')}_${!hiddenCategories.has('location')}`
        : ''

    // The base scale domain must match the fetch range (horizontal) or today (vertical).
    // When the fetch range expands (user zooms past boundary) or contracts (reset to today),
    // the scaffold must rebuild so the D3 zoom transform stays in sync with the base scale.
    const fetchKey = `${fromDate.value}_${toDate.value}`

    // Check if scaffold needs rebuild
    const needsSetup =
      scaffoldOrientationRef.current !== orientation ||
      !dims ||
      dims.w !== containerWidth ||
      dims.h !== containerHeight ||
      scaffoldLayoutKeyRef.current !== layoutKey ||
      scaffoldFetchKeyRef.current !== fetchKey

    // ── SCAFFOLD SETUP (only when needed) ──────────────────────────────────
    if (needsSetup) {
      const svg = d3.select(svgRef.current)
      svg.selectAll('*').remove()
      svg.attr('width', containerWidth).attr('height', containerHeight)

      if (orientation === 'vertical') {
        const margin = VERTICAL_MARGIN
        const chartWidth = containerWidth - margin.left - margin.right
        const chartHeight = Math.max(200, containerHeight - margin.top - margin.bottom)

        const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)
        const defs = svg.append('defs')
        defs
          .append('clipPath')
          .attr('id', 'chart-clip')
          .append('rect')
          .attr('width', chartWidth)
          .attr('height', chartHeight)
        const chartGroup = g.append('g').attr('clip-path', 'url(#chart-clip)')

        scaffoldGroupRef.current = g
        scaffoldChartGroupRef.current = chartGroup
        scaffoldDefsRef.current = defs

        const baseScale = d3.scaleTime().domain(baseScaleDomain).range([0, chartHeight])
        attachZoom(baseScale, effectiveViewStart, effectiveViewEnd, chartHeight)
      } else {
        const margin = HORIZONTAL_MARGIN
        const chartWidth = containerWidth - margin.left - margin.right
        const chartHeight = Math.max(150, containerHeight - margin.top - margin.bottom)

        const LOCATION_TRACK_HEIGHT = 34
        const showMusicTrackS = scrobbles.length > 0 && !hiddenCategories.has('music')
        const showActivityTrackS = !hiddenCategories.has('activity')
        const showMetricsTrackS = !hiddenCategories.has('metrics')
        const showLocationTrackS = !hiddenCategories.has('location')

        const musicTrackHeight = showMusicTrackS ? MUSIC_STAFF_HEIGHT : 0
        const locationTrackHeight = showLocationTrackS ? LOCATION_TRACK_HEIGHT : 0
        const remainingHeight = chartHeight - musicTrackHeight - locationTrackHeight
        const dynamicTrackCount = [showActivityTrackS, showMetricsTrackS].filter(Boolean).length
        const dynamicTrackHeight = dynamicTrackCount > 0 ? remainingHeight / dynamicTrackCount : 0
        const activityTrackHeightS = showActivityTrackS ? Math.max(40, dynamicTrackHeight) : 0
        const metricsTrackHeightS = showMetricsTrackS ? Math.max(40, dynamicTrackHeight) : 0

        let nextY = 0
        const trackMusicS = nextY
        nextY += musicTrackHeight
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const _trackActivityS = nextY
        nextY += activityTrackHeightS
        const trackMetricsS = nextY
        nextY += metricsTrackHeightS
        const trackPlacesS = nextY

        const defs = svg.append('defs')
        defs
          .append('clipPath')
          .attr('id', 'h-chart-clip')
          .append('rect')
          .attr('x', 0)
          .attr('y', 0)
          .attr('width', chartWidth)
          .attr('height', chartHeight)

        const outerG = svg
          .append('g')
          .attr('class', 'chart-outer')
          .attr('transform', `translate(${margin.left},${margin.top})`)

        // Static lane separators
        const separatorYs: number[] = []
        if (showMusicTrackS && musicTrackHeight > 0) separatorYs.push(musicTrackHeight)
        if (showActivityTrackS && showMetricsTrackS) separatorYs.push(trackMetricsS)
        if (showLocationTrackS && locationTrackHeight > 0) separatorYs.push(trackPlacesS)
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

        // Static lane labels
        const laneLabels: { label: string; y: number; height: number }[] = [
          ...(showMusicTrackS ? [{ height: musicTrackHeight, label: 'Music', y: trackMusicS }] : []),
          ...(showActivityTrackS
            ? [{ height: activityTrackHeightS, label: 'Activity', y: _trackActivityS }]
            : []),
          ...(showMetricsTrackS ? [{ height: metricsTrackHeightS, label: 'Metrics', y: trackMetricsS }] : []),
          ...(showLocationTrackS
            ? [{ height: locationTrackHeight, label: 'Location', y: trackPlacesS }]
            : []),
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

        // X-axis group
        const xAxisGroup = outerG
          .append('g')
          .attr('class', 'h-x-axis')
          .attr('transform', `translate(0,${chartHeight})`)
        hAxisGroupRef.current = xAxisGroup

        // Clipped content group
        const clipped = outerG.append('g').attr('clip-path', 'url(#h-chart-clip)')
        const chartGroup = clipped.append('g').attr('class', 'h-content')

        scaffoldGroupRef.current = outerG
        scaffoldChartGroupRef.current = chartGroup
        scaffoldDefsRef.current = defs

        // Static Y-axes for metrics
        const metricBuckets = horizontalMetricBuckets
        const metricsTrackBottom = trackMetricsS + metricsTrackHeightS
        const barBucketMs =
          barBucketSize === '1w' ? 7 * 86400000 : barBucketSize === '1d' ? 86400000 : 3600000
        const barAggBuckets =
          metricBuckets.length >= 2 &&
          metricBuckets[1]!.start.getTime() - metricBuckets[0]!.start.getTime() < barBucketMs
            ? aggregateBucketsAligned(metricBuckets, barBucketMs)
            : metricBuckets
        const metricsYScales =
          metricBuckets.length > 0
            ? computeYScales(metricBuckets, trackMetricsS, metricsTrackBottom, barAggBuckets)
            : null

        if (showMetricsTrackS && metricsYScales) {
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

        const hFetchStart = startOfDay(new Date(fromDate.value))
        const hFetchEnd = endOfDay(new Date(toDate.value))
        const baseScale = d3.scaleTime().domain([hFetchStart, hFetchEnd]).range([0, chartWidth])
        attachZoom(baseScale, effectiveViewStart, effectiveViewEnd, chartWidth)
      }

      scaffoldOrientationRef.current = orientation
      scaffoldDimsRef.current = { w: containerWidth, h: containerHeight }
      scaffoldLayoutKeyRef.current = layoutKey
      scaffoldFetchKeyRef.current = fetchKey
    }

    // ── CREATE DRAW FUNCTION (always — captures latest data) ────────────────
    const chartGroup = scaffoldChartGroupRef.current
    const g = scaffoldGroupRef.current
    const defs = scaffoldDefsRef.current
    if (!chartGroup || !g) return

    if (orientation === 'vertical') {
      const margin = VERTICAL_MARGIN
      const chartWidth = containerWidth - margin.left - margin.right
      const colWidth = chartWidth / columns.length
      const colGap = 4
      const colPadding = 2

      // eslint-disable-next-line complexity -- D3 vertical layout draw loop
      drawRef.current = (currentYScale: d3.ScaleTime<number, number>) => {
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
        if (defs && sparklineBuckets.length > 0 && (showSparkHR || showSparkHRV || showSparkStress)) {
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
    } else {
      // ── Horizontal draw function ──────────────────────────────────────────
      const margin = HORIZONTAL_MARGIN
      const chartWidth = containerWidth - margin.left - margin.right
      const chartHeight = Math.max(150, containerHeight - margin.top - margin.bottom)

      const LOCATION_TRACK_HEIGHT = 34
      const ICON_SIZE = 18

      const showMusicTrack = scrobbles.length > 0 && !hiddenCategories.has('music')
      const showActivityTrack = !hiddenCategories.has('activity')
      const showMetricsTrackH = !hiddenCategories.has('metrics')
      const showLocationTrack = !hiddenCategories.has('location')

      const musicTrackHeight = showMusicTrack ? MUSIC_STAFF_HEIGHT : 0
      const locationTrackHeight = showLocationTrack ? LOCATION_TRACK_HEIGHT : 0
      const remainingHeight = chartHeight - musicTrackHeight - locationTrackHeight
      const dynamicTrackCount = [showActivityTrack, showMetricsTrackH].filter(Boolean).length
      const dynamicTrackHeight = dynamicTrackCount > 0 ? remainingHeight / dynamicTrackCount : 0
      const activityTrackHeight = showActivityTrack ? Math.max(40, dynamicTrackHeight) : 0
      const metricsTrackHeight = showMetricsTrackH ? Math.max(40, dynamicTrackHeight) : 0

      let nextY = 0
      const trackMusic = nextY
      nextY += musicTrackHeight
      const trackActivity = nextY
      nextY += activityTrackHeight
      const trackMetrics = nextY
      nextY += metricsTrackHeight
      const trackPlaces = nextY

      const metricBuckets = horizontalMetricBuckets
      const trainingLoadData = trainingLoadQuery.data ?? null

      const metricsTrackBottom = trackMetrics + metricsTrackHeight
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
      const outerG = g

      // eslint-disable-next-line complexity -- D3 horizontal layout draw loop
      drawRef.current = (currentXScale: d3.ScaleTime<number, number>) => {
        chartGroup.selectAll('*').remove()
        const ag = hAxisGroupRef.current
        if (!ag) return

        const domain = currentXScale.domain()
        const domainStart = domain[0]!
        const domainEnd = domain[1]!
        const domainStartMs = domainStart.getTime()
        const domainEndMs = domainEnd.getTime()

        const isInViewport = (item: { start: Date; end: Date }) => {
          const startMs = item.start.getTime()
          const endMs = item.end.getTime()
          return endMs >= domainStartMs && startMs <= domainEndMs
        }

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

        if (showMusicTrack) {
          const musicMergeGapMs = getMergeGapMs(pixelsPerHour)
          const allSessions = mergeScrobblesIntoSessions(scrobbles, musicMergeGapMs)
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

        for (const { item, lane } of packedActivityItems.items) {
          if (!isInViewport(item)) continue
          const laneY = trackActivity + lane * activitySubLaneHeight
          const laneH = activitySubLaneHeight - 1
          const rx = currentXScale(item.start)
          const detailUrl = getDetailUrl(item)

          if (item.isPoint) {
            const icon = item.icon
            const tagCx = rx
            const tagCy = laneY + laneH / 2
            const boxWidth = Math.max(0, currentXScale(item.end) - rx)
            const iconSize = Math.max(ICON_SIZE, Math.min(laneH, boxWidth))

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const parent: d3.Selection<any, unknown, null, undefined> = detailUrl
              ? chartGroup.append('a').attr('href', detailUrl).attr('data-clickable', 'true')
              : chartGroup

            const cursor = detailUrl ? 'pointer' : 'default'
            const iconEl = drawItemIcon(parent, icon, tagCx, tagCy, iconSize, {
              cursor,
              pointerEvents: 'all',
            })
            if (iconEl) {
              iconEl
                .on('mouseenter', (event: MouseEvent) => showTooltip(event, item))
                .on('mouseleave', hideTooltip)
            } else {
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

          const rw = Math.max(0, currentXScale(item.end) - rx)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const parent: d3.Selection<any, unknown, null, undefined> = detailUrl
            ? chartGroup.append('a').attr('href', detailUrl).attr('data-clickable', 'true')
            : chartGroup

          const rect = parent
            .append('rect')
            .attr('x', rx)
            .attr('y', laneY)
            .attr('width', rw)
            .attr('height', laneH)
            .attr('fill', item.color)
            .attr('opacity', 0.7)
            .attr('rx', 2)
            .attr('cursor', detailUrl ? 'pointer' : 'default')
          attachHoverHandlers(rect, item, showTooltip, hideTooltip)

          const blockIconSize = Math.max(ICON_SIZE, Math.min(laneH, rw))
          if (!drawItemIcon(parent, item.icon, rx + rw / 2, laneY + laneH / 2, blockIconSize) && rw > 40) {
            parent
              .append('text')
              .attr('x', rx + 4)
              .attr('y', laneY + Math.min(laneH * 0.6, 14))
              .attr('fill', 'white')
              .attr('font-size', '0.65rem')
              .attr('pointer-events', 'none')
              .text(truncateLabel(item.label, rw))
          }
        }

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

          const placeRect = parent
            .append('rect')
            .attr('x', px)
            .attr('y', trackPlaces)
            .attr('width', pw)
            .attr('height', LOCATION_TRACK_HEIGHT)
            .attr('fill', place.color)
            .attr('opacity', 0.7)
            .attr('rx', 2)
            .attr('cursor', placeUrl ? 'pointer' : 'default')
          attachHoverHandlers(placeRect, place, showTooltip, hideTooltip)

          if (pw > 30) {
            parent
              .append('text')
              .attr('x', px + 4)
              .attr('y', trackPlaces + LOCATION_TRACK_HEIGHT / 2)
              .attr('dy', '0.35em')
              .attr('fill', 'white')
              .attr('font-size', '0.6rem')
              .attr('pointer-events', 'none')
              .text(truncateLabel(place.label, pw))
          }
        }

        const showHR = !hiddenCategories.has('hr') && showMetricsTrackH
        const showHRV = !hiddenCategories.has('hrv') && showMetricsTrackH
        const showStress = !hiddenCategories.has('stress') && showMetricsTrackH
        const showSteps = !hiddenCategories.has('steps') && showMetricsTrackH
        const showCalories = !hiddenCategories.has('calories') && showMetricsTrackH
        const showTL = !hiddenCategories.has('training_load') && showMetricsTrackH
        const showScreentimeH = !hiddenCategories.has('screen_time_h') && showMetricsTrackH
        const screentimeBuckets = screentimeBucketedQuery.data ?? []
        const screentimeHasData = screentimeBuckets.length > 0

        const barSlots: BarSlot[] = [
          { id: 'fatigue', visible: showTL && !!trainingLoadData },
          { id: 'impulse', visible: showTL && !!trainingLoadData },
          { id: 'screentime', visible: showScreentimeH && screentimeHasData },
          { id: 'steps', visible: showSteps },
          { id: 'calories', visible: showCalories },
        ]
        const barLayout = computeBarLayout(barSlots)

        if (showMetricsTrackH && (metricsYScales || (showTL && trainingLoadData) || screentimeHasData)) {
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
              ? { screentimeBuckets, screentimeCategories: screentimeCategoriesQuery.data ?? [] }
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

        if (showMetricsTrackH && showTL && trainingLoadData) {
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

        if (showMetricsTrackH && showScreentimeH && screentimeHasData) {
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

        drawHorizontalNowLine(chartGroup, chartHeight, currentXScale)

        ag.call(d3.axisBottom(currentXScale).ticks(8) as never)
          .selectAll('text')
          .style('fill', 'currentColor')
      }
    }

    // ── CALL DRAW with current view position ────────────────────────────────
    const chartDimension =
      orientation === 'vertical'
        ? Math.max(200, containerHeight - VERTICAL_MARGIN.top - VERTICAL_MARGIN.bottom)
        : containerWidth - HORIZONTAL_MARGIN.left - HORIZONTAL_MARGIN.right

    const scale =
      currentScaleRef.current ??
      d3.scaleTime().domain([effectiveViewStart, effectiveViewEnd]).range([0, chartDimension])
    drawRef.current?.(scale)
  }, [
    orientation,
    resizeKey,
    baseScaleDomain,
    chartItems,
    columnData,
    columns,
    effectiveViewEnd,
    effectiveViewStart,
    sparklineBuckets,
    hiddenCategories,
    horizontalMetricBuckets,
    scrobbles,
    activityItems,
    showTooltip,
    hideTooltip,
    showMusicTooltip,
    trainingLoadQuery.data,
    screentimeBucketedQuery.data,
    screentimeCategoriesQuery.data,
    barBucketSize,
    attachZoom,
  ])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div class={`timeline-view${isFullscreen ? ' timeline-fullscreen' : ''}`}>
      <TimelineControls
        orientation={orientation}
        setOrientation={setOrientation}
        isFullscreen={isFullscreen}
        setIsFullscreen={setIsFullscreen}
        handleJumpDays={handleJumpDays}
        handleResetToToday={handleResetToToday}
        viewLabel={viewLabel}
        isFetching={isFetching}
      />

      <TimelineLegend
        orientation={orientation}
        hiddenCategories={hiddenCategories}
        toggleCategory={toggleCategory}
        hasLastFm={hasLastFm}
        legendCollapsed={legendCollapsed}
        setLegendCollapsed={setLegendCollapsed}
        legendRef={legendRef}
      />

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
