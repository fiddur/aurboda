/**
 * Shared D3 area+line trend chart component.
 *
 * Renders a responsive area+line chart with monotoneX curve, optional tooltip
 * crosshair and grid lines. Used by the Chart exploration page, TagMeta mini
 * charts, and compact dashboard widgets.
 */
import * as d3 from 'd3'
import { useEffect, useRef } from 'preact/hooks'

import './TrendLineChart.css'

export interface LineSeriesData {
  name: string
  color: string
  data: { date: string; value: number }[]
}

export interface TrendLineChartProps {
  /** Data points to render — must have at least 2 entries. */
  data: { date: string; value: number }[]
  /** Stroke / dot / area tint colour. */
  color: string
  /** Chart height in pixels (default 200). */
  height?: number
  /** Fixed width in pixels. When omitted the chart reads the container width. */
  width?: number
  /** Compact mode — hides tooltip crosshair and grid lines (for widgets). */
  compact?: boolean
  /** Multiple named series — renders overlaid lines. Overrides data/color when present. */
  multiSeries?: LineSeriesData[]
}

interface ParsedPoint {
  date: Date
  value: number
}

/** Build x-axis date formatter depending on whether the range spans years. */
const buildDateFormat = (extent: [Date, Date]) => {
  const spanYears = extent[1].getFullYear() - extent[0].getFullYear()
  return {
    axisFormat: spanYears >= 1 ? d3.timeFormat("%b '%y") : d3.timeFormat('%b %d'),
    spanYears,
    tooltipFormat: spanYears >= 1 ? d3.timeFormat("%b %d, '%y") : d3.timeFormat('%b %d'),
  }
}

/** Render axes (x + y). */
function renderAxes(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  x: d3.ScaleTime<number, number>,
  y: d3.ScaleLinear<number, number>,
  innerWidth: number,
  innerHeight: number,
  dateFormat: (date: Date) => string,
) {
  g.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(
      d3
        .axisBottom(x)
        .ticks(6)
        .tickFormat((d) => dateFormat(d as Date)),
    )
    .selectAll('text')
    .attr('font-size', '11px')

  g.append('g').call(d3.axisLeft(y).ticks(5)).selectAll('text').attr('font-size', '11px')
}

/** Render grid lines behind the data. */
function renderGrid(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  y: d3.ScaleLinear<number, number>,
  innerWidth: number,
) {
  g.append('g')
    .attr('class', 'grid')
    .call(
      d3
        .axisLeft(y)
        .tickSize(-innerWidth)
        .tickFormat(() => ''),
    )
    .selectAll('line')
    .attr('stroke', '#e5e7eb')
    .attr('stroke-dasharray', '3,3')
}

/** Render the area fill + line path. */
function renderAreaAndLine(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  parsedData: ParsedPoint[],
  x: d3.ScaleTime<number, number>,
  y: d3.ScaleLinear<number, number>,
  innerHeight: number,
  color: string,
) {
  const area = d3
    .area<ParsedPoint>()
    .x((d) => x(d.date))
    .y0(innerHeight)
    .y1((d) => y(d.value))
    .curve(d3.curveMonotoneX)

  g.append('path').datum(parsedData).attr('fill', color).attr('fill-opacity', 0.2).attr('d', area)

  const line = d3
    .line<ParsedPoint>()
    .x((d) => x(d.date))
    .y((d) => y(d.value))
    .curve(d3.curveMonotoneX)

  g.append('path')
    .datum(parsedData)
    .attr('fill', 'none')
    .attr('stroke', color)
    .attr('stroke-width', 2)
    .attr('d', line)
}

/** Render sampled data-point dots. */
function renderDots(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  parsedData: ParsedPoint[],
  x: d3.ScaleTime<number, number>,
  y: d3.ScaleLinear<number, number>,
  color: string,
) {
  g.selectAll('.dot')
    .data(parsedData.filter((_, i) => i % 7 === 0 || i === parsedData.length - 1))
    .join('circle')
    .attr('class', 'dot')
    .attr('cx', (d) => x(d.date))
    .attr('cy', (d) => y(d.value))
    .attr('r', 3)
    .attr('fill', color)
}

/** Render multiple overlaid series (area + line for each). */
function renderMultiSeries(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  series: LineSeriesData[],
  innerWidth: number,
  innerHeight: number,
  compact: boolean,
) {
  const allPoints = series.flatMap((s) => s.data.map((d) => ({ date: new Date(d.date), value: d.value })))
  if (allPoints.length < 2) return

  const x = d3
    .scaleTime()
    .domain(d3.extent(allPoints, (d) => d.date) as [Date, Date])
    .range([0, innerWidth])

  const yExtent = d3.extent(allPoints, (d) => d.value) as [number, number]
  const yRange = yExtent[1] - yExtent[0]
  const yPadding = yRange * 0.1 || 1
  const yMin = yExtent[0] >= 0 ? Math.max(0, yExtent[0] - yPadding) : yExtent[0] - yPadding
  const y = d3
    .scaleLinear()
    .domain([yMin, yExtent[1] + yPadding])
    .nice()
    .range([innerHeight, 0])

  const dateExtent = d3.extent(allPoints, (d) => d.date) as [Date, Date]
  const { axisFormat } = buildDateFormat(dateExtent)

  if (!compact) renderGrid(g, y, innerWidth)

  for (const s of series) {
    const parsed = s.data.map((d) => ({ date: new Date(d.date), value: d.value }))
    if (parsed.length < 2) continue
    renderAreaAndLine(g, parsed, x, y, innerHeight, s.color)
  }

  renderAxes(g, x, y, innerWidth, innerHeight, axisFormat)
}

