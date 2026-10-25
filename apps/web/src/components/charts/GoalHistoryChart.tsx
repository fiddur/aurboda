import type { GoalHistoryDay, GoalHistoryMonth } from '@aurboda/api-spec'

import * as d3 from 'd3'
import { useEffect, useRef } from 'preact/hooks'

import {
  dayTooltip,
  monthLabel,
  monthTooltip,
  statusColor,
  targetBandColor,
  trendLineColor,
  yDomainTop,
} from './goal-history-chart-utils'
import './GoalHistoryChart.css'

export type GoalHistoryChartMode = 'bars' | 'line' | 'months'

export interface GoalHistoryChartProps {
  days?: GoalHistoryDay[]
  months?: GoalHistoryMonth[]
  min?: number
  max?: number
  mode: GoalHistoryChartMode
  formatValue: (v: number) => string
  height?: number
}

type Group = d3.Selection<SVGGElement, unknown, null, undefined>

interface TooltipCtx {
  container: HTMLDivElement
  tooltip: HTMLDivElement
  top: number
}

const DAY_MS = 86400000
const PARTIAL_OPACITY = 0.45

const dayStart = (date: string): Date => new Date(`${date}T00:00:00Z`)

const bindTooltip = (
  // oxlint-disable-next-line typescript/no-explicit-any -- D3 selection type unions are unwieldy
  sel: d3.Selection<any, unknown, null, undefined>,
  text: string,
  { container, tooltip, top }: TooltipCtx,
) => {
  sel
    .on('mouseenter', () => {
      tooltip.textContent = text
      tooltip.style.display = 'block'
    })
    .on('mousemove', (event: MouseEvent) => {
      const [mx] = d3.pointer(event, container)
      const width = tooltip.offsetWidth
      tooltip.style.left = `${mx + width + 12 > container.clientWidth ? mx - width - 12 : mx + 12}px`
      tooltip.style.top = `${top + 8}px`
    })
    .on('mouseleave', () => {
      tooltip.style.display = 'none'
    })
}

const renderTarget = (
  g: Group,
  y: d3.ScaleLinear<number, number>,
  innerWidth: number,
  min?: number,
  max?: number,
) => {
  const top = y.domain()[1]
  const bandTop = y(max ?? top)
  g.append('rect')
    .attr('x', 0)
    .attr('width', innerWidth)
    .attr('y', bandTop)
    .attr('height', Math.max(y(min ?? 0) - bandTop, 0))
    .attr('fill', targetBandColor)
  for (const v of [min, max]) {
    if (v === undefined) continue
    g.append('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', y(v))
      .attr('y2', y(v))
      .attr('stroke', statusColor.met)
      .attr('stroke-dasharray', '4,3')
  }
}

const renderDayAxes = (
  g: Group,
  x: d3.ScaleTime<number, number>,
  y: d3.ScaleLinear<number, number>,
  innerHeight: number,
  formatValue: (v: number) => string,
) => {
  const utcDay = d3.utcFormat('%b %d')
  g.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(
      d3
        .axisBottom(x)
        .ticks(6)
        .tickFormat((d) => utcDay(d as Date)),
    )
    .selectAll('text')
    .attr('font-size', '11px')
  g.append('g')
    .call(
      d3
        .axisLeft(y)
        .ticks(4)
        .tickFormat((v) => formatValue(Number(v))),
    )
    .selectAll('text')
    .attr('font-size', '11px')
}

const renderBars = (
  g: Group,
  days: GoalHistoryDay[],
  x: d3.ScaleTime<number, number>,
  y: d3.ScaleLinear<number, number>,
  innerHeight: number,
  formatValue: (v: number) => string,
  ctx: TooltipCtx,
) => {
  for (const day of days) {
    const start = dayStart(day.date)
    const left = x(start)
    const width = Math.max(x(new Date(start.getTime() + DAY_MS)) - left - 1, 1)
    const rect = g
      .append('rect')
      .attr('x', left)
      .attr('y', y(day.value))
      .attr('width', width)
      .attr('height', Math.max(innerHeight - y(day.value), 0))
      .attr('fill', statusColor[day.status])
      .attr('fill-opacity', day.partial ? PARTIAL_OPACITY : 1)
      .attr('rx', 1)
    bindTooltip(rect, dayTooltip(day, formatValue), ctx)
  }
}

