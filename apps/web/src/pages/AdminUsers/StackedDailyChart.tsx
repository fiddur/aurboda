import * as d3 from 'd3'
import { useEffect, useRef } from 'preact/hooks'

import type { StackedDays } from './admin-users-utils'

import { BreakdownLegend, SERIES_COLORS } from '../../components/charts/breakdown'
import { renderTimeAxis, timeAxisLayout } from '../../components/charts/time-axis'
import '../../components/charts/BarChart.css'

const DAY_MS = 86_400_000

const dayDate = (day: string) => new Date(`${day}T00:00:00Z`)

const color = (i: number) => SERIES_COLORS[i % SERIES_COLORS.length]

export function StackedDailyChart({ data, height = 220 }: { data: StackedDays; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    const tooltip = tooltipRef.current
    if (!svgRef.current || !container || !tooltip || data.keys.length === 0) return

    const width = container.clientWidth
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', width).attr('height', height)

    const margin = { left: 44, right: 12, top: 12 }
    const innerWidth = width - margin.left - margin.right
    const start = dayDate(data.days[0])
    const end = new Date(dayDate(data.days[data.days.length - 1]).getTime() + DAY_MS)
    const axis = timeAxisLayout([start, end], innerWidth)
    const innerHeight = height - margin.top - axis.bottomMargin

    const x = d3.scaleTime().domain([start, end]).range([0, innerWidth])
    const series = d3.stack<Record<string, number>>().keys(data.keys)(data.rows)
    const yMax = d3.max(series, (s) => d3.max(s, (d) => d[1])) ?? 1
    const y = d3
      .scaleLinear()
      .domain([0, Math.max(yMax, 1)])
      .nice()
      .range([innerHeight, 0])
    const barWidth = Math.max(innerWidth / data.days.length - 1, 1)

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)
    g.append('g')
      .call(
        d3
          .axisLeft(y)
          .ticks(4)
          .tickSize(-innerWidth)
          .tickFormat(() => ''),
      )
      .call((grid) => grid.select('.domain').remove())
      .selectAll('line')
      .attr('stroke', 'currentColor')
      .attr('stroke-opacity', 0.15)
      .attr('stroke-dasharray', '3,3')
    renderTimeAxis(g, x, innerHeight, axis)
    g.append('g').call(d3.axisLeft(y).ticks(4)).selectAll('text').attr('font-size', '11px')

    const showTooltip = (event: MouseEvent, index: number) => {
      const lines = data.keys
        .map((key, i) => ({ color: color(i), key, value: data.rows[index][key] }))
        .filter((l) => l.value > 0)
      const title = document.createElement('strong')
      title.textContent = data.days[index]
      tooltip.replaceChildren(title)
      for (const line of lines) {
        const dot = document.createElement('span')
        dot.style.color = line.color
        dot.textContent = '●'
        tooltip.append(document.createElement('br'), dot, ` ${line.key}: ${line.value}`)
      }
      if (lines.length === 0) tooltip.append(document.createElement('br'), 'none')
      tooltip.style.display = 'block'
      const [mx] = d3.pointer(event, container)
      const left = mx + tooltip.offsetWidth + 12 > width ? mx - tooltip.offsetWidth - 12 : mx + 12
      tooltip.style.left = `${left}px`
      tooltip.style.top = `${margin.top + 8}px`
    }

    series.forEach((layer, i) => {
      g.append('g')
        .attr('fill', color(i))
        .selectAll('rect')
        .data(layer)
        .join('rect')
        .attr('x', (_d, j) => x(dayDate(data.days[j])))
        .attr('y', (d) => y(d[1]))
        .attr('width', barWidth)
        .attr('height', (d) => Math.max(y(d[0]) - y(d[1]), 0))
    })

    g.append('g')
      .selectAll('rect')
      .data(data.days.map((day, index) => ({ day, index })))
      .join('rect')
      .attr('x', ({ day }) => x(dayDate(day)))
      .attr('y', 0)
      .attr('width', barWidth + 1)
      .attr('height', innerHeight)
      .attr('fill', 'transparent')
      .on('mousemove', (event: MouseEvent, { index }) => showTooltip(event, index))
      .on('mouseleave', () => {
        tooltip.style.display = 'none'
      })
  }, [data, height])

  if (data.keys.length === 0) return <div class="bar-chart-placeholder">Nothing in this period</div>

  return (
    <>
      <BreakdownLegend series={data.keys} />
      <div ref={containerRef} class="bar-chart-container">
        <svg ref={svgRef} />
        <div class="bar-chart-tooltip" ref={tooltipRef} />
      </div>
    </>
  )
}
