/**
 * D3-based activity chart with dynamic, toggleable metric overlays.
 *
 * Supports:
 * - Sleep hypnogram (colored bands by sleep stage)
 * - Auto-discovery of all metrics recorded in the time range
 * - Line overlays for dense data, diamond dots for sparse data
 * - Hover tooltip with crosshair
 */
import { metricUnits as builtinMetricUnits } from '@aurboda/api-spec'
import { useQuery } from '@tanstack/react-query'
import * as d3 from 'd3'
import { format } from 'date-fns'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

import { fetchBucketedMetrics } from '../../state/api'
import { findNearest, findStageAtTime } from './chart-utils'
import { STAGE_COLORS, STAGE_LABELS, STAGE_Y_ORDER, type SleepStage } from './sleep-utils'

interface ActivityChartProps {
  start: Date
  end: Date
  stages?: SleepStage[]
  defaultMetrics?: string[]
}

const CHART_HEIGHT = 260
const MARGIN = { bottom: 30, left: 50, right: 155, top: 10 }
const MAX_RIGHT_AXES = 2
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

/** Metrics to exclude from the activity chart (cumulative/computed, not useful as overlays). */
const EXCLUDED_METRICS = new Set([
  'calories_active',
  'calories_basal',
  'calories_total',
  'distance',
  'floors_climbed',
  'hr_zone_0_sec',
  'hr_zone_1_sec',
  'hr_zone_2_sec',
  'hr_zone_3_sec',
  'hr_zone_4_sec',
  'hr_zone_5_sec',
  'intensity_minutes',
  'steps',
  'training_impulse',
  'activity_impulse',
])

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

const hasData = (data: TimeSeries | undefined): data is TimeSeries => data !== undefined && data.length > 0

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
}: {
  containerRef: { current: HTMLDivElement | null }
  hasHypnogram: boolean
  overlays: MetricOverlay[]
  stages: SleepStage[] | undefined
  start: Date
  end: Date
  svgRef: { current: SVGSVGElement | null }
  tooltipRef: { current: HTMLDivElement | null }
}) => {
  if (!svgRef.current || !containerRef.current) return

  const containerWidth = containerRef.current.clientWidth
  const svg = d3.select(svgRef.current)
  svg.selectAll('*').remove()

  const innerWidth = containerWidth - MARGIN.left - MARGIN.right
  const innerHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom

  svg.attr('width', containerWidth).attr('height', CHART_HEIGHT)

  const g = svg.append('g').attr('transform', `translate(${MARGIN.left},${MARGIN.top})`)

  const xScale = d3.scaleTime().domain([start, end]).range([0, innerWidth])

  g.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(
      d3
        .axisBottom(xScale)
        .ticks(6)
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

      crosshair.attr('x1', mx).attr('x2', mx).style('display', null)

      const lines = buildTooltipLines(time, overlays, hasHypnogram ? stages : undefined)

      if (tooltip) {
        tooltip.textContent = lines.join('\n')
        tooltip.style.display = 'block'

        const containerRect = containerRef.current!.getBoundingClientRect()
        const svgRect = svgRef.current!.getBoundingClientRect()
        const tooltipX = mx + MARGIN.left + (svgRect.left - containerRect.left)
        const tooltipWidth = tooltip.offsetWidth
        const availableWidth = containerRect.width

        const left =
          tooltipX + tooltipWidth + 12 > availableWidth ? tooltipX - tooltipWidth - 12 : tooltipX + 12
        tooltip.style.left = `${left}px`
        tooltip.style.top = `${MARGIN.top + 8}px`
      }
    })
    .on('mouseleave', () => {
      crosshair.style('display', 'none')
      if (tooltip) tooltip.style.display = 'none'
    })
}

