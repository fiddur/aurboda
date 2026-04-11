/**
 * D3 bar chart component for bucketed chart data.
 *
 * Renders vertical bars with responsive width, tooltip on hover,
 * real <a> links for navigation (middle-click, right-click, URL preview),
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

export interface BarClickInfo {
  bucket_start: string
  series_name?: string
}

export interface BarChartProps {
  /** Bucketed data points (single series). */
  data: { bucket_start: string; value: number }[]
  /** Bar fill colour (default '#8b5cf6'). */
  color?: string
  /** Chart height in pixels (default 300). */
  height?: number
  /** Multiple named series — renders grouped bars. Overrides data/color when present. */
  multiSeries?: BarSeriesData[]
  /** Returns an href for a bar click — enables real <a> links with middle-click support. */
  getBarHref?: (info: BarClickInfo) => string
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

/** Position a tooltip with smart left/right flip. */
function positionTooltip(
  event: MouseEvent,
  container: HTMLDivElement,
  tooltip: HTMLDivElement,
  margin: { left: number; top: number },
) {
  const containerRect = container.getBoundingClientRect()
  const [mx] = d3.pointer(event, container)
  const tooltipWidth = tooltip.offsetWidth
  const left = mx + tooltipWidth + 12 > containerRect.width ? mx - tooltipWidth - 12 : mx + 12
  tooltip.style.left = `${left}px`
  tooltip.style.top = `${margin.top + 8}px`
}

/** Create an SVG <a> wrapper for a bar, or a <g> if no href. Returns d3 selection. */
function createBarWrapper(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  href: string | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- D3 selection type unions are unwieldy
): d3.Selection<any, unknown, null, undefined> {
  if (href) {
    const a = document.createElementNS('http://www.w3.org/2000/svg', 'a')
    a.setAttribute('href', href)
    g.node()!.appendChild(a)
    return d3.select(a)
  }
  return g.append('g')
}

/** Render single-series bars wrapped in <a> links when getBarHref is provided. */
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
  getBarHref?: (info: BarClickInfo) => string,
) {
  for (const d of bars) {
    const href = getBarHref?.({ bucket_start: d.date.toISOString() })
    const wrapper = createBarWrapper(g, href)
    wrapper
      .append('rect')
      .attr('class', 'bar')
      .attr('x', x(d.date.toISOString()) ?? 0)
      .attr('y', y(d.value))
      .attr('width', x.bandwidth())
      .attr('height', innerHeight - y(d.value))
      .attr('fill', color)
      .attr('rx', 2)
      .style('cursor', getBarHref ? 'pointer' : 'default')
      .on('mouseenter', (event: MouseEvent) => {
        d3.select(event.target as SVGRectElement).attr('fill-opacity', 0.8)
        tooltip.textContent = `${dateFormat(d.date)}: ${d.value.toFixed(1)}`
        tooltip.style.display = 'block'
      })
      .on('mousemove', (event: MouseEvent) => positionTooltip(event, container, tooltip, margin))
      .on('mouseleave', (event: MouseEvent) => {
        d3.select(event.target as SVGRectElement).attr('fill-opacity', 1)
        tooltip.style.display = 'none'
      })
  }
}

/** Render multi-series grouped bars wrapped in <a> links. */
function renderMultiSeriesBars(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  multiSeries: BarSeriesData[],
  allBuckets: string[],
  x0: d3.ScaleBand<string>,
  x1: d3.ScaleBand<string>,
  y: d3.ScaleLinear<number, number>,
  innerHeight: number,
  tooltip: HTMLDivElement,
  container: HTMLDivElement,
  margin: { left: number; top: number },
  dateFormat: (date: Date) => string,
  getBarHref?: (info: BarClickInfo) => string,
) {
  // Build lookup: bucket -> series -> value
  const bucketValues = new Map<string, Map<string, number>>()
  for (const series of multiSeries) {
    for (const d of series.data) {
      if (!bucketValues.has(d.bucket_start)) bucketValues.set(d.bucket_start, new Map())
      bucketValues.get(d.bucket_start)!.set(series.name, d.value)
    }
  }

  const showBucketTooltip = (bucket: string) => {
    g.selectAll<SVGRectElement, string>('[data-bucket]').attr('fill-opacity', (b) =>
      b === bucket ? 0.8 : 0.3,
    )
    const dateLabel = dateFormat(new Date(bucket))
    const values = bucketValues.get(bucket)
    const lines = multiSeries
      .map((s) => {
        const v = values?.get(s.name) ?? 0
        return `<span style="color:${s.color}">&#9679;</span> ${s.name}: ${v.toFixed(1)}`
      })
      .join('<br/>')
    tooltip.innerHTML = `<strong>${dateLabel}</strong><br/>${lines}`
    tooltip.style.display = 'block'
  }

  const hideBucketTooltip = () => {
    g.selectAll('[data-bucket]').attr('fill-opacity', 1)
    tooltip.style.display = 'none'
  }

  for (let si = 0; si < multiSeries.length; si++) {
    const series = multiSeries[si]
    const dataMap = new Map(series.data.map((d) => [d.bucket_start, d.value]))

    for (const bucket of allBuckets) {
      const href = getBarHref?.({ bucket_start: bucket, series_name: series.name })
      const wrapper = createBarWrapper(g, href)
      const value = dataMap.get(bucket) ?? 0
      wrapper
        .append('rect')
        .attr('class', `bar-s${si}`)
        .attr('data-bucket', bucket)
        .attr('x', (x0(bucket) ?? 0) + (x1(series.name) ?? 0))
        .attr('y', y(value))
        .attr('width', x1.bandwidth())
        .attr('height', innerHeight - y(value))
        .attr('fill', series.color)
        .attr('rx', 1)
        .style('cursor', getBarHref ? 'pointer' : 'default')
        .on('mouseenter', () => showBucketTooltip(bucket))
        .on('mousemove', (event: MouseEvent) => positionTooltip(event, container, tooltip, margin))
        .on('mouseleave', () => hideBucketTooltip())
    }
  }
}

export function BarChart({ data, color = '#8b5cf6', height = 300, multiSeries, getBarHref }: BarChartProps) {
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

      if (tooltipRef.current) {
        renderMultiSeriesBars(
          g,
          multiSeries,
          allBuckets,
          x0,
          x1,
          y,
          innerHeight,
          tooltipRef.current,
          container,
          margin,
          dateFormat,
          getBarHref,
        )
      }
    } else {
      if (data.length === 0) return

      const bars: ParsedBar[] = data.map((d) => ({ date: new Date(d.bucket_start), value: d.value }))
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
        renderBars(
          g,
          bars,
          x,
          y,
          innerHeight,
          color,
          tooltipRef.current,
          container,
          margin,
          dateFormat,
          getBarHref,
        )
      }
    }
  }, [data, color, height, multiSeries, getBarHref])

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
