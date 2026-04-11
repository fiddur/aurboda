/**
 * D3 bar chart component for bucketed chart data.
 *
 * Uses time-based x-axis positioning so bars are placed at their actual dates
 * with proportional widths and gaps for missing buckets.
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

export type BucketSize = '1m' | '5m' | '15m' | '1h' | '1d' | '1w' | '1M'

export interface BarChartProps {
  data: { bucket_start: string; value: number }[]
  color?: string
  height?: number
  bucketSize?: BucketSize
  rangeStart?: string
  rangeEnd?: string
  multiSeries?: BarSeriesData[]
  getBarHref?: (info: BarClickInfo) => string
}

interface ParsedBar {
  date: Date
  value: number
}

/** Bucket size in milliseconds (approximate for month). */
const bucketSizeMs = (size: BucketSize): number => {
  const ms = {
    '1M': 30 * 86400000,
    '1d': 86400000,
    '1h': 3600000,
    '1m': 60000,
    '1w': 7 * 86400000,
    '5m': 300000,
    '15m': 900000,
  }
  return ms[size] ?? 86400000
}

const buildBarDateFormat = (extent: [Date, Date], bucketSize: BucketSize) => {
  if (bucketSize === '1w') return (d: Date) => `Week of ${d3.timeFormat('%b %d')(d)}`
  if (bucketSize === '1M') return d3.timeFormat("%b '%y")
  const spanDays = (extent[1].getTime() - extent[0].getTime()) / 86400000
  if (spanDays < 2) return d3.timeFormat('%H:%M')
  if (spanDays < 7) return d3.timeFormat('%b %d %H:%M')
  if (spanDays > 365) return d3.timeFormat("%b '%y")
  return d3.timeFormat('%b %d')
}

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

function renderTimeAxes(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  x: d3.ScaleTime<number, number>,
  y: d3.ScaleLinear<number, number>,
  innerWidth: number,
  innerHeight: number,
) {
  g.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).ticks(8))
    .selectAll('text')
    .attr('font-size', '11px')
    .attr('text-anchor', 'end')
    .attr('transform', 'rotate(-35)')

  g.append('g').call(d3.axisLeft(y).ticks(5)).selectAll('text').attr('font-size', '11px')
}

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- D3 selection type unions are unwieldy
function createBarWrapper(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  href: string | undefined,
): d3.Selection<any, unknown, null, undefined> {
  if (href) {
    const a = document.createElementNS('http://www.w3.org/2000/svg', 'a')
    a.setAttribute('href', href)
    g.node()!.appendChild(a)
    return d3.select(a)
  }
  return g.append('g')
}

