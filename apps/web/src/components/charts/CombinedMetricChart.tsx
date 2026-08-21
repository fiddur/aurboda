/**
 * D3-based combined multi-metric chart with toggleable overlays — the
 * presentational half of the activity detail chart, extracted (#1011) so the
 * feed's native post cards render the *same* chart from a structured payload's
 * inline series.
 *
 * Supports:
 * - Sleep hypnogram (colored bands by sleep stage)
 * - Line overlays for dense data, diamond dots for sparse data
 * - Per-metric toggle buttons with axis allocation (most recent toggles get axes)
 * - Hover tooltip with crosshair, surfaced via `onHoverTime` (drives the map)
 *
 * Data comes in via `series` — the caller owns fetching/derivation (the detail
 * page buckets the DB; a feed card maps the structured payload's samples).
 */
import { metricUnits as builtinMetricUnits } from '@aurboda/api-spec'
import * as d3 from 'd3'
import { format } from 'date-fns'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'

import {
  chartRightMargin,
  countRightAxes,
  findNearest,
  findStageAtTime,
  MAX_RIGHT_AXES,
} from './chart-utils'
import { STAGE_COLORS, STAGE_LABELS, STAGE_Y_ORDER, type SleepStage } from './sleep-utils'
import './CombinedMetricChart.css'

/** One drawable series: a metric key plus its `[time, value]` points. */
export interface CombinedChartSeries {
  metric: string
  data: [Date, number][]
  /** Display unit; falls back to the built-in unit for the metric. */
  unit?: string
}

interface CombinedMetricChartProps {
  series: CombinedChartSeries[]
  start: Date
  end: Date
  stages?: SleepStage[]
  defaultMetrics?: string[]
  /** Show the loading hint in the toggle row (the caller is still fetching). */
  loading?: boolean
  onHoverTime?: (time: Date | null) => void
  /** Notified with the metrics currently shown on the chart (for the share dialog). */
  onEnabledMetricsChange?: (metrics: string[]) => void
}

const CHART_HEIGHT = 260
/**
 * Exported so callers sizing their fetch to the drawable width use the same
 * margins. `right` is the MAXIMUM (two right axes drawn); the rendered chart
 * reclaims unused axis space via `chartRightMargin`, so a fetch sized with
 * this is at worst slightly coarser than the drawn width, never too fine.
 */
export const CHART_MARGIN = { bottom: 30, left: 50, right: chartRightMargin(MAX_RIGHT_AXES), top: 10 }
const SPARSE_THRESHOLD = 10

/** Hypnogram Y-axis labels in display order (top to bottom). */
const HYPNOGRAM_LABELS = ['Awake', 'REM', 'Light', 'Deep']
const HYPNOGRAM_Y_VALUES = [0, 1, 2, 3]

type GSelection = d3.Selection<SVGGElement, unknown, null, undefined>
type TimeSeries = [Date, number][]

/** Predefined color palette — well-known metrics get stable colors, rest cycle through. */
const KNOWN_METRIC_COLORS: Record<string, string> = {
  body_battery: '#a855f7',
  heart_rate: '#ef4444',
  hrv_rmssd: '#14b8a6',
  respiratory_rate: '#6366f1',
  spo2: '#0ea5e9',
  stress_level: '#f97316',
}
const FALLBACK_COLORS = [
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#84cc16',
  '#f43f5e',
  '#0891b2',
  '#d946ef',
  '#eab308',
]

const getMetricColor = (metric: string, fallbackIndex: number): string =>
  KNOWN_METRIC_COLORS[metric] ?? FALLBACK_COLORS[fallbackIndex % FALLBACK_COLORS.length]!

/** Format snake_case metric name to Title Case label. */
const formatMetricLabel = (metric: string): string =>
  metric.replaceAll('_', ' ').replaceAll(/\b\w/g, (c) => c.toUpperCase())

const getMetricUnit = (metric: string): string => (builtinMetricUnits as Record<string, string>)[metric] ?? ''

