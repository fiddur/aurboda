/**
 * D3 bar chart component for bucketed chart data.
 *
 * Renders vertical bars with responsive width, tooltip on hover,
 * and smart date formatting based on data density.
 */
import * as d3 from 'd3'
import { useEffect, useRef } from 'preact/hooks'

import './BarChart.css'

export interface BarSeriesData {
  name: string
  color: string
  data: { bucket_start: string; value: number }[]
}

export interface BarChartProps {
  /** Bucketed data points (single series). */
  data: { bucket_start: string; value: number }[]
  /** Bar fill colour (default '#8b5cf6'). */
  color?: string
  /** Chart height in pixels (default 300). */
  height?: number
  /** Multiple named series — renders stacked bars. Overrides data/color when present. */
  multiSeries?: BarSeriesData[]
}

interface ParsedBar {
  date: Date
  value: number
}

/** Pick a d3 time format based on total time span. */
const buildBarDateFormat = (extent: [Date, Date]) => {
  const spanMs = extent[1].getTime() - extent[0].getTime()
  const spanDays = spanMs / (1000 * 60 * 60 * 24)
  if (spanDays < 2) return d3.timeFormat('%H:%M')
  if (spanDays < 7) return d3.timeFormat('%b %d %H:%M')
  if (spanDays > 365) return d3.timeFormat("%b '%y")
  if (spanDays > 60) return d3.timeFormat('%b %d')
  return d3.timeFormat('%b %d')
}

/** Render axes. */
function renderAxes(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  x: d3.ScaleBand<string>,
  y: d3.ScaleLinear<number, number>,
  bars: ParsedBar[],
  innerWidth: number,
  innerHeight: number,
  dateFormat: (date: Date) => string,
) {
  // Show at most ~10 tick labels to avoid overlap
  const maxTicks = Math.min(bars.length, 10)
  const tickInterval = Math.max(1, Math.ceil(bars.length / maxTicks))
  const tickValues = bars.filter((_, i) => i % tickInterval === 0).map((d) => d.date.toISOString())

  g.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(
      d3
        .axisBottom(x)
        .tickValues(tickValues)
        .tickFormat((d) => dateFormat(new Date(d))),
    )
    .selectAll('text')
    .attr('font-size', '11px')
    .attr('text-anchor', 'end')
    .attr('transform', 'rotate(-35)')

  g.append('g').call(d3.axisLeft(y).ticks(5)).selectAll('text').attr('font-size', '11px')
}

/** Render grid lines behind bars. */
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

/** Render bars with tooltip interaction. */
function renderBars(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  bars: ParsedBar[],
  x: d3.ScaleBand<string>,
  y: d3.ScaleLinear<number, number>,
  innerHeight: number,
  color: string,
  tooltip: HTMLDivElement,
  container: HTMLDivElement,
  margin: { left: number; top: number },
  dateFormat: (date: Date) => string,
) {
  g.selectAll('.bar')
    .data(bars)
    .join('rect')
    .attr('class', 'bar')
    .attr('x', (d) => x(d.date.toISOString()) ?? 0)
    .attr('y', (d) => y(d.value))
    .attr('width', x.bandwidth())
    .attr('height', (d) => innerHeight - y(d.value))
    .attr('fill', color)
    .attr('rx', 2)
    .on('mouseenter', (event: MouseEvent, d) => {
      d3.select(event.target as SVGRectElement).attr('fill-opacity', 0.8)
      tooltip.textContent = `${dateFormat(d.date)}: ${d.value.toFixed(1)}`
      tooltip.style.display = 'block'
    })
    .on('mousemove', (event: MouseEvent) => {
      const containerRect = container.getBoundingClientRect()
      const [mx] = d3.pointer(event, container)
      const tooltipWidth = tooltip.offsetWidth
      const left = mx + tooltipWidth + 12 > containerRect.width ? mx - tooltipWidth - 12 : mx + 12
      tooltip.style.left = `${left}px`
      tooltip.style.top = `${margin.top + 8}px`
    })
    .on('mouseleave', (event: MouseEvent) => {
      d3.select(event.target as SVGRectElement).attr('fill-opacity', 1)
      tooltip.style.display = 'none'
    })
}