function renderBars(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  bars: ParsedBar[],
  x: d3.ScaleTime<number, number>,
  y: d3.ScaleLinear<number, number>,
  innerHeight: number,
  barWidth: number,
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
      .attr('x', x(d.date))
      .attr('y', y(d.value))
      .attr('width', Math.max(barWidth, 1))
      .attr('height', Math.max(innerHeight - y(d.value), 0))
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

function renderMultiSeriesBars(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  multiSeries: BarSeriesData[],
  allBuckets: Date[],
  x: d3.ScaleTime<number, number>,
  y: d3.ScaleLinear<number, number>,
  innerHeight: number,
  barWidth: number,
  tooltip: HTMLDivElement,
  container: HTMLDivElement,
  margin: { left: number; top: number },
  dateFormat: (date: Date) => string,
  getBarHref?: (info: BarClickInfo) => string,
) {
  const seriesCount = multiSeries.length
  const subBarWidth = Math.max(barWidth / seriesCount - 1, 1)

  const bucketValues = new Map<string, Map<string, number>>()
  for (const series of multiSeries) {
    for (const d of series.data) {
      if (!bucketValues.has(d.bucket_start)) bucketValues.set(d.bucket_start, new Map())
      bucketValues.get(d.bucket_start)!.set(series.name, d.value)
    }
  }

  const showBucketTooltip = (bucketIso: string) => {
    g.selectAll<SVGRectElement, unknown>('[data-bucket]').attr('fill-opacity', function () {
      return this.getAttribute('data-bucket') === bucketIso ? 0.8 : 0.3
    })
    const dateLabel = dateFormat(new Date(bucketIso))
    const values = bucketValues.get(bucketIso)
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

    for (const bucketDate of allBuckets) {
      const bucketIso = bucketDate.toISOString()
      const value = dataMap.get(bucketIso) ?? 0
      const href = getBarHref?.({ bucket_start: bucketIso, series_name: series.name })
      const wrapper = createBarWrapper(g, href)
      wrapper
        .append('rect')
        .attr('class', `bar-s${si}`)
        .attr('data-bucket', bucketIso)
        .attr('x', x(bucketDate) + si * (subBarWidth + 1))
        .attr('y', y(value))
        .attr('width', Math.max(subBarWidth, 1))
        .attr('height', Math.max(innerHeight - y(value), 0))
        .attr('fill', series.color)
        .attr('rx', 1)
        .style('cursor', getBarHref ? 'pointer' : 'default')
        .on('mouseenter', () => showBucketTooltip(bucketIso))
        .on('mousemove', (event: MouseEvent) => positionTooltip(event, container, tooltip, margin))
        .on('mouseleave', () => hideBucketTooltip())
    }
  }
}

export function BarChart({
  data,
  color = '#8b5cf6',
  height = 300,
  bucketSize = '1d',
  rangeStart,
  rangeEnd,
  multiSeries,
  getBarHref,
}: BarChartProps) {
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
    const bMs = bucketSizeMs(bucketSize)

    if (multiSeries && multiSeries.length > 0) {
      const allBucketStrs = [...new Set(multiSeries.flatMap((s) => s.data.map((d) => d.bucket_start)))].sort()
      if (allBucketStrs.length === 0) return
      const allBuckets = allBucketStrs.map((s) => new Date(s))

      const xMin = rangeStart ? new Date(rangeStart) : new Date(allBuckets[0].getTime() - bMs * 0.5)
      const xMax = rangeEnd
        ? new Date(rangeEnd)
        : new Date(allBuckets[allBuckets.length - 1].getTime() + bMs * 1.5)
      const x = d3.scaleTime().domain([xMin, xMax]).range([0, innerWidth])

      const barWidth = Math.max(x(new Date(xMin.getTime() + bMs)) - x(xMin) - 2, 2)
      const yMax = d3.max(multiSeries, (s) => d3.max(s.data, (d) => d.value)) ?? 1
      const y = d3
        .scaleLinear()
        .domain([0, yMax * 1.1])
        .nice()
        .range([innerHeight, 0])

      const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)
      renderGrid(g, y, innerWidth)
      renderTimeAxes(g, x, y, innerWidth, innerHeight)

      if (tooltipRef.current) {
        renderMultiSeriesBars(
          g,
          multiSeries,
          allBuckets,
          x,
          y,
          innerHeight,
          barWidth,
          tooltipRef.current,
          container,
          margin,
          buildBarDateFormat([xMin, xMax], bucketSize),
          getBarHref,
        )
      }
    } else {
      if (data.length === 0) return

      const bars: ParsedBar[] = data.map((d) => ({ date: new Date(d.bucket_start), value: d.value }))
      const xMin = rangeStart ? new Date(rangeStart) : new Date(bars[0].date.getTime() - bMs * 0.5)
      const xMax = rangeEnd ? new Date(rangeEnd) : new Date(bars[bars.length - 1].date.getTime() + bMs * 1.5)
      const x = d3.scaleTime().domain([xMin, xMax]).range([0, innerWidth])

      const barWidth = Math.max(x(new Date(xMin.getTime() + bMs)) - x(xMin) - 2, 2)
      const yMax = d3.max(bars, (d) => d.value) ?? 1
      const y = d3
        .scaleLinear()
        .domain([0, yMax * 1.1])
        .nice()
        .range([innerHeight, 0])

      const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)
      renderGrid(g, y, innerWidth)
      renderTimeAxes(g, x, y, innerWidth, innerHeight)

      if (tooltipRef.current) {
        renderBars(
          g,
          bars,
          x,
          y,
          innerHeight,
          barWidth,
          color,
          tooltipRef.current,
          container,
          margin,
          buildBarDateFormat([xMin, xMax], bucketSize),
          getBarHref,
        )
      }
    }
  }, [data, color, height, multiSeries, getBarHref, bucketSize, rangeStart, rangeEnd])

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