const drawHypnogram = (
  g: GSelection,
  xScale: d3.ScaleTime<number, number>,
  innerWidth: number,
  innerHeight: number,
  stages: SleepStage[],
) => {
  const yScale = d3.scaleLinear().domain([-0.5, 3.5]).range([0, innerHeight])

  const yAxis = g.append('g')
  for (let i = 0; i < HYPNOGRAM_LABELS.length; i++) {
    yAxis
      .append('text')
      .attr('x', -8)
      .attr('y', yScale(HYPNOGRAM_Y_VALUES[i]!))
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .attr('fill', 'currentColor')
      .attr('font-size', '0.7rem')
      .attr('opacity', 0.6)
      .text(HYPNOGRAM_LABELS[i]!)
  }

  for (const yVal of HYPNOGRAM_Y_VALUES) {
    g.append('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', yScale(yVal))
      .attr('y2', yScale(yVal))
      .attr('stroke', 'currentColor')
      .attr('stroke-opacity', 0.1)
  }

  const bandHeight = innerHeight / 4
  for (const stage of stages) {
    const sx = xScale(new Date(stage.startTime))
    const ex = xScale(new Date(stage.endTime))
    const yVal = STAGE_Y_ORDER[stage.stage] ?? 0

    g.append('rect')
      .attr('x', sx)
      .attr('y', yScale(yVal) - bandHeight / 2)
      .attr('width', Math.max(ex - sx, 1))
      .attr('height', bandHeight)
      .attr('fill', STAGE_COLORS[stage.stage] ?? '#9ca3af')
      .attr('opacity', 0.7)
      .append('title')
      .text(
        `${STAGE_LABELS[stage.stage] ?? 'Unknown'}: ${format(new Date(stage.startTime), 'HH:mm')} – ${format(new Date(stage.endTime), 'HH:mm')}`,
      )
  }
}

const drawLineOverlay = (
  g: GSelection,
  xScale: d3.ScaleTime<number, number>,
  innerWidth: number,
  innerHeight: number,
  data: TimeSeries,
  color: string,
  unit: string,
  axisSide: 'left' | 'right',
  axisOffset: number = 0,
  showAxis: boolean = true,
) => {
  const yExtent = d3.extent(data, (d) => d[1]) as [number, number]
  const padding = (yExtent[1] - yExtent[0]) * 0.1 || 5
  const yMin = yExtent[0] >= 0 ? Math.max(0, yExtent[0] - padding) : yExtent[0] - padding
  const yScale = d3
    .scaleLinear()
    .domain([yMin, yExtent[1] + padding])
    .range([innerHeight, 0])

  if (showAxis) {
    if (axisSide === 'right') {
      g.append('g')
        .attr('transform', `translate(${innerWidth + axisOffset},0)`)
        .call(d3.axisRight(yScale).ticks(4))
        .selectAll('text')
        .attr('fill', color)
        .attr('font-size', '0.7rem')

      g.append('text')
        .attr('x', innerWidth + axisOffset + 35)
        .attr('y', -2)
        .attr('text-anchor', 'end')
        .attr('fill', color)
        .attr('font-size', '0.65rem')
        .text(unit)
    } else {
      g.append('g')
        .call(d3.axisLeft(yScale).ticks(4))
        .selectAll('text')
        .attr('fill', color)
        .attr('font-size', '0.7rem')
    }
  }

  const line = d3
    .line<[Date, number]>()
    .x((d) => xScale(d[0]))
    .y((d) => yScale(d[1]))
    .curve(d3.curveMonotoneX)

  g.append('path')
    .datum(data)
    .attr('fill', 'none')
    .attr('stroke', color)
    .attr('stroke-width', 1.5)
    .attr('stroke-opacity', 0.8)
    .attr('d', line)
}