export function BarChart({ data, color = '#8b5cf6', height = 300, multiSeries }: BarChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const effectiveData = multiSeries ? (multiSeries[0]?.data ?? []) : data

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return

    const container = containerRef.current
    const chartWidth = container.clientWidth
    const chartHeight = height

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', chartWidth).attr('height', chartHeight)

    const margin = { bottom: 50, left: 50, right: 20, top: 20 }
    const innerWidth = chartWidth - margin.left - margin.right
    const innerHeight = chartHeight - margin.top - margin.bottom

    if (multiSeries && multiSeries.length > 0) {
      // Grouped (side-by-side) bar chart
      const allBuckets = [...new Set(multiSeries.flatMap((s) => s.data.map((d) => d.bucket_start)))].sort()
      if (allBuckets.length === 0) return

      const bars: ParsedBar[] = allBuckets.map((b) => ({ date: new Date(b), value: 0 }))
      const seriesCount = multiSeries.length

      const x0 = d3.scaleBand<string>().domain(allBuckets).range([0, innerWidth]).padding(0.15)

      const x1 = d3
        .scaleBand<string>()
        .domain(multiSeries.map((s) => s.name))
        .range([0, x0.bandwidth()])
        .padding(seriesCount > 3 ? 0.02 : 0.08)

      const yMax = d3.max(multiSeries, (s) => d3.max(s.data, (d) => d.value)) ?? 1
      const y = d3
        .scaleLinear()
        .domain([0, yMax * 1.1])
        .nice()
        .range([innerHeight, 0])

      const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

      const dateExtent = d3.extent(bars, (d) => d.date) as [Date, Date]
      const dateFormat = buildBarDateFormat(dateExtent)

      renderGrid(g, y, innerWidth)
      renderAxes(g, x0, y, bars, innerWidth, innerHeight, dateFormat)

      // Render grouped bars (use index for selector to avoid invalid CSS from special chars in names)
      for (let si = 0; si < multiSeries.length; si++) {
        const series = multiSeries[si]
        const dataMap = new Map(series.data.map((d) => [d.bucket_start, d.value]))
        g.selectAll(`.bar-s${si}`)
          .data(allBuckets)
          .join('rect')
          .attr('class', `bar-s${si}`)
          .attr('x', (bucket) => (x0(bucket) ?? 0) + (x1(series.name) ?? 0))
          .attr('y', (bucket) => y(dataMap.get(bucket) ?? 0))
          .attr('width', x1.bandwidth())
          .attr('height', (bucket) => innerHeight - y(dataMap.get(bucket) ?? 0))
          .attr('fill', series.color)
          .attr('rx', 1)
      }
    } else {
      // Single series
      if (data.length === 0) return

      const bars: ParsedBar[] = data.map((d) => ({
        date: new Date(d.bucket_start),
        value: d.value,
      }))

      const x = d3
        .scaleBand<string>()
        .domain(bars.map((d) => d.date.toISOString()))
        .range([0, innerWidth])
        .padding(0.2)

      const yMax = d3.max(bars, (d) => d.value) ?? 1
      const y = d3
        .scaleLinear()
        .domain([0, yMax * 1.1])
        .nice()
        .range([innerHeight, 0])

      const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

      const dateExtent = d3.extent(bars, (d) => d.date) as [Date, Date]
      const dateFormat = buildBarDateFormat(dateExtent)

      renderGrid(g, y, innerWidth)
      renderAxes(g, x, y, bars, innerWidth, innerHeight, dateFormat)

      if (tooltipRef.current) {
        renderBars(g, bars, x, y, innerHeight, color, tooltipRef.current, container, margin, dateFormat)
      }
    }
  }, [data, color, height, multiSeries])

  if (effectiveData.length === 0) {
    return <div class="bar-chart-placeholder">No data for the selected range</div>
  }

  return (
    <div ref={containerRef} class="bar-chart-container">
      <svg ref={svgRef} />
      <div class="bar-chart-tooltip" ref={tooltipRef} />
    </div>
  )
}
