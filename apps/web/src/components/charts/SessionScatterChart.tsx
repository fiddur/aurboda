import * as d3 from 'd3'
import { useEffect, useRef } from 'preact/hooks'

import { CHART_PRIMARY } from '../../theme'
import {
  collapsedRadius,
  DOT_RADIUS,
  isHighlighted,
  type LegendEntry,
  type ScatterPoint,
  type ScatterY,
  scatterDomain,
  scatterYAxisLabel,
  tooltipLines,
} from './session-scatter'
import './SessionScatterChart.css'

export interface SessionScatterChartProps {
  points: ScatterPoint[]
  y: ScatterY
  collapsed: boolean
  colorOf: (key: string | undefined) => string
  entries: LegendEntry[]
  highlight?: string
  labelOf: (key: string) => string
  onSessionClick: (point: ScatterPoint) => void
  onGroupClick: (point: ScatterPoint) => void
  height?: number
}

const DIMMED_OPACITY = 0.12
const MARGIN = { bottom: 44, left: 52, right: 14, top: 12 }

type Group = d3.Selection<SVGGElement, unknown, null, undefined>

/** The grid first and the axes after it: the dots go between, so tick labels stay readable over a dot. */
const renderAxes = (
  g: Group,
  x: d3.ScaleLinear<number, number>,
  yScale: d3.ScaleLinear<number, number>,
  innerWidth: number,
  innerHeight: number,
  y: ScatterY,
) => {
  const xTicks = Math.max(2, Math.floor(innerWidth / 70))
  g.append('g')
    .call(
      d3
        .axisLeft(yScale)
        .ticks(5)
        .tickSize(-innerWidth)
        .tickFormat(() => ''),
    )
    .call((axis) => axis.select('.domain').remove())
    .selectAll('line')
    .attr('stroke', 'currentColor')
    .attr('stroke-opacity', 0.12)
  g.append('g')
    .attr('class', 'session-scatter-x-axis')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).ticks(xTicks))
    .selectAll('text')
    .attr('font-size', '11px')
  g.append('g').call(d3.axisLeft(yScale).ticks(5)).selectAll('text').attr('font-size', '11px')
  g.append('text')
    .attr('class', 'session-scatter-axis-label')
    .attr('x', innerWidth / 2)
    .attr('y', innerHeight + 36)
    .attr('text-anchor', 'middle')
    .text('Duration (min)')
  g.append('text')
    .attr('class', 'session-scatter-axis-label')
    .attr('transform', 'rotate(-90)')
    .attr('x', -innerHeight / 2)
    .attr('y', -40)
    .attr('text-anchor', 'middle')
    .text(scatterYAxisLabel[y])
}

const showTooltip = (
  tooltip: HTMLDivElement,
  container: HTMLDivElement,
  lines: string[],
  at: [number, number],
) => {
  tooltip.replaceChildren(
    ...lines.map((line, i) => {
      const div = document.createElement('div')
      div.textContent = line
      if (i === 0) div.className = 'session-scatter-tooltip-title'
      return div
    }),
  )
  tooltip.style.display = 'block'
  const [mx, my] = at
  const width = tooltip.offsetWidth
  const height = tooltip.offsetHeight
  tooltip.style.left = `${Math.max(0, mx + width + 14 > container.clientWidth ? mx - width - 14 : mx + 14)}px`
  tooltip.style.top = `${Math.max(0, my - height - 10)}px`
}

/** Sessions as dots, duration across and exertion up; collapsed, one dot per value sized by its count. */
export function SessionScatterChart({
  points,
  y,
  collapsed,
  colorOf,
  entries,
  highlight,
  labelOf,
  onSessionClick,
  onGroupClick,
  height = 360,
}: SessionScatterChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    const tooltip = tooltipRef.current
    if (!svgRef.current || !container || !tooltip) return

    const width = container.clientWidth
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', width).attr('height', height)
    tooltip.style.display = 'none'

    const innerWidth = width - MARGIN.left - MARGIN.right
    const innerHeight = height - MARGIN.top - MARGIN.bottom
    const x = d3
      .scaleLinear()
      .domain(scatterDomain(points.map((p) => p.x)))
      .range([0, innerWidth])
    const yScale = d3
      .scaleLinear()
      .domain(scatterDomain(points.map((p) => p.y)))
      .range([innerHeight, 0])

    const g = svg.append('g').attr('transform', `translate(${MARGIN.left},${MARGIN.top})`)
    renderAxes(g, x, yScale, innerWidth, innerHeight, y)

    const maxCount = Math.max(1, ...points.map((p) => p.count))
    const radius = (p: ScatterPoint) => (collapsed ? collapsedRadius(p.count, maxCount) : DOT_RADIUS)
    const lit = (p: ScatterPoint) => isHighlighted(p, highlight, entries)
    const ordered = points.toSorted((a, b) => (lit(a) === lit(b) ? radius(b) - radius(a) : lit(a) ? 1 : -1))

    let lastPointer = 'mouse'
    let armed: string | undefined
    const hide = () => {
      tooltip.style.display = 'none'
      armed = undefined
    }
    const show = (event: MouseEvent, p: ScatterPoint) =>
      showTooltip(
        tooltip,
        container,
        tooltipLines(p, { collapsed, labelOf, y }),
        d3.pointer(event, container),
      )

    svg.on('click', (event: MouseEvent) => {
      if (event.target === svgRef.current) hide()
    })

    g.insert('g', '.session-scatter-x-axis')
      .selectAll('circle')
      .data(ordered)
      .join('circle')
      .attr('class', 'session-scatter-dot')
      .attr('cx', (p) => x(p.x))
      .attr('cy', (p) => yScale(p.y))
      .attr('r', radius)
      .attr('fill', (p) => (p.group === undefined ? CHART_PRIMARY : colorOf(p.group)))
      .attr('fill-opacity', (p) => (lit(p) ? (collapsed ? 0.7 : 0.8) : DIMMED_OPACITY))
      .on('pointerdown', (event: PointerEvent) => {
        lastPointer = event.pointerType
      })
      .on('mouseenter', (event: MouseEvent, p) => {
        if (lastPointer === 'mouse') show(event, p)
      })
      .on('mousemove', (event: MouseEvent, p) => {
        if (lastPointer === 'mouse') show(event, p)
      })
      .on('mouseleave', () => {
        if (lastPointer === 'mouse') hide()
      })
      .on('click', (event: MouseEvent, p) => {
        if (lastPointer !== 'mouse' && armed !== p.id) {
          armed = p.id
          show(event, p)
          return
        }
        hide()
        if (collapsed) onGroupClick(p)
        else onSessionClick(p)
      })
  }, [points, y, collapsed, colorOf, entries, highlight, labelOf, onSessionClick, onGroupClick, height])

  if (points.length === 0) return <div class="session-scatter-empty">No sessions to plot in this range</div>

  return (
    <div ref={containerRef} class="session-scatter">
      <svg
        ref={svgRef}
        role="img"
        aria-label={`Sessions by duration and ${scatterYAxisLabel[y].toLowerCase()}`}
      />
      <div class="session-scatter-tooltip" ref={tooltipRef} />
    </div>
  )
}