/** Draw sparse data as diamond markers instead of a line. */
const drawDotOverlay = (
  g: GSelection,
  xScale: d3.ScaleTime<number, number>,
  innerWidth: number,
  innerHeight: number,
  data: TimeSeries,
  color: string,
  unit: string,
  axisSide: 'left' | 'right',
  axisOffset: number = 0,
  showAxis: boolean = true,
) => {
  const yExtent = d3.extent(data, (d) => d[1]) as [number, number]
  const padding = (yExtent[1] - yExtent[0]) * 0.1 || 5
  const yMin = yExtent[0] >= 0 ? Math.max(0, yExtent[0] - padding) : yExtent[0] - padding
  const yScale = d3
    .scaleLinear()
    .domain([yMin, yExtent[1] + padding])
    .range([innerHeight, 0])

  if (showAxis) {
    if (axisSide === 'right') {
      g.append('g')
        .attr('transform', `translate(${innerWidth + axisOffset},0)`)
        .call(d3.axisRight(yScale).ticks(4))
        .selectAll('text')
        .attr('fill', color)
        .attr('font-size', '0.7rem')

      g.append('text')
        .attr('x', innerWidth + axisOffset + 35)
        .attr('y', -2)
        .attr('text-anchor', 'end')
        .attr('fill', color)
        .attr('font-size', '0.65rem')
        .text(unit)
    } else {
      g.append('g')
        .call(d3.axisLeft(yScale).ticks(4))
        .selectAll('text')
        .attr('fill', color)
        .attr('font-size', '0.7rem')
    }
  }

  const diamond = d3.symbol().type(d3.symbolDiamond).size(40)

  for (const [time, value] of data) {
    g.append('path')
      .attr('d', diamond)
      .attr('transform', `translate(${xScale(time)},${yScale(value)})`)
      .attr('fill', color)
      .attr('fill-opacity', 0.9)
      .attr('stroke', color)
      .attr('stroke-width', 0.5)
  }
}

interface MetricOverlay {
  metric: string
  data: TimeSeries
  color: string
  unit: string
  showAxis: boolean
}

/** Draw all dynamic metric overlays with axis allocation. */
const drawOverlays = (
  g: GSelection,
  xScale: d3.ScaleTime<number, number>,
  innerWidth: number,
  innerHeight: number,
  hasHypnogram: boolean,
  overlays: MetricOverlay[],
) => {
  let rightAxisCount = 0
  let leftUsed = false

  for (const overlay of overlays) {
    const axisSide = leftUsed || hasHypnogram ? 'right' : 'left'
    const showAxis = overlay.showAxis && (axisSide === 'left' || rightAxisCount < MAX_RIGHT_AXES)
    const offset = axisSide === 'right' ? rightAxisCount * 45 : 0

    const drawFn = overlay.data.length < SPARSE_THRESHOLD ? drawDotOverlay : drawLineOverlay
    drawFn(
      g,
      xScale,
      innerWidth,
      innerHeight,
      overlay.data,
      overlay.color,
      overlay.unit,
      axisSide,
      offset,
      showAxis,
    )

    if (axisSide === 'left') leftUsed = true
    if (axisSide === 'right' && showAxis) rightAxisCount++
  }
}

/** Build tooltip text lines for the crosshair position. */
const buildTooltipLines = (
  time: Date,
  overlays: MetricOverlay[],
  stages: SleepStage[] | undefined,
): string[] => {
  const lines: string[] = [format(time, 'HH:mm:ss')]

  for (const overlay of overlays) {
    const nearest = findNearest(overlay.data, time)
    if (nearest) {
      const label = formatMetricLabel(overlay.metric)
      const unit = overlay.unit ? ` ${overlay.unit}` : ''
      lines.push(`${label}: ${Math.round(nearest[1] * 10) / 10}${unit}`)
    }
  }

  if (stages) {
    const stage = findStageAtTime(stages, time)
    if (stage) lines.push(`Stage: ${stage}`)
  }

  return lines
}

