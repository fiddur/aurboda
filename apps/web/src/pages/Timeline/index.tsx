import { type TimelineDailyMetric, timelineDailyMetrics, type UserSettingsResponse } from '@aurboda/api-spec'
import { useSignalEffect } from '@preact/signals'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as d3 from 'd3'
import { endOfDay, format, parseISO, startOfDay } from 'date-fns'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'

import type { LegendCategory } from './legendCategories'
import type { ChartItem, Orientation } from './types'

import { updateUserSettings } from '../../state/api'
import { packLanes } from '../../utils/lanePacking'
import { CommentPanel, type CommentPanelState } from './CommentPanel'
import { COMMENTS_TRACK_HEIGHT, drawCommentsTrack } from './drawCommentsTrack'
import { drawDailyMetricTracks, layoutDailyTracks } from './drawDailyMetricTracks'
import { attachHoverHandlers, clampLabelLayout, drawItemIcon, getDetailUrl, truncateLabel } from './drawItems'
import { barAggregatedBuckets, drawMetricsLane } from './drawMetricsLane'
import { computeYScales, drawMetricsYAxes } from './drawMetricsTrack'
import {
  buildMusicTooltipHtml,
  drawMusicSessions,
  drawVerticalMusicSessions,
  getMergeGapMs,
  mergeScrobblesIntoSessions,
  MUSIC_STAFF_HEIGHT,
} from './drawMusicStaff'
import { drawColumnItems, drawHorizontalNowLine, drawNowLine } from './drawVerticalHelpers'
import { fetchWindowFromRange } from './fetchRange'
import { findOverlappingScrobbles } from './findOverlappingScrobbles'
import { formatTimelineTick } from './formatting'
import { isMultiDaySpan, type RangePreset } from './rangePreset'
import { TimelineContextMenu } from './TimelineContextMenu'
import { TimelineControls } from './TimelineControls'
import { TimelineLegend } from './TimelineLegend'
import { buildTooltipHtml } from './tooltipBuilder'
import { useTimelineContextMenu } from './useTimelineContextMenu'
import { useTimelineData } from './useTimelineData'
import { _initialHash, useTimelineNavigation } from './useTimelineNavigation'
import { HORIZONTAL_MARGIN, useTimelineZoom, VERTICAL_MARGIN } from './useTimelineZoom'
import { layoutVerticalTracks, verticalTrackSpecs } from './verticalLayout'
import { buildViewHash, getDefaultOrientation } from './viewHash'
import './style.css'