const renderLine = (
  g: Group,
  days: GoalHistoryDay[],
  x: d3.ScaleTime<number, number>,
  y: d3.ScaleLinear<number, number>,
  formatValue: (v: number) => string,
  ctx: TooltipCtx,
) => {
  const cx = (day: GoalHistoryDay) => x(new Date(dayStart(day.date).getTime() + DAY_MS / 2))
  const line = d3
    .line<GoalHistoryDay>()
    .x(cx)
    .y((d) => y(d.value))
  g.append('path')
    .datum(days)
    .attr('d', line)
    .attr('fill', 'none')
    .attr('stroke', trendLineColor)
    .attr('stroke-width', 2)
  for (const day of days) {
    const circle = g
      .append('circle')
      .attr('cx', cx(day))
      .attr('cy', y(day.value))
      .attr('r', 3)
      .attr('fill', day.partial ? 'none' : statusColor[day.status])
      .attr('stroke', statusColor[day.status])
      .attr('stroke-width', day.partial ? 1.5 : 0)
    bindTooltip(circle, dayTooltip(day, formatValue), ctx)
  }
}

const renderDays = (
  g: Group,
  props: Omit<GoalHistoryChartProps, 'months' | 'height'> & { days: GoalHistoryDay[] },
  innerWidth: number,
  innerHeight: number,
  ctx: TooltipCtx,
) => {
  const { days, formatValue, max, min, mode } = props
  const first = dayStart(days[0].date)
  const last = new Date(dayStart(days[days.length - 1].date).getTime() + DAY_MS)
  const x = d3.scaleTime().domain([first, last]).range([0, innerWidth])
  const dataMax = d3.max(days, (d) => d.value) ?? 0
  const y = d3
    .scaleLinear()
    .domain([0, yDomainTop(dataMax, min, max)])
    .range([innerHeight, 0])

  renderTarget(g, y, innerWidth, min, max)
  renderDayAxes(g, x, y, innerHeight, formatValue)
  if (mode === 'line') renderLine(g, days, x, y, formatValue, ctx)
  else renderBars(g, days, x, y, innerHeight, formatValue, ctx)
}

const renderMonths = (
  g: Group,
  months: GoalHistoryMonth[],
  innerWidth: number,
  innerHeight: number,
  ctx: TooltipCtx,
) => {
  const x = d3
    .scaleBand<string>()
    .domain(months.map((m) => m.month))
    .range([0, innerWidth])
    .padding(0.2)
  const y = d3
    .scaleLinear()
    .domain([0, d3.max(months, (m) => m.days_total) || 1])
    .range([innerHeight, 0])

  g.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).tickFormat(monthLabel))
    .selectAll('text')
    .attr('font-size', '11px')
    .attr('text-anchor', 'end')
    .attr('transform', 'rotate(-35)')
  g.append('g')
    .call(d3.axisLeft(y).ticks(4).tickFormat(d3.format('d')))
    .selectAll('text')
    .attr('font-size', '11px')

  for (const month of months) {
    const left = x(month.month) ?? 0
    const opacity = month.partial ? PARTIAL_OPACITY : 1
    const wrapper = g.append('g')
    wrapper
      .append('rect')
      .attr('x', left)
      .attr('width', x.bandwidth())
      .attr('y', y(month.days_total))
      .attr('height', innerHeight - y(month.days_total))
      .attr('fill', '#d1d5db')
      .attr('fill-opacity', opacity)
      .attr('rx', 2)
    wrapper
      .append('rect')
      .attr('x', left)
      .attr('width', x.bandwidth())
      .attr('y', y(month.days_met))
      .attr('height', innerHeight - y(month.days_met))
      .attr('fill', statusColor.met)
      .attr('fill-opacity', opacity)
      .attr('rx', 2)
    bindTooltip(wrapper, monthTooltip(month), ctx)
  }
}

export function GoalHistoryChart({
  days,
  height = 220,
  max,
  min,
  mode,
  months,
  formatValue,
}: GoalHistoryChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const isEmpty = mode === 'months' ? !months?.length : !days?.length

  useEffect(() => {
    const container = containerRef.current
    const tooltip = tooltipRef.current
    if (!svgRef.current || !container || !tooltip) return

    const width = container.clientWidth
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', width).attr('height', height)

    const margin = { bottom: mode === 'months' ? 44 : 28, left: 56, right: 12, top: 10 }
    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bottom
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)
    const ctx = { container, tooltip, top: margin.top }

    if (mode === 'months') {
      if (months?.length) renderMonths(g, months, innerWidth, innerHeight, ctx)
    } else if (days?.length) {
      renderDays(g, { days, formatValue, max, min, mode }, innerWidth, innerHeight, ctx)
    }
  }, [days, months, min, max, mode, formatValue, height])

  if (isEmpty) return <div class="goal-history-chart-empty">No data for this range</div>

  return (
    <div ref={containerRef} class="goal-history-chart">
      <svg ref={svgRef} />
      <div class="goal-history-tooltip" ref={tooltipRef} />
    </div>
  )
}