const ChartToggle = ({
  color,
  label,
  active,
  loading,
  onToggle,
}: {
  color: string
  label: string
  active: boolean
  loading: boolean
  onToggle: () => void
}) => (
  <button class={`chart-toggle${active ? ' active' : ''}`} onClick={onToggle} type="button">
    <span class="chart-toggle-dot" style={{ background: color }} />
    {label} {loading && active ? '...' : ''}
  </button>
)

/** Pick a bucket size that yields a reasonable number of chart points for the duration. */
const chooseBucketSize = (start: Date, end: Date): string => {
  const durationMin = (end.getTime() - start.getTime()) / 60_000
  if (durationMin <= 30) return '30s'
  if (durationMin <= 120) return '1m'
  if (durationMin <= 360) return '5m'
  return '15m'
}

interface MetricChartData {
  metrics: string[]
  series: Map<string, TimeSeries>
}

/** Fetch bucketed metrics — discovers available metrics AND provides chart data in one call. */
const useMetricChartData = (start: Date, end: Date) =>
  useQuery({
    queryFn: async (): Promise<MetricChartData> => {
      const bucket = chooseBucketSize(start, end)
      const response = await fetchBucketedMetrics(start, end, undefined, bucket)
      const seriesMap = new Map<string, TimeSeries>()

      for (const b of response.buckets ?? []) {
        const time = new Date(b.start)
        for (const [metric, stats] of Object.entries(b.metrics)) {
          if (EXCLUDED_METRICS.has(metric)) continue
          let arr = seriesMap.get(metric)
          if (!arr) {
            arr = []
            seriesMap.set(metric, arr)
          }
          arr.push([time, stats.avg])
        }
      }

      return { metrics: [...seriesMap.keys()].sort(), series: seriesMap }
    },
    queryKey: ['detail-metric-chart-data', start.toISOString(), end.toISOString()],
    staleTime: 5 * 60 * 1000,
  })

export const ActivityChart = ({ start, end, stages, defaultMetrics = [] }: ActivityChartProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const chartDataQuery = useMetricChartData(start, end)
  const availableMetrics = chartDataQuery.data?.metrics ?? []
  const seriesMap = chartDataQuery.data?.series

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

  // Compute which metrics get axes (last MAX_RIGHT_AXES in toggleOrder that are enabled)
  const metricsWithAxes = new Set(toggleOrder.filter((m) => enabledMetrics.has(m)).slice(-MAX_RIGHT_AXES))

  // Compute fallback color index for non-known metrics
  const fallbackColorIndices = new Map<string, number>()
  let fallbackIdx = 0
  for (const metric of availableMetrics) {
    if (!KNOWN_METRIC_COLORS[metric]) {
      fallbackColorIndices.set(metric, fallbackIdx++)
    }
  }

  // Build overlay list from bucketed data
  const overlays: MetricOverlay[] = []
  for (const metric of availableMetrics) {
    if (!enabledMetrics.has(metric)) continue
    const data = seriesMap?.get(metric)
    if (!hasData(data)) continue

    overlays.push({
      color: getMetricColor(metric, fallbackColorIndices.get(metric) ?? 0),
      data,
      metric,
      showAxis: metricsWithAxes.has(metric),
      unit: getMetricUnit(metric),
    })
  }

  const hasHypnogram = stages && stages.length > 0

  useEffect(
    () =>
      renderChart({
        containerRef,
        hasHypnogram: !!hasHypnogram,
        overlays,
        stages,
        start,
        end,
        svgRef,
        tooltipRef,
      }),
    [start, end, stages, hasHypnogram, overlays],
  )

  return (
    <div class="activity-chart-container">
      <div class="chart-toggles">
        {chartDataQuery.isLoading && <span class="chart-toggle-loading">Loading metrics...</span>}
        {availableMetrics.map((metric) => (
          <ChartToggle
            key={metric}
            color={getMetricColor(metric, fallbackColorIndices.get(metric) ?? 0)}
            label={formatMetricLabel(metric)}
            active={enabledMetrics.has(metric)}
            loading={false}
            onToggle={() => toggleMetric(metric)}
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