/** Render the full D3 chart (overlays + tooltip). Called from useEffect. */
const renderChart = ({
  containerRef,
  hasHypnogram,
  overlays,
  stages,
  start,
  end,
  svgRef,
  tooltipRef,
  onHoverTimeRef,
}: {
  containerRef: { current: HTMLDivElement | null }
  hasHypnogram: boolean
  overlays: MetricOverlay[]
  stages: SleepStage[] | undefined
  start: Date
  end: Date
  svgRef: { current: SVGSVGElement | null }
  tooltipRef: { current: HTMLDivElement | null }
  onHoverTimeRef: { current: ((time: Date | null) => void) | undefined }
}) => {
  if (!svgRef.current || !containerRef.current) return

  const containerWidth = containerRef.current.clientWidth
  const svg = d3.select(svgRef.current)
  svg.selectAll('*').remove()

  // Reserve right margin only for the right axes actually drawn — a fixed
  // maximum squeezed the plot to half a phone card's width in the common
  // single-metric case.
  const marginRight = chartRightMargin(countRightAxes(!!hasHypnogram, overlays))
  const innerWidth = containerWidth - CHART_MARGIN.left - marginRight
  const innerHeight = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom

  svg.attr('width', containerWidth).attr('height', CHART_HEIGHT)

  const g = svg.append('g').attr('transform', `translate(${CHART_MARGIN.left},${CHART_MARGIN.top})`)

  const xScale = d3.scaleTime().domain([start, end]).range([0, innerWidth])

  g.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(
      d3
        .axisBottom(xScale)
        // A "HH:mm" tick needs ~60px to stay legible; d3 treats this as a
        // hint, so clamp instead of letting a narrow phone card overlap them.
        .ticks(Math.max(3, Math.min(6, Math.floor(innerWidth / 60))))
        .tickFormat((d) => format(d as Date, 'HH:mm')),
    )
    .selectAll('text')
    .attr('fill', 'currentColor')

  if (hasHypnogram && stages) {
    drawHypnogram(g, xScale, innerWidth, innerHeight, stages)
  }

  drawOverlays(g, xScale, innerWidth, innerHeight, !!hasHypnogram, overlays)

  // Tooltip crosshair and interaction overlay
  const crosshair = g
    .append('line')
    .attr('y1', 0)
    .attr('y2', innerHeight)
    .attr('stroke', 'currentColor')
    .attr('stroke-opacity', 0.4)
    .attr('stroke-dasharray', '4 3')
    .attr('pointer-events', 'none')
    .style('display', 'none')

  const tooltip = tooltipRef.current

  g.append('rect')
    .attr('width', innerWidth)
    .attr('height', innerHeight)
    .attr('fill', 'transparent')
    .attr('pointer-events', 'all')
    .on('mousemove', (event: MouseEvent) => {
      const [mx] = d3.pointer(event)
      const time = xScale.invert(mx)
      onHoverTimeRef.current?.(time)

      crosshair.attr('x1', mx).attr('x2', mx).style('display', null)

      const lines = buildTooltipLines(time, overlays, hasHypnogram ? stages : undefined)

      if (tooltip) {
        tooltip.textContent = lines.join('\n')
        tooltip.style.display = 'block'

        const containerRect = containerRef.current!.getBoundingClientRect()
        const svgRect = svgRef.current!.getBoundingClientRect()
        const tooltipX = mx + CHART_MARGIN.left + (svgRect.left - containerRect.left)
        const tooltipWidth = tooltip.offsetWidth
        const availableWidth = containerRect.width

        const left =
          tooltipX + tooltipWidth + 12 > availableWidth ? tooltipX - tooltipWidth - 12 : tooltipX + 12
        tooltip.style.left = `${left}px`
        tooltip.style.top = `${CHART_MARGIN.top + 8}px`
      }
    })
    .on('mouseleave', () => {
      crosshair.style('display', 'none')
      if (tooltip) tooltip.style.display = 'none'
      onHoverTimeRef.current?.(null)
    })
}

const ChartToggle = ({
  color,
  label,
  active,
  onToggle,
}: {
  color: string
  label: string
  active: boolean
  onToggle: () => void
}) => (
  <button class={`chart-toggle${active ? ' active' : ''}`} onClick={onToggle} type="button">
    <span class="chart-toggle-dot" style={{ background: color }} />
    {label}
  </button>
)

const hasData = (data: TimeSeries | undefined): data is TimeSeries => data !== undefined && data.length > 0