/** Attach tooltip crosshair + highlight dot behaviour. */
function attachTooltip(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  parsedData: ParsedPoint[],
  x: d3.ScaleTime<number, number>,
  y: d3.ScaleLinear<number, number>,
  innerWidth: number,
  innerHeight: number,
  color: string,
  container: HTMLDivElement,
  tooltip: HTMLDivElement,
  margin: { top: number; left: number },
  tooltipFormat: (date: Date) => string,
) {
  const crosshair = g
    .append('line')
    .attr('y1', 0)
    .attr('y2', innerHeight)
    .attr('stroke', 'currentColor')
    .attr('stroke-opacity', 0.4)
    .attr('stroke-dasharray', '4 3')
    .attr('pointer-events', 'none')
    .style('display', 'none')

  const highlightDot = g
    .append('circle')
    .attr('r', 4)
    .attr('fill', color)
    .attr('stroke', '#fff')
    .attr('stroke-width', 2)
    .attr('pointer-events', 'none')
    .style('display', 'none')

  const bisector = d3.bisector<ParsedPoint, Date>((d) => d.date).left

  g.append('rect')
    .attr('width', innerWidth)
    .attr('height', innerHeight)
    .attr('fill', 'transparent')
    .attr('pointer-events', 'all')
    .on('mousemove', (event: MouseEvent) => {
      const [mx] = d3.pointer(event)
      const dateAtMouse = x.invert(mx)
      const idx = bisector(parsedData, dateAtMouse, 1)
      const d0 = parsedData[idx - 1]
      const d1 = parsedData[idx]
      if (!d0) return
      const nearest =
        d1 && dateAtMouse.getTime() - d0.date.getTime() > d1.date.getTime() - dateAtMouse.getTime() ? d1 : d0
      const cx = x(nearest.date)
      const cy = y(nearest.value)

      crosshair.attr('x1', cx).attr('x2', cx).style('display', null)
      highlightDot.attr('cx', cx).attr('cy', cy).style('display', null)

      const dateLabel = tooltipFormat(nearest.date)
      tooltip.textContent = `${dateLabel}: ${nearest.value.toFixed(1)}`
      tooltip.style.display = 'block'

      const containerRect = container.getBoundingClientRect()
      const tooltipX = mx + margin.left
      const tooltipWidth = tooltip.offsetWidth
      const left =
        tooltipX + tooltipWidth + 12 > containerRect.width ? tooltipX - tooltipWidth - 12 : tooltipX + 12
      tooltip.style.left = `${left}px`
      tooltip.style.top = `${margin.top + 8}px`
    })
    .on('mouseleave', () => {
      crosshair.style('display', 'none')
      highlightDot.style('display', 'none')
      tooltip.style.display = 'none'
    })
}

export function TrendLineChart({
  data,
  color,
  height = 200,
  width,
  compact = false,
  multiSeries,
}: TrendLineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const effectiveData = multiSeries ? (multiSeries[0]?.data ?? []) : data

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return

    const container = containerRef.current
    const chartWidth = width ?? container.clientWidth
    const chartHeight = height

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', chartWidth).attr('height', chartHeight)

    const margin = { bottom: 30, left: 50, right: 20, top: 20 }
    const innerWidth = chartWidth - margin.left - margin.right
    const innerHeight = chartHeight - margin.top - margin.bottom

    if (multiSeries && multiSeries.length > 0) {
      const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)
      renderMultiSeries(g, multiSeries, innerWidth, innerHeight, compact)
    } else {
      // Single series (original behavior)
      const parsedData: ParsedPoint[] = data.map((d) => ({
        date: new Date(d.date),
        value: d.value,
      }))
      if (parsedData.length < 2) return

      const x = d3
        .scaleTime()
        .domain(d3.extent(parsedData, (d) => d.date) as [Date, Date])
        .range([0, innerWidth])

      const yExtent = d3.extent(parsedData, (d) => d.value) as [number, number]
      const yRange = yExtent[1] - yExtent[0]
      const yPadding = yRange * 0.1 || 1
      const yMin = yExtent[0] >= 0 ? Math.max(0, yExtent[0] - yPadding) : yExtent[0] - yPadding
      const y = d3
        .scaleLinear()
        .domain([yMin, yExtent[1] + yPadding])
        .nice()
        .range([innerHeight, 0])

      const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

      const dateExtent = d3.extent(parsedData, (d) => d.date) as [Date, Date]
      const { axisFormat, tooltipFormat } = buildDateFormat(dateExtent)

      if (!compact) renderGrid(g, y, innerWidth)
      renderAreaAndLine(g, parsedData, x, y, innerHeight, color)
      if (!compact) renderDots(g, parsedData, x, y, color)
      renderAxes(g, x, y, innerWidth, innerHeight, axisFormat)

      if (!compact && tooltipRef.current) {
        attachTooltip(
          g,
          parsedData,
          x,
          y,
          innerWidth,
          innerHeight,
          color,
          container,
          tooltipRef.current,
          margin,
          tooltipFormat,
        )
      }
    }
  }, [data, color, height, width, compact, multiSeries])

  if (effectiveData.length < 2) {
    return <div class="trend-line-chart-placeholder">Insufficient data for chart</div>
  }

  return (
    <div ref={containerRef} class="trend-line-chart-container">
      <svg ref={svgRef} />
      {!compact && <div class="trend-line-chart-tooltip" ref={tooltipRef} />}
    </div>
  )
}