// eslint-disable-next-line complexity -- D3 visualization component
export const Timeline = () => {
  // Declared before the navigation hook so we can derive the time-axis pixel
  // dimension (#658 pixel-aware collapse depth) from the current orientation.
  const [orientation, setOrientation] = useState<Orientation>(
    () => _initialHash.orientation ?? getDefaultOrientation(),
  )

  const orientationRef = useRef(orientation)
  orientationRef.current = orientation

  // Lifted from the existing ResizeObserver below so the navigation hook can
  // compute pixels-per-hour for hierarchy collapse (#658). Initial 0 yields
  // depth=0 ("show everything distinct") until the first measurement lands.
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ h: 0, w: 0 })

  const timeAxisPixels = useMemo(() => {
    // The time axis is the chart's long dimension along which time flows:
    // chartHeight in vertical mode, chartWidth in horizontal. Subtract the
    // axis-padding margins that mirror useTimelineZoom's chart sizing so we
    // measure the actual zoomable region, not the full container.
    if (orientation === 'horizontal') {
      const inner = containerSize.w - HORIZONTAL_MARGIN.left - HORIZONTAL_MARGIN.right
      return Math.max(0, inner)
    }
    const inner = containerSize.h - VERTICAL_MARGIN.top - VERTICAL_MARGIN.bottom
    return Math.max(0, inner)
  }, [orientation, containerSize])

  const nav = useTimelineNavigation({ timeAxisPixels })
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
    handleStep,
    handlePreset,
    rangePreset,
    navigationSeq,
    handleResetToToday,
    viewLabel,
    bucketSize,
    barBucketSize,
    mergeGapMs,
    splitAbutting,
    collapseDepth,
  } = nav

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

  useEffect(() => {
    if (!isFullscreen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isFullscreen])

  const [hiddenCategories, setHiddenCategories] = useState<Set<LegendCategory>>(
    () => new Set(_initialHash.hide),
  )
  const hiddenCategoriesRef = useRef<Set<LegendCategory>>(hiddenCategories)
  hiddenCategoriesRef.current = hiddenCategories

  const dailyTracksShown =
    orientation === 'horizontal' && isMultiDaySpan(effectiveViewStart, effectiveViewEnd)

  const data = useTimelineData({
    barBucketSize,
    bucketSize,
    collapseDepth,
    dailyTracksShown,
    fetchEnd,
    fetchStart,
    fromDateKey: fromDate.value,
    hiddenCategories,
    mergeGapMs,
    splitAbutting,
    toDateKey: toDate.value,
    trainingLoadShown: orientation === 'horizontal',
  })
  const {
    activities,
    activityItems,
    chartItems,
    columnData,
    columns,
    commentNotes,
    dailyMetrics,
    dailySeries,
    metricBuckets,
    scrobbles,
    trainingLoadQuery,
    screentimeBucketedQuery,
    screentimeCategoriesQuery,
    screentimeSubEntries,
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

  const queryClient = useQueryClient()
  const dailyPickMutation = useMutation({
    mutationFn: (picked: TimelineDailyMetric[]) => updateUserSettings({ timeline_daily_metrics: picked }),
    onMutate: (picked) => {
      queryClient.setQueryData<UserSettingsResponse>(['userSettings'], (prev) =>
        prev ? { ...prev, timeline_daily_metrics: picked } : prev,
      )
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['userSettings'] }),
  })
  const toggleDailyMetric = useCallback(
    (metric: TimelineDailyMetric) => {
      const next = timelineDailyMetrics.filter((m) =>
        m === metric ? !dailyMetrics.includes(m) : dailyMetrics.includes(m),
      )
      dailyPickMutation.mutate(next)
    },
    [dailyMetrics, dailyPickMutation],
  )

  const handleRangePreset = useCallback(
    (preset: RangePreset) => {
      if (preset !== 'day') setOrientation('horizontal')
      handlePreset(preset)
    },
    [handlePreset],
  )

  const toggleCategory = useCallback((cat: LegendCategory) => {
    setHiddenCategories((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }, [])

  // `chartItems` has already dropped hidden categories, so an empty list means
  // either the track is toggled off or the window holds no comments — both of
  // which mean "reserve no lane for it".
  const [commentPanel, setCommentPanel] = useState<CommentPanelState | null>(null)

  const commentItems = useMemo(() => chartItems.filter((i) => i.column === 'Comments'), [chartItems])
  const showCommentsTrack = commentItems.length > 0

  const handleCommentClick = useCallback((item: ChartItem) => {
    const rootIds = item.comment_ids ?? (item.comment_id ? [item.comment_id] : [])
    if (rootIds.length === 0) return
    setCommentPanel({ kind: 'thread', rootIds })
  }, [])

  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const drawRef = useRef<((scale: d3.ScaleTime<number, number>) => void) | null>(null)
  const hAxisGroupRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null)
  const hYAxesGroupRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null)
  const hDailyLabelsGroupRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null)

  const scaffoldOrientationRef = useRef<Orientation | null>(null)
  const scaffoldDimsRef = useRef<{ w: number; h: number } | null>(null)
  const scaffoldLayoutKeyRef = useRef<string>('')
  /** Tracks the fetch range the base scale was built for. */
  const scaffoldFetchKeyRef = useRef<string>('')
  const scaffoldNavigationSeqRef = useRef<number>(navigationSeq)

  const todayKey = format(new Date(), 'yyyy-MM-dd')
  const baseScaleDomain = useMemo(
    () => [startOfDay(parseISO(todayKey)), endOfDay(parseISO(todayKey))] as [Date, Date],
    [todayKey],
  )

  const { currentScaleRef, attachZoom } = useTimelineZoom({
    containerRef,
    drawRef,
    onResetToToday: handleResetToToday,
    onZoomEnd: handleZoom,
    orientation,
    svgRef,
  })

  // Reads the live zoom scale from the ref, so the picked moment always matches
  // what the user is looking at.
  const contextMenu = useTimelineContextMenu({ containerRef, currentScaleRef, orientationRef })

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

  const showTooltipHtml = useCallback((event: MouseEvent, html: string) => {
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
  }, [])

  const showVerticalMusicTrack = scrobbles.length > 0 && !hiddenCategories.has('music')
  const showVerticalMetricsTrack = !hiddenCategories.has('metrics')
  const verticalSlots = useMemo(
    () =>
      layoutVerticalTracks(
        verticalTrackSpecs(columns, showVerticalMusicTrack, showVerticalMetricsTrack),
        Math.max(0, containerSize.w - VERTICAL_MARGIN.left - VERTICAL_MARGIN.right),
      ),
    [columns, showVerticalMusicTrack, showVerticalMetricsTrack, containerSize.w],
  )

  // Scaffold refs: SVG groups that persist across data changes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type SvgGroup = d3.Selection<any, unknown, null, undefined>
  const scaffoldGroupRef = useRef<SvgGroup | null>(null)
  const scaffoldChartGroupRef = useRef<SvgGroup | null>(null)

  // Resize counter — incremented by ResizeObserver to trigger the render effect.
  const [resizeKey, setResizeKey] = useState(0)

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
        // Lifted to state so the navigation hook can derive pixels-per-hour
        // for the #658 hierarchy collapse gate.
        setContainerSize({ h, w })
      })
    })
    const el = containerRef.current
    if (el) {
      // Seed the size synchronously on mount so the first render has a
      // real measurement instead of falling through to depth=0. Prime the
      // observer's lastW/lastH so the first ResizeObserver entry doesn't
      // re-fire setContainerSize with the same numbers (extra render).
      const rect = el.getBoundingClientRect()
      lastW = Math.round(rect.width)
      lastH = Math.round(rect.height)
      setContainerSize({ h: lastH, w: lastW })
      resizeObserver.observe(el)
    }
    return () => {
      cancelAnimationFrame(resizeRaf)
      resizeObserver.disconnect()
    }
  }, [])

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
        ? `${scrobbles.length > 0 && !hiddenCategories.has('music')}_${!hiddenCategories.has('activity')}_${!hiddenCategories.has('metrics')}_${!hiddenCategories.has('location')}_${showCommentsTrack}`
        : ''

    // The base scale domain must match the fetch range (horizontal) or today (vertical).
    // When the fetch range expands (user zooms past boundary) or contracts (reset to today),
    // the scaffold must rebuild so the D3 zoom transform stays in sync with the base scale.
    const fetchKey = `${fromDate.value}_${toDate.value}`

    const needsSetup =
      scaffoldOrientationRef.current !== orientation ||
      !dims ||
      dims.w !== containerWidth ||
      dims.h !== containerHeight ||
      scaffoldLayoutKeyRef.current !== layoutKey ||
      scaffoldFetchKeyRef.current !== fetchKey ||
      scaffoldNavigationSeqRef.current !== navigationSeq

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

        const commentsTrackHeight = showCommentsTrack ? COMMENTS_TRACK_HEIGHT : 0
        const musicTrackHeight = showMusicTrackS ? MUSIC_STAFF_HEIGHT : 0
        const locationTrackHeight = showLocationTrackS ? LOCATION_TRACK_HEIGHT : 0
        const remainingHeight = chartHeight - commentsTrackHeight - musicTrackHeight - locationTrackHeight
        const dynamicTrackCount = [showActivityTrackS, showMetricsTrackS].filter(Boolean).length
        const dynamicTrackHeight = dynamicTrackCount > 0 ? remainingHeight / dynamicTrackCount : 0
        const activityTrackHeightS = showActivityTrackS ? Math.max(40, dynamicTrackHeight) : 0
        const metricsTrackHeightS = showMetricsTrackS ? Math.max(40, dynamicTrackHeight) : 0

        let nextY = 0
        const trackCommentsS = nextY
        nextY += commentsTrackHeight
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

        const separatorYs: number[] = []
        if (showCommentsTrack && commentsTrackHeight > 0) separatorYs.push(commentsTrackHeight)
        if (showMusicTrackS && musicTrackHeight > 0) separatorYs.push(trackMusicS + musicTrackHeight)
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

        const laneLabels: { label: string; y: number; height: number }[] = [
          ...(showCommentsTrack
            ? [{ height: commentsTrackHeight, label: 'Comments', y: trackCommentsS }]
            : []),
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
          const text = outerG
            .append('text')
            .attr('fill', 'currentColor')
            .attr('font-size', '0.65rem')
            .attr('opacity', 0.5)
            .text(label)
          // The metrics lane's y-axis ticks share the gutter, so its label runs up the edge instead.
          if (label === 'Metrics') {
            text
              .attr('transform', `translate(${-margin.left + 4},${y + height / 2}) rotate(-90)`)
              .attr('text-anchor', 'middle')
              .attr('dy', '0.71em')
          } else {
            text
              .attr('x', -margin.left + 4)
              .attr('y', y + height / 2)
              .attr('dy', '0.35em')
          }
        }

        const xAxisGroup = outerG
          .append('g')
          .attr('class', 'h-x-axis')
          .attr('transform', `translate(0,${chartHeight})`)
        hAxisGroupRef.current = xAxisGroup

        const clipped = outerG.append('g').attr('clip-path', 'url(#h-chart-clip)')
        const chartGroup = clipped.append('g').attr('class', 'h-content')

        scaffoldGroupRef.current = outerG
        scaffoldChartGroupRef.current = chartGroup
        hYAxesGroupRef.current = outerG.append('g').attr('class', 'metrics-y-axes')
        hDailyLabelsGroupRef.current = outerG.append('g').attr('class', 'daily-metric-labels')

        const hFetch = fetchWindowFromRange({ from: fromDate.value, to: toDate.value })
        const baseScale = d3.scaleTime().domain([hFetch.start, hFetch.end]).range([0, chartWidth])
        attachZoom(baseScale, effectiveViewStart, effectiveViewEnd, chartWidth)
      }

      scaffoldOrientationRef.current = orientation
      scaffoldDimsRef.current = { w: containerWidth, h: containerHeight }
      scaffoldLayoutKeyRef.current = layoutKey
      scaffoldFetchKeyRef.current = fetchKey
      scaffoldNavigationSeqRef.current = navigationSeq
    }

    const chartGroup = scaffoldChartGroupRef.current
    const g = scaffoldGroupRef.current
    if (!chartGroup || !g) return

    if (orientation === 'vertical') {
      const margin = VERTICAL_MARGIN
      const chartWidth = containerWidth - margin.left - margin.right
      const chartHeight = Math.max(200, containerHeight - margin.top - margin.bottom)
      const colGap = 4
      const colPadding = 2

      const slots = layoutVerticalTracks(
        verticalTrackSpecs(columns, showVerticalMusicTrack, showVerticalMetricsTrack),
        chartWidth,
      )
      const slotOf = (id: string) => slots.find((slot) => slot.id === id)
      const musicSlot = slotOf('Music')
      const metricsSlot = slotOf('Metrics')
      const metricsTrackWidth = metricsSlot ? Math.max(0, metricsSlot.width - colGap * 2) : 0
      const metricsTrackRight = metricsSlot ? metricsSlot.x + metricsSlot.width - colGap : 0
      const metricsYScales =
        metricsSlot && metricBuckets.length > 0
          ? computeYScales(
              metricBuckets,
              0,
              metricsTrackWidth,
              barAggregatedBuckets(metricBuckets, barBucketSize),
            )
          : null

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

        for (const slot of slots.slice(1)) {
          chartGroup
            .append('line')
            .attr('x1', slot.x)
            .attr('x2', slot.x)
            .attr('y1', currentYScale.range()[0]!)
            .attr('y2', currentYScale.range()[1]!)
            .attr('stroke', 'currentColor')
            .attr('stroke-opacity', 0.08)
        }

        if (metricsSlot) {
          // rotate(90) maps lane (x, y) to screen (-y, x): time runs down, and with the
          // origin at the track's right edge, larger values land further right.
          const lane = chartGroup
            .append('g')
            .attr('class', 'metrics-lane-vertical')
            .attr('transform', `translate(${metricsTrackRight},0) rotate(90)`)
          drawMetricsLane({
            barBucketSize,
            chartGroup: lane,
            chartWidth: chartHeight,
            domainEndMs: domainEnd.getTime(),
            domainStartMs: domainStart.getTime(),
            hidden: hiddenCategories,
            hideTooltip,
            metricBuckets,
            outerG: lane,
            pixelsPerHour,
            screentimeBuckets: screentimeBucketedQuery.data ?? [],
            screentimeCategories: screentimeCategoriesQuery.data ?? [],
            showTooltipHtml,
            trackHeight: metricsTrackWidth,
            trackY: 0,
            trainingLoad: null,
            xScale: currentYScale,
            yScales: metricsYScales,
          })
        }

        drawColumnItems(
          chartGroup,
          columnData,
          slotOf,
          colGap,
          colPadding,
          currentYScale,
          showTooltip,
          hideTooltip,
          handleCommentClick,
        )

        if (musicSlot) {
          const domainStartMs = domainStart.getTime()
          const domainEndMs = domainEnd.getTime()
          const sessions = mergeScrobblesIntoSessions(scrobbles, getMergeGapMs(pixelsPerHour)).filter(
            (session) => session.end.getTime() >= domainStartMs && session.start.getTime() <= domainEndMs,
          )
          drawVerticalMusicSessions(
            chartGroup,
            sessions,
            currentYScale,
            musicSlot.x + colGap,
            Math.max(2, musicSlot.width - colGap * 2),
            showMusicTooltip,
            hideTooltip,
          )
        }

        drawNowLine(chartGroup, chartWidth, currentYScale)
      }
    } else {
      const margin = HORIZONTAL_MARGIN
      const chartWidth = containerWidth - margin.left - margin.right
      const chartHeight = Math.max(150, containerHeight - margin.top - margin.bottom)

      const LOCATION_TRACK_HEIGHT = 34
      const ICON_SIZE = 18

      const showMusicTrack = scrobbles.length > 0 && !hiddenCategories.has('music')
      const showActivityTrack = !hiddenCategories.has('activity')
      const showMetricsTrackH = !hiddenCategories.has('metrics')
      const showLocationTrack = !hiddenCategories.has('location')

      const commentsTrackHeight = showCommentsTrack ? COMMENTS_TRACK_HEIGHT : 0
      const musicTrackHeight = showMusicTrack ? MUSIC_STAFF_HEIGHT : 0
      const locationTrackHeight = showLocationTrack ? LOCATION_TRACK_HEIGHT : 0
      const remainingHeight = chartHeight - commentsTrackHeight - musicTrackHeight - locationTrackHeight
      const dynamicTrackCount = [showActivityTrack, showMetricsTrackH].filter(Boolean).length
      const dynamicTrackHeight = dynamicTrackCount > 0 ? remainingHeight / dynamicTrackCount : 0
      const activityTrackHeight = showActivityTrack ? Math.max(40, dynamicTrackHeight) : 0
      const metricsTrackHeight = showMetricsTrackH ? Math.max(40, dynamicTrackHeight) : 0

      let nextY = 0
      const trackComments = nextY
      nextY += commentsTrackHeight
      const trackMusic = nextY
      nextY += musicTrackHeight
      const trackActivity = nextY
      nextY += activityTrackHeight
      const trackMetrics = nextY
      nextY += metricsTrackHeight
      const trackPlaces = nextY

      const trainingLoadData = trainingLoadQuery.data ?? null

      const dailyLayout = layoutDailyTracks(trackMetrics, metricsTrackHeight, dailySeries.length)
      const metricsMainHeight = dailyLayout.mainHeight
      const metricsTrackBottom = trackMetrics + metricsMainHeight
      const metricsYScales =
        metricBuckets.length > 0
          ? computeYScales(
              metricBuckets,
              trackMetrics,
              metricsTrackBottom,
              barAggregatedBuckets(metricBuckets, barBucketSize),
            )
          : null

      // Redrawn on every data change rather than in the scaffold: the HRV axis follows the data,
      // and the scaffold is usually built before the metrics arrive.
      if (hYAxesGroupRef.current) {
        drawMetricsYAxes(hYAxesGroupRef.current, showMetricsTrackH ? metricsYScales : null, chartWidth)
      }

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

        if (showCommentsTrack) {
          drawCommentsTrack({
            chartGroup,
            hideTooltip,
            items: commentItems.filter(isInViewport),
            onItemClick: handleCommentClick,
            showTooltip,
            trackY: trackComments,
            xScale: currentXScale,
          })
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
            const { x: labelX, width: labelWidth } = clampLabelLayout(rx, rw, 4)
            parent
              .append('text')
              .attr('x', labelX)
              .attr('y', laneY + Math.min(laneH * 0.6, 14))
              .attr('fill', 'white')
              .attr('font-size', '0.65rem')
              .attr('pointer-events', 'none')
              .text(truncateLabel(item.label, labelWidth))
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
            const { x: labelX, width: labelWidth } = clampLabelLayout(px, pw, 4)
            parent
              .append('text')
              .attr('x', labelX)
              .attr('y', trackPlaces + LOCATION_TRACK_HEIGHT / 2)
              .attr('dy', '0.35em')
              .attr('fill', 'white')
              .attr('font-size', '0.6rem')
              .attr('pointer-events', 'none')
              .text(truncateLabel(place.label, labelWidth))
          }
        }

        if (showMetricsTrackH) {
          drawMetricsLane({
            barBucketSize,
            chartGroup,
            chartWidth,
            domainEndMs,
            domainStartMs,
            hidden: hiddenCategories,
            hideTooltip,
            metricBuckets,
            outerG,
            pixelsPerHour,
            screentimeBuckets: screentimeBucketedQuery.data ?? [],
            screentimeCategories: screentimeCategoriesQuery.data ?? [],
            showTooltipHtml,
            trackHeight: metricsMainHeight,
            trackY: trackMetrics,
            trainingLoad: trainingLoadData,
            xScale: currentXScale,
            yScales: metricsYScales,
          })
        }

        if (hDailyLabelsGroupRef.current) {
          drawDailyMetricTracks({
            chartGroup,
            chartWidth,
            hideTooltip,
            labelGroup: hDailyLabelsGroupRef.current,
            labelX: -margin.left + 4,
            rows: showMetricsTrackH ? dailyLayout.rows : [],
            series: showMetricsTrackH ? dailySeries : [],
            showTooltipHtml,
            xScale: currentXScale,
          })
        }

        drawHorizontalNowLine(chartGroup, chartHeight, currentXScale)

        ag.call(
          d3
            .axisBottom(currentXScale)
            .ticks(8)
            .tickFormat((d) => formatTimelineTick(d as Date)) as never,
        )
          .selectAll('text')
          .style('fill', 'currentColor')
      }
    }

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
    commentItems,
    showCommentsTrack,
    handleCommentClick,
    effectiveViewEnd,
    effectiveViewStart,
    hiddenCategories,
    metricBuckets,
    scrobbles,
    activityItems,
    showTooltip,
    hideTooltip,
    showMusicTooltip,
    showTooltipHtml,
    showVerticalMusicTrack,
    showVerticalMetricsTrack,
    trainingLoadQuery.data,
    screentimeBucketedQuery.data,
    screentimeCategoriesQuery.data,
    barBucketSize,
    attachZoom,
    dailySeries,
    navigationSeq,
  ])

  return (
    <div class={`timeline-view${isFullscreen ? ' timeline-fullscreen' : ''}`}>
      <TimelineControls
        orientation={orientation}
        setOrientation={setOrientation}
        isFullscreen={isFullscreen}
        setIsFullscreen={setIsFullscreen}
        handleJumpDays={handleJumpDays}
        handleStep={handleStep}
        rangePreset={rangePreset}
        onPreset={handleRangePreset}
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
        screentimeSubEntries={screentimeSubEntries}
        dailyPicker={{
          options: timelineDailyMetrics,
          picked: dailyMetrics,
          shown: dailyTracksShown,
          toggle: toggleDailyMetric,
        }}
      />

      {errorSources.length > 0 && (
        <div class="error">Failed to load {errorSources.join(', ')} — showing available data</div>
      )}

      {orientation === 'vertical' && !isInitialLoad && (
        <div class="timeline-column-headers" style={{ paddingLeft: `${VERTICAL_MARGIN.left}px` }}>
          {verticalSlots.map((slot) => (
            <div
              key={slot.id}
              class="timeline-column-header"
              style={{ flex: `0 0 ${slot.width}px`, width: `${slot.width}px` }}
              title={slot.id}
            >
              {slot.id === 'Music' ? '♪' : slot.id}
            </div>
          ))}
        </div>
      )}

      <div
        class="timeline-chart-container"
        ref={containerRef}
        onContextMenu={contextMenu.onContextMenu}
        onPointerDown={(e) => {
          hideTooltip()
          contextMenu.onPointerDown(e)
        }}
        onPointerMove={contextMenu.onPointerMove}
        onPointerUp={contextMenu.cancelLongPress}
        onPointerCancel={contextMenu.cancelLongPress}
        onPointerLeave={contextMenu.cancelLongPress}
      >
        <svg ref={svgRef} />
        {isInitialLoad && <div class="timeline-chart-loading">Loading…</div>}
        <div class="timeline-tooltip" ref={tooltipRef} style={{ display: 'none' }} />
        {contextMenu.menu && (
          <TimelineContextMenu
            x={contextMenu.menu.x}
            y={contextMenu.menu.y}
            at={contextMenu.menu.at}
            onAddComment={(at) => setCommentPanel({ at, kind: 'new' })}
            onClose={contextMenu.close}
          />
        )}
      </div>

      {commentPanel && (
        <CommentPanel state={commentPanel} roots={commentNotes} onClose={() => setCommentPanel(null)} />
      )}

      <p class="timeline-help">Scroll to zoom · Drag to pan · Double-click to reset</p>
    </div>
  )
}