export const CombinedMetricChart = ({
  series,
  start,
  end,
  stages,
  defaultMetrics = [],
  loading = false,
  onHoverTime,
  onEnabledMetricsChange,
}: CombinedMetricChartProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const onHoverTimeRef = useRef(onHoverTime)

  onHoverTimeRef.current = onHoverTime

  // Re-render on container resize (no refetch involved — purely a redraw).
  const [containerWidth, setContainerWidth] = useState(0)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => setContainerWidth(el.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const availableMetrics = series.map((s) => s.metric)

  // Enable all metrics by default; track which ones the user has toggled off
  const [disabledMetrics, setDisabledMetrics] = useState<Set<string>>(new Set())
  // Track toggle order for axis priority (most recent gets axis)
  const [toggleOrder, setToggleOrder] = useState<string[]>([])

  // When available metrics first load, initialize toggle order with defaultMetrics first, then rest
  const defaultsAppliedRef = useRef(false)
  useEffect(() => {
    if (availableMetrics.length > 0 && !defaultsAppliedRef.current) {
      defaultsAppliedRef.current = true
      const defaults = defaultMetrics.filter((m) => availableMetrics.includes(m))
      const rest = availableMetrics.filter((m) => !defaults.includes(m))
      setToggleOrder([...rest, ...defaults])
    }
  }, [availableMetrics, defaultMetrics])

  const toggleMetric = useCallback((metric: string) => {
    setDisabledMetrics((prev) => {
      const next = new Set(prev)
      if (next.has(metric)) {
        next.delete(metric)
      } else {
        next.add(metric)
      }
      return next
    })
    setToggleOrder((prev) => {
      const filtered = prev.filter((m) => m !== metric)
      return [...filtered, metric]
    })
  }, [])

  const enabledMetrics = new Set(availableMetrics.filter((m) => !disabledMetrics.has(m)))

  // Surface the currently-shown metrics so a parent (the share dialog) can mirror
  // the user's chart selection. Keyed on the enabled set's *contents* (a stable
  // string) — NOT the `availableMetrics`/`disabledMetrics` refs: `availableMetrics`
  // is a fresh array every render, which would loop. Metric names never contain
  // `|`, so the key round-trips cleanly.
  const enabledKey = [...enabledMetrics].join('|')
  useEffect(() => {
    onEnabledMetricsChange?.(enabledKey ? enabledKey.split('|') : [])
  }, [enabledKey, onEnabledMetricsChange])

  // Stable colour per metric: well-known ones fixed, the rest cycling in series order.
  const colorByMetric = useMemo(() => {
    const map = new Map<string, string>()
    let fallbackIdx = 0
    for (const s of series) {
      map.set(s.metric, KNOWN_METRIC_COLORS[s.metric] ?? getMetricColor(s.metric, fallbackIdx++))
    }
    return map
  }, [series])

  // Memoised on their actual inputs so the render effect below only re-runs when
  // the drawn content changes — NOT on every parent re-render. The chart's own
  // crosshair/tooltip are drawn by the mousemove handler, and `onHoverTime`
  // re-renders the parent per mousemove, so a fresh `overlays` identity here
  // would wipe the crosshair right after every draw (#1014).
  const overlays = useMemo(() => {
    const enabled = new Set(series.map((s) => s.metric).filter((m) => !disabledMetrics.has(m)))
    // Which metrics get axes: the last MAX_RIGHT_AXES enabled in toggle order.
    const withAxes = new Set(toggleOrder.filter((m) => enabled.has(m)).slice(-MAX_RIGHT_AXES))
    const built: MetricOverlay[] = []
    for (const s of series) {
      if (!enabled.has(s.metric)) continue
      if (!hasData(s.data)) continue
      built.push({
        color: colorByMetric.get(s.metric) ?? FALLBACK_COLORS[0]!,
        data: s.data,
        metric: s.metric,
        showAxis: withAxes.has(s.metric),
        unit: s.unit ?? getMetricUnit(s.metric),
      })
    }
    return built
  }, [series, disabledMetrics, toggleOrder, colorByMetric])

  const hasHypnogram = stages && stages.length > 0

  // Key the window on its epoch values: a parent that re-creates `start`/`end`
  // Date objects each render (common) must not force a redraw.
  const startMs = start.getTime()
  const endMs = end.getTime()
  useEffect(
    () =>
      renderChart({
        containerRef,
        hasHypnogram: !!hasHypnogram,
        overlays,
        stages,
        start: new Date(startMs),
        end: new Date(endMs),
        svgRef,
        tooltipRef,
        onHoverTimeRef,
      }),
    [startMs, endMs, stages, hasHypnogram, overlays, containerWidth],
  )

  return (
    <div class="activity-chart-container">
      <div class="chart-toggles">
        {loading && <span class="chart-toggle-loading">Loading metrics...</span>}
        {series.map((s) => (
          <ChartToggle
            key={s.metric}
            color={colorByMetric.get(s.metric) ?? FALLBACK_COLORS[0]!}
            label={formatMetricLabel(s.metric)}
            active={enabledMetrics.has(s.metric)}
            onToggle={() => toggleMetric(s.metric)}
          />
        ))}
      </div>
      <div class="chart-svg-container" ref={containerRef}>
        <svg ref={svgRef} />
        <div class="chart-tooltip" ref={tooltipRef} />
      </div>
    </div>
  )
}
