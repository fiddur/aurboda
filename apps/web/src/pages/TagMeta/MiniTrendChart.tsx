/**
 * Compact D3 trend chart reusable in meta pages.
 * Renders an area+line chart with tooltip crosshair.
 */
import * as d3 from 'd3'
import { useEffect, useRef } from 'preact/hooks'

export function MiniTrendChart({ data, color }: { data: { date: string; value: number }[]; color: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || data.length < 2) return

    const container = containerRef.current
    const width = container.clientWidth
    const height = 180

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', width).attr('height', height)

    const margin = { bottom: 30, left: 45, right: 15, top: 15 }
    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bottom

    const parsedData = data.map((d) => ({
      date: new Date(d.date),
      value: d.value,
    }))

    const x = d3
      .scaleTime()
      .domain(d3.extent(parsedData, (d) => d.date) as [Date, Date])
      .range([0, innerWidth])

    const yExtent = d3.extent(parsedData, (d) => d.value) as [number, number]
    const yRange = yExtent[1] - yExtent[0]
    const yPadding = yRange * 0.1 || 1
    const y = d3
      .scaleLinear()
      .domain([Math.max(0, yExtent[0] - yPadding), yExtent[1] + yPadding])
      .nice()
      .range([innerHeight, 0])

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    // Grid
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

    // Area
    const area = d3
      .area<{ date: Date; value: number }>()
      .x((d) => x(d.date))
      .y0(innerHeight)
      .y1((d) => y(d.value))
      .curve(d3.curveMonotoneX)

    g.append('path').datum(parsedData).attr('fill', color).attr('fill-opacity', 0.15).attr('d', area)

    // Line
    const line = d3
      .line<{ date: Date; value: number }>()
      .x((d) => x(d.date))
      .y((d) => y(d.value))
      .curve(d3.curveMonotoneX)

    g.append('path')
      .datum(parsedData)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 2)
      .attr('d', line)

    // Axes
    const dateExtent = d3.extent(parsedData, (d) => d.date) as [Date, Date]
    const spanYears = dateExtent[1].getFullYear() - dateExtent[0].getFullYear()
    const dateFormat = spanYears >= 1 ? d3.timeFormat("%b '%y") : d3.timeFormat('%b %d')

    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(
        d3
          .axisBottom(x)
          .ticks(5)
          .tickFormat((d) => dateFormat(d as Date)),
      )
      .selectAll('text')
      .attr('font-size', '11px')

    g.append('g').call(d3.axisLeft(y).ticks(4)).selectAll('text').attr('font-size', '11px')

    // Tooltip crosshair
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

    const bisector = d3.bisector<{ date: Date; value: number }, Date>((d) => d.date).left
    const tooltip = tooltipRef.current

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
          d1 && dateAtMouse.getTime() - d0.date.getTime() > d1.date.getTime() - dateAtMouse.getTime()
            ? d1
            : d0
        const cx = x(nearest.date)
        const cy = y(nearest.value)

        crosshair.attr('x1', cx).attr('x2', cx).style('display', null)
        highlightDot.attr('cx', cx).attr('cy', cy).style('display', null)

        if (tooltip) {
          const dateLabel =
            spanYears >= 1 ? d3.timeFormat("%b %d, '%y")(nearest.date) : d3.timeFormat('%b %d')(nearest.date)
          tooltip.textContent = `${dateLabel}: ${nearest.value.toFixed(1)}`
          tooltip.style.display = 'block'

          const containerRect = container.getBoundingClientRect()
          const tooltipX = mx + margin.left
          const tooltipWidth = tooltip.offsetWidth
          const left =
            tooltipX + tooltipWidth + 12 > containerRect.width ? tooltipX - tooltipWidth - 12 : tooltipX + 12
          tooltip.style.left = `${left}px`
          tooltip.style.top = `${margin.top + 8}px`
        }
      })
      .on('mouseleave', () => {
        crosshair.style('display', 'none')
        highlightDot.style('display', 'none')
        if (tooltip) tooltip.style.display = 'none'
      })
  }, [data, color])

  if (data.length < 2) {
    return <div class="mini-trend-placeholder">Insufficient data for chart</div>
  }

  return (
    <div ref={containerRef} class="mini-trend-container">
      <svg ref={svgRef} />
      <div class="mini-trend-tooltip" ref={tooltipRef} />
    </div>
  )
}
